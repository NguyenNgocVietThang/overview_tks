'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const CONFIG = require('../../config');
const { runRecentStockoutScanJob } = require('./recentStockoutScanService');
const { createJobStore } = require('./jobManager');

function product(code, { name = code, onHand = 0, isActive = true, createdDate } = {}) {
  return { productCode: code, fullName: name, isActive, inventories: [{ onHand }], createdDate };
}

function invoice(dateKey, details) {
  return { status: 1, purchaseDate: `${dateKey}T08:00:00`, invoiceDetails: details };
}

function fakeClient(pagesByEndpoint = {}) {
  return {
    async fetchAllPages(endpoint, query, onPage) {
      const pages = pagesByEndpoint[endpoint] || [[]];
      let recordsLoaded = 0;
      for (let index = 0; index < pages.length; index++) {
        const page = pages[index];
        if (page instanceof Error) throw page;
        recordsLoaded += page.length;
        await onPage(page, {
          pagesLoaded: index + 1,
          recordsLoaded,
          total: pages.filter(item => Array.isArray(item)).reduce((sum, item) => sum + item.length, 0)
        });
      }
    }
  };
}

function fakeSheetsClient(sheets) {
  return {
    async getMultipleSheetValues(names) {
      const result = {};
      names.forEach((name) => { result[name] = sheets[name] || []; });
      return result;
    }
  };
}

function emptySupplierReturnsSheet() {
  return { [CONFIG.SHEET_SUPPLIER_RETURNS]: [['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái']] };
}

test('chi lay ung vien dang kinh doanh va ton kho tong = 0', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient({
    // SP002/SP004 can it nhat 1 giao dich trong ky de khong bi loc boi quy tac
    // "khong co giao dich nao trong ky thi bo qua" — muc dich test nay la kiem
    // tra bo loc ung vien (dang KD + ton kho 0), khong phai bo loc giao dich.
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [
      ['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái'],
      ['SP002', '05/01/2026 08:00:00', 1, 'Hoàn thành'],
      ['SP004', '05/01/2026 08:00:00', 1, 'Hoàn thành']
    ]
  });
  const apiCalls = [];
  const client = {
    async fetchAllPages(endpoint, query, onPage) {
      apiCalls.push({ endpoint, query });
      if (endpoint === 'products') {
        return onPage([
          product('SP001', { name: 'Con hang', onHand: 3 }),
          product('SP002', { name: 'Het hang, dang ban', onHand: 0 }),
          product('SP003', { name: 'Het hang nhung ngung kinh doanh', onHand: 0, isActive: false }),
          product('SP004', { name: 'Khong ghi isActive (mac dinh dang KD)', onHand: 0, isActive: undefined })
        ], { pagesLoaded: 1, recordsLoaded: 4, total: 4 });
      }
      return onPage([], { pagesLoaded: 1, recordsLoaded: 0, total: 0 });
    }
  };

  await runRecentStockoutScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-10', daysBack: 9, minConsecutiveDays: 5, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  const codes = job.result.rows.map((r) => r.code).sort();
  assert.deepEqual(codes, ['SP002', 'SP004']);
  assert.deepEqual(apiCalls.map(call => call.endpoint), ['products', 'invoices', 'purchaseorders', 'returns']);
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
  const sheetsClient = fakeSheetsClient(emptySupplierReturnsSheet());
  const client = fakeClient({
    products: [[
      product('SP001', { name: 'Het 5 ngay', onHand: 0 }),
      product('SP002', { name: 'Het 2 ngay', onHand: 0 })
    ]],
    invoices: [[
      invoice('2026-01-06', [{ productCode: 'SP001', quantity: 3 }]),
      invoice('2026-01-09', [{ productCode: 'SP002', quantity: 2 }])
    ]]
  });

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
  const sheetsClient = fakeSheetsClient(emptySupplierReturnsSheet());
  const client = fakeClient({
    products: [[product('SP001', { name: 'Ton kho 0, khong dong tram', onHand: 0 })]]
  });

  await runRecentStockoutScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-10', daysBack: 9, minConsecutiveDays: 5, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.deepEqual(job.result.rows, []);
});

test('ma co Ton kho hien tai = 0 nhung giao dich gan nhat la Nhap hang chua tieu thu thi bi loai (du lieu KiotViet chua kip cap nhat)', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient(emptySupplierReturnsSheet());
  const client = fakeClient({
    products: [[product('SP001', { name: 'Ton kho chua kip cap nhat', onHand: 0 })]],
    // Nhap 400 ngay 05/09, khong co giao dich nao khac sau do — Ton kho
    // that su phai la 400, khong phai 0 nhu API dang bao (do webhook/polling tre).
    purchaseorders: [[{ status: 3, purchaseDate: '2026-09-05T16:14:00', purchaseOrderDetails: [{ productCode: 'SP001', quantity: 400 }] }]]
  });

  await runRecentStockoutScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-09-08', daysBack: 183, minConsecutiveDays: 5, dataFromDateFloor: '2026-06-01' });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.deepEqual(job.result.rows, []);
});

test('ma moi tao sau moc san khong bi bao dut hang truoc ngay no ton tai', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient({
    // Dat dung ngay tao (ngay dau tien cua mang, delta ngay nay khong anh
    // huong toi ket qua tinh nguoc) de khong lam lech dot dut hang.
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [
      ['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái'],
      ['SP001', '04/08/2026 09:44:00', 1, 'Hoàn thành']
    ]
  });
  const client = fakeClient({
    products: [[product('SP001', { name: 'Ma moi tao 04/08, chua tung co hang', onHand: 0, createdDate: '2026-08-04T09:44:00' })]]
  });

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
  const sheetsClient = fakeSheetsClient(emptySupplierReturnsSheet());
  const client = {
    async fetchAllPages(endpoint, query, onPage) {
      if (endpoint === 'products') return onPage([product('SP001', { name: 'Con hang', onHand: 10 })], { pagesLoaded: 1, recordsLoaded: 1, total: 1 });
      if (endpoint === 'returns') returnsApiCalled = true;
      return onPage([], { pagesLoaded: 1, recordsLoaded: 0, total: 0 });
    }
  };

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
  const sheetsClient = fakeSheetsClient(emptySupplierReturnsSheet());
  const client = fakeClient({ products: [[product('SP001', { name: 'Con hang', onHand: 10 })]] });

  await runRecentStockoutScanJob(store, jobId, {
    sheetsClient, client, todayKey: '2026-01-10', daysBack: 9, dataFromDateFloor: null, branch: 'Sài Gòn'
  });

  const job = store.getJob(jobId);
  assert.equal(job.result.branch, 'Sài Gòn');
});

test('loi khi doc Google Sheets (Tra NCC) thi job chuyen sang status error', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = { async getMultipleSheetValues() { throw new Error('Google Sheets timeout'); } };
  const client = fakeClient({ products: [[product('SP001', { onHand: 0 })]] });

  await runRecentStockoutScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-10', daysBack: 9, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'error');
  assert.match(job.error.message, /Google Sheets timeout/);
});

test('loi khi goi API san pham thi job chuyen sang status error', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient(emptySupplierReturnsSheet());
  const client = fakeClient({ products: [new Error('KiotViet products API timeout')] });

  await runRecentStockoutScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-10', daysBack: 9, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'error');
  assert.match(job.error.message, /KiotViet products API timeout/);
});

test('loi khi goi API tra hang thi job chuyen sang status error', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient(emptySupplierReturnsSheet());
  const client = fakeClient({
    products: [[product('SP001', { name: 'A', onHand: 0 })]],
    returns: [new Error('KiotViet returns API timeout')]
  });

  await runRecentStockoutScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-10', daysBack: 9, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'error');
  assert.match(job.error.message, /KiotViet returns API timeout/);
});
