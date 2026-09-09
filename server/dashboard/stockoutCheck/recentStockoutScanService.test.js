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

function fakeAllSourcesClient(calls) {
  return {
    async fetchAllPages(endpoint, query, onPage) {
      calls.push({ endpoint, query });
      await onPage([], { pagesLoaded: 1, recordsLoaded: 0, total: 0 });
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
    // SP002/SP004 can it nhat 1 giao dich trong ky de khong bi loc boi quy tac
    // "khong co giao dich nao trong ky thi bo qua" — muc dich test nay la kiem
    // tra bo loc ung vien (dang KD + ton kho 0), khong phai bo loc giao dich.
    'Trả NCC': [
      HEADERS.purchaseReturns,
      ['SP002', '05/01/2026 08:00:00', 1, 'Hoàn thành'],
      ['SP004', '05/01/2026 08:00:00', 1, 'Hoàn thành']
    ]
  });
  const apiCalls = [];
  const client = fakeAllSourcesClient(apiCalls);

  await runRecentStockoutScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-10', daysBack: 9, minConsecutiveDays: 5, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  const codes = job.result.rows.map((r) => r.code).sort();
  assert.deepEqual(codes, ['SP002', 'SP004']);
  assert.deepEqual(apiCalls.map(call => call.endpoint), ['invoices', 'purchaseorders', 'returns']);
  assert.equal(job.result.sources.invoices, 'kiotviet-api');
  assert.equal(job.result.sources.supplierReturns, 'google-sheets');
  // Sheet Tra NCC rong hoan toan trong fixture nay nen canh bao thieu du lieu
  // xuat hien, khong lien quan gi den fallback API.
  assert.equal(job.result.warnings.length, 1);
  assert.match(job.result.warnings[0], /Trả NCC/);
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

  await runRecentStockoutScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-10', daysBack: 9, minConsecutiveDays: 5, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.equal(job.result.rows.length, 1);
  assert.equal(job.result.rows[0].code, 'SP001');
  assert.equal(job.result.rows[0].lastOutOfStockDate, '2026-01-06');
  assert.equal(job.result.rows[0].daysOutOfStock, 5);
  assert.deepEqual(job.result.rows[0].periods, [{ fromDate: '2026-01-06', toDate: '2026-01-10', days: 5 }]);
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

  await runRecentStockoutScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-10', daysBack: 9, minConsecutiveDays: 5, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.deepEqual(job.result.rows, []);
});

test('ma co Ton kho hien tai = 0 nhung giao dich gan nhat la Nhap hang chua tieu thu thi bi loai (Sheet Hang hoa da loi thoi)', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient({
    'Hàng hóa': [HEADERS.products, ['SP001', 'Sheet Ton kho da loi thoi', 0, 'Đang kinh doanh']],
    'Hóa đơn': [HEADERS.invoices],
    'Chi tiết hóa đơn': [HEADERS.invoiceDetails],
    // Nhap 400 ngay 05/09, khong co giao dich nao khac sau do — Ton kho
    // that su phai la 400, khong phai 0 nhu Sheet Hang hoa dang bao.
    'Nhập hàng': [HEADERS.purchases, ['SP001', '05/09/2026 16:14:00', 400, 'Hoàn thành']],
    'Trả NCC': [HEADERS.purchaseReturns]
  });
  const client = fakeReturnsClient([{ items: [], meta: { pagesLoaded: 1, recordsLoaded: 0, total: 0 } }]);

  await runRecentStockoutScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-09-08', daysBack: 183, minConsecutiveDays: 5, dataFromDateFloor: '2026-06-01' });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.deepEqual(job.result.rows, []);
});

test('ma moi tao sau moc san khong bi bao dut hang truoc ngay no ton tai', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient({
    'Hàng hóa': [
      ['Mã hàng', 'Tên hàng', 'Tồn kho', 'Trạng thái', 'Ngày tạo'],
      ['SP001', 'Ma moi tao 04/08, chua tung co hang', 0, 'Đang kinh doanh', '04/08/2026 09:44:00']
    ],
    'Hóa đơn': [HEADERS.invoices],
    'Chi tiết hóa đơn': [HEADERS.invoiceDetails],
    'Nhập hàng': [HEADERS.purchases],
    // Dat dung ngay tao (ngay dau tien cua mang, delta ngay nay khong anh
    // huong toi ket qua tinh nguoc) de khong lam lech dot dut hang.
    'Trả NCC': [HEADERS.purchaseReturns, ['SP001', '04/08/2026 09:44:00', 1, 'Hoàn thành']]
  });
  const client = fakeReturnsClient([{ items: [], meta: { pagesLoaded: 1, recordsLoaded: 0, total: 0 } }]);

  await runRecentStockoutScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-09-08', daysBack: 183, minConsecutiveDays: 5, dataFromDateFloor: '2026-06-01' });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.equal(job.result.rows.length, 1);
  // Dot dut hang phai bat dau tu ngay tao (04/08), khong phai moc san chung
  // he thong (01/06) — SP001 khong the "dut hang" truoc khi no ton tai.
  assert.equal(job.result.rows[0].lastOutOfStockDate, '2026-08-04');
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

  await runRecentStockoutScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-10', daysBack: 9, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.deepEqual(job.result.rows, []);
  assert.equal(job.result.totalCandidates, 0);
  assert.equal(returnsApiCalled, false);
});

test('ket qua luu lai co so luc quet (branch) de xuat Excel dung ten du sau do doi co so', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient({
    'Hàng hóa': [HEADERS.products, ['SP001', 'Con hang', 10, 'Đang kinh doanh']],
    'Hóa đơn': [HEADERS.invoices],
    'Chi tiết hóa đơn': [HEADERS.invoiceDetails],
    'Nhập hàng': [HEADERS.purchases],
    'Trả NCC': [HEADERS.purchaseReturns]
  });
  const client = { async fetchAllPages() {} };

  await runRecentStockoutScanJob(store, jobId, {
    sheetsClient, client, todayKey: '2026-01-10', daysBack: 9, dataFromDateFloor: null, branch: 'Sài Gòn'
  });

  const job = store.getJob(jobId);
  assert.equal(job.result.branch, 'Sài Gòn');
});

test('loi khi doc Google Sheets thi job chuyen sang status error', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = { async getMultipleSheetValues() { throw new Error('Google Sheets timeout'); } };
  const client = fakeReturnsClient([]);

  await runRecentStockoutScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-10', daysBack: 9, dataFromDateFloor: null });

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

  await runRecentStockoutScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-10', daysBack: 9, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'error');
  assert.match(job.error.message, /KiotViet returns API timeout/);
});
