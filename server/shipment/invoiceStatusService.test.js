'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');

function freshService(rows) {
  delete require.cache[require.resolve('./invoiceStatusService')];
  delete require.cache[require.resolve('../sheets/sheetsClient')];
  const service = require('./invoiceStatusService');
  const sheetsClient = require('../sheets/sheetsClient');
  let reads = 0;
  sheetsClient.getValues = async () => { reads++; return rows; };
  return { service, getReads: () => reads };
}

const ROWS = [
  ['Khách hàng', 'Trạng thái', 'Mã hóa đơn', 'Tổng tiền hàng'],
  ['Nguyễn A', 'Hoàn thành', 'HD001', 100000],
  ['Nguyễn B', 'Đang xử lý', 'hd002', 200000]
];

test('tra cuu rong tra danh sach rong va khong doc sheet', async () => {
  const { service, getReads } = freshService(ROWS);
  assert.deepEqual(await service.lookupInvoiceStatuses([]), []);
  assert.equal(getReads(), 0);
});

test('khop chinh xac khong phan biet hoa thuong, bo trung va giu thu tu', async () => {
  const { service } = freshService(ROWS);
  const results = await service.lookupInvoiceStatuses([' hd002 ', 'HD001', 'HD002']);
  assert.deepEqual(results, [
    { code: 'hd002', found: true, status: 'Đang xử lý' },
    { code: 'HD001', found: true, status: 'Hoàn thành' }
  ]);
  assert.deepEqual(Object.keys(results[0]), ['code', 'found', 'status']);
});

test('ma khong ton tai chi tra found false va status rong', async () => {
  const { service } = freshService(ROWS);
  assert.deepEqual(await service.lookupInvoiceStatuses(['HD999']), [
    { code: 'HD999', found: false, status: '' }
  ]);
});

test('chap nhan 50 ma va tu choi 51 ma', async () => {
  const { service } = freshService(ROWS);
  const fifty = Array.from({ length: 50 }, (_, i) => `HD${i}`);
  assert.equal((await service.lookupInvoiceStatuses(fifty)).length, 50);
  await assert.rejects(
    () => service.lookupInvoiceStatuses(fifty.concat('HD51')),
    err => err.statusCode === 400 && err.code === 'TOO_MANY_CODES'
  );
});

test('cache snapshot hoa don trong cac lan tra cuu lien tiep', async () => {
  const { service, getReads } = freshService(ROWS);
  await service.lookupInvoiceStatuses(['HD001']);
  await service.lookupInvoiceStatuses(['HD002']);
  assert.equal(getReads(), 1);
});
