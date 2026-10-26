'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  customerLevelFromEmail,
  hasFullVat,
  isFreightCustomer,
  normalizeCustomerName,
  FREIGHT_CUSTOMERS,
} = require('./priceAuditRules');

test('cap khach tu email: vua/lon/vip, bo dau, hoa thuong, khoang trang', () => {
  assert.equal(customerLevelFromEmail('Vừa@gmail.com'), 'medium');
  assert.equal(customerLevelFromEmail('abc@gmail.com'), 'medium');
  assert.equal(customerLevelFromEmail('Lớn@gmail.com'), 'large');
  assert.equal(customerLevelFromEmail('lon@x.vn'), 'large');
  assert.equal(customerLevelFromEmail('mới@gmail.com'), 'large');
  assert.equal(customerLevelFromEmail('Moi@gmail.com'), 'large');
  assert.equal(customerLevelFromEmail(' VIP @gmail.com'), 'vip');
  assert.equal(customerLevelFromEmail('V I P@gmail.com'), 'vip');
});

test('cap khach: khong co email = Lon; email la = Vua; chi phan truoc @ duoc xet', () => {
  for (const v of ['', null, undefined, '   ', 42]) {
    assert.equal(customerLevelFromEmail(v), 'large', String(v));
  }
  for (const v of ['vipx@gmail.com', 'a@vip.com', 'vip.nguyen@gmail.com']) {
    assert.equal(customerLevelFromEmail(v), 'medium', String(v));
  }
  assert.equal(customerLevelFromEmail('vip'), 'vip');
});

test('Full VAT: nhieu bien the, ghi chu dong hoac hoa don', () => {
  assert.equal(hasFullVat(' FULL   VAT ', ''), true);
  assert.equal(hasFullVat('', 'fullvat'), true);
  assert.equal(hasFullVat('Full Vat', null), true);
  assert.equal(hasFullVat('giao sang, FULLVAT.', ''), true);
  assert.equal(hasFullVat('FULL\tVAT', ''), true);
  assert.equal(hasFullVat('Vat', ''), true);
  assert.equal(hasFullVat('', 'khach lay VAT 8%'), true);
});

test('Full VAT: khong co / khong co ranh gioi tu thi sai', () => {
  assert.equal(hasFullVat('', ''), false);
  assert.equal(hasFullVat(null, undefined), false);
  assert.equal(hasFullVat('gia full', 'full'), false);
  assert.equal(hasFullVat('invat', 'vats'), false);
  assert.equal(hasFullVat('unfullvat', ''), false);
  assert.equal(hasFullVat('fullvatx', ''), false);
  assert.equal(hasFullVat('fullvatà', ''), false);
  assert.equal(hasFullVat('àfullvat', ''), false);
});

test('khach bao cuoc: khop toan bo ten sau chuan hoa, giu dau', () => {
  assert.equal(FREIGHT_CUSTOMERS.length, 10);
  assert.equal(isFreightCustomer('SG Tín Phong Shop'), true);
  assert.equal(isFreightCustomer('  sg   tín phong  SHOP '), true);
  assert.equal(isFreightCustomer('MN C Thư Sóc Trăng'), true);
  assert.equal(isFreightCustomer('NN Jinlong Campuchia'), true);
  assert.equal(isFreightCustomer('NN Heng Campuchia'), true);
  // NFC khac NFD van khop
  assert.equal(isFreightCustomer('SG Tín Phong Shop'.normalize('NFD')), true);
});

test('khach bao cuoc: khong khop chuoi con, mat dau, hoac ten khac', () => {
  assert.equal(isFreightCustomer('SG Tin Phong Shop'), false);
  assert.equal(isFreightCustomer('SG Tín Phong Shop 2'), false);
  assert.equal(isFreightCustomer('Tín Phong'), false);
  assert.equal(isFreightCustomer('NN Jinlong'), false);
  assert.equal(isFreightCustomer(''), false);
  assert.equal(isFreightCustomer(null), false);
});

test('normalizeCustomerName', () => {
  assert.equal(normalizeCustomerName('  KMN   Tín Phong '), 'kmn tín phong');
  assert.equal(normalizeCustomerName(null), '');
});
