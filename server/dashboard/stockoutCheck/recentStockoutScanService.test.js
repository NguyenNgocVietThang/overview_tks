'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runRecentStockoutScanJob } = require('./recentStockoutScanService');
const { createJobStore } = require('./jobManager');

const HEADERS = {
  products: ['Mã hàng', 'Tên hàng', 'Tồn kho', 'Trạng thái'],
  invoices: ['Mã hóa đơn', 'Ngày bán', 'Trạng thái'],
  invoiceDetails: ['Mã hóa đơn', 'Mã hàng', 'Số lượng'],
  purchases: ['Mã hàng', 'Thời gian', 'Số lượng'],
  purchaseReturns: ['Mã hàng', 'Thời gian', 'Số lượng']
};

function fakeSheetsClient(sheets) {
  return {
    async getMultipleSheetValues(names) {
      const result = {};
      names.forEach((name) => { result[name] = sheets[name] || []; });
      return result;
    }
  };
}

function fakeReturnsClient(returnPages = []) {
  return {
    async fetchAllPages(endpoint, query, onPage) {
      if (endpoint !== 'returns') throw new Error('unexpected endpoint: ' + endpoint);
      for (const page of returnPages) await onPage(page.items, page.meta);
    }
  };
}

test('chi lay ung vien dang kinh doanh va ton kho tong = 0', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient({
    'Hàng hóa': [
      HEADERS.products,
      ['SP001', 'Con hang', 3, 'Đang kinh doanh'],
      ['SP002', 'Het hang, dang ban', 0, 'Đang kinh doanh'],
      ['SP003', 'Het hang nhung ngung kinh doanh', 0, 'Ngừng kinh doanh'],
      ['SP004', 'Khong ghi trang thai (mac dinh dang KD)', 0, '']
    ],
    'Hóa đơn': [HEADERS.invoices],
    'Chi tiết hóa đơn': [HEADERS.invoiceDetails],
    'Nhập hàng': [HEADERS.purchases],
    'Trả NCC': [HEADERS.purchaseReturns]
  });
  const client = fakeReturnsClient([{ items: [], meta: { pagesLoaded: 1, recordsLoaded: 0, total: 0 } }]);

  await runRecentStockoutScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-10', daysBack: 9, minConsecutiveDays: 5 });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  const codes = job.result.rows.map((r) => r.code).sort();
  assert.deepEqual(codes, ['SP002', 'SP004']);
});

test('ung vien het hang du 5 ngay lien tuc tinh den hom nay thi liet ke, chua du 5 ngay thi bo qua', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient({
    'Hàng hóa': [
      HEADERS.products,
      ['SP001', 'Het 5 ngay', 0, 'Đang kinh doanh'],
      ['SP002', 'Het 2 ngay', 0, 'Đang kinh doanh']
    ],
    'Hóa đơn': [
      HEADERS.invoices,
      ['HD001', '06/01/2026 08:00:00', 'Hoàn thành'],
      ['HD002', '09/01/2026 08:00:00', 'Hoàn thành']
    ],
    'Chi tiết hóa đơn': [HEADERS.invoiceDetails, ['HD001', 'SP001', 3], ['HD002', 'SP002', 2]],
    'Nhập hàng': [HEADERS.purchases],
    'Trả NCC': [HEADERS.purchaseReturns]
  });
  const client = fakeReturnsClient([{ items: [], meta: { pagesLoaded: 1, recordsLoaded: 0, total: 0 } }]);

  await runRecentStockoutScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-10', daysBack: 9, minConsecutiveDays: 5 });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.equal(job.result.rows.length, 1);
  assert.equal(job.result.rows[0].code, 'SP001');
  assert.equal(job.result.rows[0].lastOutOfStockDate, '2026-01-06');
  assert.equal(job.result.rows[0].daysOutOfStock, 5);
});

test('khong co ung vien nao thi tra ket qua rong, khong goi API tra hang', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  let returnsApiCalled = false;
  const sheetsClient = fakeSheetsClient({
    'Hàng hóa': [HEADERS.products, ['SP001', 'Con hang', 10, 'Đang kinh doanh']],
    'Hóa đơn': [HEADERS.invoices],
    'Chi tiết hóa đơn': [HEADERS.invoiceDetails],
    'Nhập hàng': [HEADERS.purchases],
    'Trả NCC': [HEADERS.purchaseReturns]
  });
  const client = { async fetchAllPages() { returnsApiCalled = true; } };

  await runRecentStockoutScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-10', daysBack: 9 });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.deepEqual(job.result.rows, []);
  assert.equal(job.result.totalCandidates, 0);
  assert.equal(returnsApiCalled, false);
});

test('loi khi doc Google Sheets thi job chuyen sang status error', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = { async getMultipleSheetValues() { throw new Error('Google Sheets timeout'); } };
  const client = fakeReturnsClient([]);

  await runRecentStockoutScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-10', daysBack: 9 });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'error');
  assert.match(job.error.message, /Google Sheets timeout/);
});

test('loi khi goi API tra hang thi job chuyen sang status error', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient({
    'Hàng hóa': [HEADERS.products, ['SP001', 'A', 0, 'Đang kinh doanh']],
    'Hóa đơn': [HEADERS.invoices],
    'Chi tiết hóa đơn': [HEADERS.invoiceDetails],
    'Nhập hàng': [HEADERS.purchases],
    'Trả NCC': [HEADERS.purchaseReturns]
  });
  const client = { async fetchAllPages() { throw new Error('KiotViet returns API timeout'); } };

  await runRecentStockoutScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-10', daysBack: 9 });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'error');
  assert.match(job.error.message, /KiotViet returns API timeout/);
});
