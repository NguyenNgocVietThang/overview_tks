'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPayload, crc16ccitt, toAddInfo } = require('./vietqr');

// Chuoi giai ma tu anh QR that cua app BIDV (STK 8873933850) — dung lam mau chuan o ca bot va web.
const BIDV_GOLDEN = '00020101021138540010A00000072701240006970418011088739338500208QRIBFTTA53037045802VN63045FF5';

test('CRC-16/CCITT-FALSE check vector', () => {
  assert.equal(crc16ccitt('123456789'), '29B1');
});

test('reproduces the bank-issued static VietQR byte for byte', () => {
  assert.equal(buildPayload({ bin: '970418', account: '8873933850' }), BIDV_GOLDEN);
});

test('dynamic QR carries amount and customer name as transfer content', () => {
  const payload = buildPayload({ bin: '970418', account: '8873933850', amount: 8620000, addInfo: 'Khôi Dương Nội' });
  assert.match(payload, /^000201010212/);
  assert.match(payload, /540786200005802VN/);
  assert.match(payload, /62180814KHOI DUONG NOI6304[0-9A-F]{4}$/);
  assert.equal(payload.slice(-4), crc16ccitt(payload.slice(0, -4)));
});

test('card numbers use the card service code', () => {
  assert.match(buildPayload({ bin: '970436', account: '9704361234567890', accountType: 'CARD' }), /QRIBFTTC/);
});

test('transfer content is ASCII, upper case and at most 25 characters', () => {
  assert.equal(toAddInfo('Khôi Dương Nội'), 'KHOI DUONG NOI');
  assert.equal(toAddInfo('Đặng Thị Ánh — Đông Anh, HN!'), 'DANG THI ANH DONG ANH HN');
  assert.ok(toAddInfo('C Tuyết Bắc Lãm rất rất rất dài tên').length <= 25);
});

test('rejects invalid inputs instead of producing a wrong QR', () => {
  assert.throws(() => buildPayload({ bin: '9704', account: '123456' }), /BIN/);
  assert.throws(() => buildPayload({ bin: '970418', account: '12' }), /số tài khoản/);
  assert.throws(() => buildPayload({ bin: '970418', account: '123456', amount: 1.5 }), /số tiền/);
});
