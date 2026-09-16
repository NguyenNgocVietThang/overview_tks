'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createInvoiceStatusService } = require('./invoiceStatusService');

// Postgres gio la nguon du lieu (bang `invoices`, cot `status` la SMALLINT
// KiotViet) — tiem 1 pool gia tra ve dung shape { rows: [{code, status}] } ma
// service mong doi sau khi da tu SQL map ma trang thai sang nhan tieng Viet
// (statusLabel() cua dashboardPgReader.js, tai dung khong viet lai o day).
// Moi test tao 1 service/pool rieng qua factory nen khong can require.cache
// reset hay __test__.resetCache() giua cac test.
function fakeService(rowsByBranch) {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      const branchCode = params[0];
      return { rows: rowsByBranch[branchCode] || [] };
    }
  };
  const service = createInvoiceStatusService({ pool });
  return { service, calls };
}

const HANOI_ROWS = [
  { code: 'HD001', status: 'Hoàn thành' },
  { code: 'hd002', status: 'Đang xử lý' }
];

test('tra cuu rong tra danh sach rong va khong doc Postgres', async () => {
  const { service, calls } = fakeService({ hanoi: HANOI_ROWS });
  assert.deepEqual(await service.lookupInvoiceStatuses([]), []);
  assert.equal(calls.length, 0);
});

test('khop chinh xac khong phan biet hoa thuong, bo trung va giu thu tu', async () => {
  const { service } = fakeService({ hanoi: HANOI_ROWS });
  const results = await service.lookupInvoiceStatuses([' hd002 ', 'HD001', 'HD002'], 'Hà Nội');
  assert.deepEqual(results, [
    { code: 'hd002', found: true, status: 'Đang xử lý' },
    { code: 'HD001', found: true, status: 'Hoàn thành' }
  ]);
  assert.deepEqual(Object.keys(results[0]), ['code', 'found', 'status']);
});

test('ma khong ton tai chi tra found false va status rong', async () => {
  const { service } = fakeService({ hanoi: HANOI_ROWS });
  assert.deepEqual(await service.lookupInvoiceStatuses(['HD999'], 'Hà Nội'), [
    { code: 'HD999', found: false, status: '' }
  ]);
});

test('chap nhan 50 ma va tu choi 51 ma', async () => {
  const { service } = fakeService({ hanoi: HANOI_ROWS });
  const fifty = Array.from({ length: 50 }, (_, i) => `HD${i}`);
  assert.equal((await service.lookupInvoiceStatuses(fifty, 'Hà Nội')).length, 50);
  await assert.rejects(
    () => service.lookupInvoiceStatuses(fifty.concat('HD51'), 'Hà Nội'),
    err => err.statusCode === 400 && err.code === 'TOO_MANY_CODES'
  );
});

test('cache snapshot hoa don trong cac lan tra cuu lien tiep (90s)', async () => {
  const { service, calls } = fakeService({ hanoi: HANOI_ROWS });
  await service.lookupInvoiceStatuses(['HD001'], 'Hà Nội');
  await service.lookupInvoiceStatuses(['HD002'], 'Hà Nội');
  assert.equal(calls.length, 1);
});

test('doc dung branch code Postgres (hanoi/saigon) tu nhan hien thi, khong ro ri cache giua 2 co so', async () => {
  const { service, calls } = fakeService({
    hanoi: [{ code: 'HD001', status: 'Hoàn thành' }],
    saigon: [{ code: 'HD001', status: 'Đã hủy' }]
  });
  const hanoi = await service.lookupInvoiceStatuses(['HD001'], 'Hà Nội');
  const saigon = await service.lookupInvoiceStatuses(['HD001'], 'Sài Gòn');
  assert.equal(hanoi[0].status, 'Hoàn thành');
  assert.equal(saigon[0].status, 'Đã hủy');
  assert.deepEqual(calls.map(c => c.params[0]), ['hanoi', 'saigon']);
});

test('branch khong hop le bi tu choi truoc khi query Postgres', async () => {
  const { service, calls } = fakeService({});
  await assert.rejects(
    () => service.lookupInvoiceStatuses(['HD001'], 'Không tồn tại'),
    err => err.statusCode === 400 && err.code === 'INVALID_BRANCH'
  );
  assert.equal(calls.length, 0);
});

test('__test__.resetCache() cua 1 instance khong anh huong instance khac', async () => {
  const { service, calls } = fakeService({ hanoi: HANOI_ROWS });
  await service.lookupInvoiceStatuses(['HD001'], 'Hà Nội');
  service.__test__.resetCache();
  await service.lookupInvoiceStatuses(['HD001'], 'Hà Nội');
  assert.equal(calls.length, 2, 'reset cache buoc phai query lai');
});
