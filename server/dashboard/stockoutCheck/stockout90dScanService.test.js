'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runStockout90dScanJob } = require('./stockout90dScanService');
const { createJobStore } = require('./jobManager');

const HEADERS = {
  products: ['Mã hàng', 'Tên hàng', 'Tồn kho', 'Trạng thái'],
  invoices: ['Mã hóa đơn', 'Ngày bán', 'Trạng thái'],
  invoiceDetails: ['Mã hóa đơn', 'Mã hàng', 'Số lượng'],
  purchases: ['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái'],
  purchaseReturns: ['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái']
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

test('quet toan bo ma dang kinh doanh, khong loc theo ton kho hien tai — hang con ton kho van bi bao cao neu tung dut hang du 5 ngay', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient({
    'Hàng hóa': [HEADERS.products, ['SP001', 'Con hang nhung tung dut 5 ngay', 5, 'Đang kinh doanh']],
    'Hóa đơn': [HEADERS.invoices, ['HD001', '06/01/2026 10:00:00', 'Hoàn thành']],
    'Chi tiết hóa đơn': [HEADERS.invoiceDetails, ['HD001', 'SP001', 5]],
    'Nhập hàng': [HEADERS.purchases, ['SP001', '11/01/2026 08:00:00', 5, 'Hoàn thành']],
    'Trả NCC': [HEADERS.purchaseReturns]
  });
  const client = fakeReturnsClient([{ items: [], meta: { pagesLoaded: 1, recordsLoaded: 0, total: 0 } }]);

  await runStockout90dScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-20', daysBack: 19, minConsecutiveDays: 5, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.equal(job.result.rows.length, 1);
  assert.equal(job.result.rows[0].code, 'SP001');
  assert.equal(job.result.rows[0].stockoutCount, 1);
  assert.equal(job.result.rows[0].totalStockoutDays, 5);
  assert.equal(job.result.rows[0].currentOnHand, 5);
  assert.equal(job.result.sources.invoices, 'google-sheets-fallback');
  assert.equal(job.result.sources.purchases, 'google-sheets-fallback');
  assert.equal(job.result.sources.customerReturns, 'kiotviet-api');
  assert.equal(job.result.sources.supplierReturns, 'google-sheets');
  // 2 canh bao fallback (Hoa don, Nhap hang) + 1 canh bao do phu du lieu Tra
  // NCC vi sheet trong fixture nay khong co dong nao.
  assert.equal(job.result.warnings.length, 3);
  assert.ok(job.result.warnings.some((w) => /Trả NCC/.test(w)));
});

test('nhieu dot dut hang duoc cong don dung so lan va tong so ngay', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient({
    'Hàng hóa': [HEADERS.products, ['SP001', 'Hang dut 2 dot', 3, 'Đang kinh doanh']],
    'Hóa đơn': [HEADERS.invoices, ['HD001', '15/01/2026 09:00:00', 'Hoàn thành']],
    'Chi tiết hóa đơn': [HEADERS.invoiceDetails, ['HD001', 'SP001', 10]],
    'Nhập hàng': [
      HEADERS.purchases,
      ['SP001', '06/01/2026 08:00:00', 10, 'Hoàn thành'],
      ['SP001', '20/01/2026 08:00:00', 3, 'Hoàn thành']
    ],
    'Trả NCC': [HEADERS.purchaseReturns]
  });
  const client = fakeReturnsClient([{ items: [], meta: { pagesLoaded: 1, recordsLoaded: 0, total: 0 } }]);

  await runStockout90dScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-20', daysBack: 19, minConsecutiveDays: 5, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.equal(job.result.rows.length, 1);
  const row = job.result.rows[0];
  assert.equal(row.stockoutCount, 2);
  assert.equal(row.totalStockoutDays, 10);
  assert.equal(row.currentOnHand, 3);
  assert.deepEqual(row.periods, [
    { fromDate: '2026-01-01', toDate: '2026-01-05', days: 5 },
    { fromDate: '2026-01-15', toDate: '2026-01-19', days: 5 }
  ]);
});

test('nguon Tra NCC (Sheets) va Khach tra hang (API) cung gop vao 1 eventMap cho 1 ma', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient({
    'Hàng hóa': [HEADERS.products, ['SP005', 'Ket hop 2 nguon', 3, 'Đang kinh doanh']],
    'Hóa đơn': [HEADERS.invoices],
    'Chi tiết hóa đơn': [HEADERS.invoiceDetails],
    'Nhập hàng': [HEADERS.purchases],
    // Tra 3 don vi ve NCC ngay 2026-01-06 -> tu 3 ve 0
    'Trả NCC': [HEADERS.purchaseReturns, ['SP005', '06/01/2026 08:00:00', 3, 'Hoàn thành']]
  });
  const client = fakeReturnsClient([{
    items: [
      // Khach tra lai 3 don vi ngay 2026-01-11 -> ket thuc dot dut hang (tu 0 len 3, khop voi ton kho hien tai)
      { status: 1, returnDate: '2026-01-11T00:00:00Z', returnDetails: [{ productCode: 'SP005', quantity: 3 }] }
    ],
    meta: { pagesLoaded: 1, recordsLoaded: 1, total: 1 }
  }]);

  await runStockout90dScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-20', daysBack: 19, minConsecutiveDays: 5, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.equal(job.result.rows.length, 1);
  assert.equal(job.result.rows[0].code, 'SP005');
  assert.equal(job.result.rows[0].stockoutCount, 1);
  assert.equal(job.result.rows[0].totalStockoutDays, 5);
  assert.equal(job.result.rows[0].currentOnHand, 3);
});

test('khong co ung vien nao thi tra ket qua rong, khong goi API tra hang', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  let returnsApiCalled = false;
  const sheetsClient = fakeSheetsClient({
    'Hàng hóa': [HEADERS.products, ['SP001', 'Ngung KD', 0, 'Ngừng kinh doanh']],
    'Hóa đơn': [HEADERS.invoices],
    'Chi tiết hóa đơn': [HEADERS.invoiceDetails],
    'Nhập hàng': [HEADERS.purchases],
    'Trả NCC': [HEADERS.purchaseReturns]
  });
  const client = { async fetchAllPages() { returnsApiCalled = true; } };

  await runStockout90dScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-20', daysBack: 19, dataFromDateFloor: null });

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

  await runStockout90dScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-20', daysBack: 19, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'error');
  assert.match(job.error.message, /Google Sheets timeout/);
});

test('loi khi goi API tra hang thi job chuyen sang status error', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient({
    'Hàng hóa': [HEADERS.products, ['SP001', 'A', 5, 'Đang kinh doanh']],
    'Hóa đơn': [HEADERS.invoices],
    'Chi tiết hóa đơn': [HEADERS.invoiceDetails],
    'Nhập hàng': [HEADERS.purchases],
    'Trả NCC': [HEADERS.purchaseReturns]
  });
  const client = { async fetchAllPages() { throw new Error('KiotViet returns API timeout'); } };

  await runStockout90dScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-20', daysBack: 19, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'error');
  assert.match(job.error.message, /KiotViet returns API timeout/);
});

test('mac dinh khong truyen dataFromDateFloor thi tu dong ghim ve moc san cua tinh nang', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient({
    'Hàng hóa': [HEADERS.products, ['SP001', 'Het hang tu thang 7', 0, 'Đang kinh doanh']],
    // Ban het toan bo 5 don vi ngay 01/07/2026 — sau moc san 2026-06-01 nen
    // van nam trong cua so tinh toan, khong bi loc boi quy tac "khong co giao
    // dich nao trong ky".
    'Hóa đơn': [HEADERS.invoices, ['HD001', '01/07/2026 08:00:00', 'Hoàn thành']],
    'Chi tiết hóa đơn': [HEADERS.invoiceDetails, ['HD001', 'SP001', 5]],
    'Nhập hàng': [HEADERS.purchases],
    'Trả NCC': [HEADERS.purchaseReturns]
  });
  const client = fakeReturnsClient([{ items: [], meta: { pagesLoaded: 1, recordsLoaded: 0, total: 0 } }]);

  // Khong truyen dataFromDateFloor — phai tu dong dung mac dinh
  // STOCKOUT_DATA_FLOOR_DATE_KEY ('2026-06-01') du daysBack=183 le ra keo lui
  // toi 2026-03-09 (kiem tra qua job.result.fromDate, khong phu thuoc dot dut
  // hang cu the cua SP001).
  await runStockout90dScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-09-08', daysBack: 183, minConsecutiveDays: 5 });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.equal(job.result.fromDate, '2026-06-01');
  assert.equal(job.result.rows.length, 1);
  assert.equal(job.result.rows[0].periods[0].fromDate, '2026-07-01');
  assert.equal(job.result.rows[0].periods[0].toDate, '2026-09-08');
});

test('ma khong co bat ky giao dich nao trong ky thi bi loai, du ton kho hien tai = 0', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient({
    'Hàng hóa': [HEADERS.products, ['SP001', 'Ton kho 0, khong dong tram', 0, 'Đang kinh doanh']],
    'Hóa đơn': [HEADERS.invoices],
    'Chi tiết hóa đơn': [HEADERS.invoiceDetails],
    'Nhập hàng': [HEADERS.purchases],
    'Trả NCC': [HEADERS.purchaseReturns]
  });
  const client = fakeReturnsClient([{ items: [], meta: { pagesLoaded: 1, recordsLoaded: 0, total: 0 } }]);

  await runStockout90dScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-20', daysBack: 19, minConsecutiveDays: 5, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.deepEqual(job.result.rows, []);
});
