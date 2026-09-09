'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const CONFIG = require('../../config');
const { runStockout90dScanJob } = require('./stockout90dScanService');
const { createJobStore } = require('./jobManager');

function product(code, { name = code, onHand = 0, isActive = true, createdDate } = {}) {
  return { productCode: code, fullName: name, isActive, inventories: [{ onHand }], createdDate };
}

function invoice(dateKey, details) {
  return { status: 1, purchaseDate: `${dateKey}T08:00:00`, invoiceDetails: details };
}

function purchaseOrder(dateKey, details, status = 3) {
  return { status, purchaseDate: `${dateKey}T08:00:00`, purchaseOrderDetails: details };
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

test('quet toan bo ma dang kinh doanh, khong loc theo ton kho hien tai — hang con ton kho van bi bao cao neu tung dut hang du 5 ngay', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient(emptySupplierReturnsSheet());
  const client = fakeClient({
    products: [[product('SP001', { name: 'Con hang nhung tung dut 5 ngay', onHand: 5 })]],
    invoices: [[invoice('2026-01-06', [{ productCode: 'SP001', quantity: 5 }])]],
    purchaseorders: [[purchaseOrder('2026-01-11', [{ productCode: 'SP001', quantity: 5 }])]],
    returns: [[]]
  });

  await runStockout90dScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-20', daysBack: 19, minConsecutiveDays: 5, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.equal(job.result.rows.length, 1);
  assert.equal(job.result.rows[0].code, 'SP001');
  assert.equal(job.result.rows[0].stockoutCount, 1);
  assert.equal(job.result.rows[0].totalStockoutDays, 5);
  assert.equal(job.result.rows[0].currentOnHand, 5);
  assert.equal(job.result.sources.invoices, 'kiotviet-api');
  assert.equal(job.result.sources.purchases, 'kiotviet-api');
  assert.equal(job.result.sources.customerReturns, 'kiotviet-api');
  assert.equal(job.result.sources.supplierReturns, 'google-sheets');
  // Chi con 1 canh bao do sheet Tra NCC trong fixture nay khong co dong nao —
  // khong con fallback nen khong con canh bao fallback nua.
  assert.equal(job.result.warnings.length, 1);
  assert.ok(job.result.warnings.some((w) => /Trả NCC/.test(w)));
});

test('nhieu dot dut hang duoc cong don dung so lan va tong so ngay', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient(emptySupplierReturnsSheet());
  const client = fakeClient({
    products: [[product('SP001', { name: 'Hang dut 2 dot', onHand: 3 })]],
    invoices: [[invoice('2026-01-15', [{ productCode: 'SP001', quantity: 10 }])]],
    purchaseorders: [[
      purchaseOrder('2026-01-06', [{ productCode: 'SP001', quantity: 10 }]),
      purchaseOrder('2026-01-20', [{ productCode: 'SP001', quantity: 3 }])
    ]],
    returns: [[]]
  });

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
    // Tra 3 don vi ve NCC ngay 2026-01-06 -> tu 3 ve 0
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [
      ['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái'],
      ['SP005', '06/01/2026 08:00:00', 3, 'Hoàn thành']
    ]
  });
  const client = fakeClient({
    products: [[product('SP005', { name: 'Ket hop 2 nguon', onHand: 3 })]],
    // Khach tra lai 3 don vi ngay 2026-01-11 -> ket thuc dot dut hang (tu 0 len 3, khop voi ton kho hien tai)
    returns: [[{ status: 1, returnDate: '2026-01-11T00:00:00Z', returnDetails: [{ productCode: 'SP005', quantity: 3 }] }]]
  });

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
  const sheetsClient = fakeSheetsClient(emptySupplierReturnsSheet());
  let returnsApiCalled = false;
  const client = {
    async fetchAllPages(endpoint, query, onPage) {
      if (endpoint === 'products') return onPage([], { pagesLoaded: 1, recordsLoaded: 0, total: 0 });
      if (endpoint === 'returns') returnsApiCalled = true;
      return onPage([], { pagesLoaded: 1, recordsLoaded: 0, total: 0 });
    }
  };

  await runStockout90dScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-20', daysBack: 19, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.deepEqual(job.result.rows, []);
  assert.equal(job.result.totalCandidates, 0);
  assert.equal(returnsApiCalled, false);
});

test('loi khi goi API san pham thi job chuyen sang status error', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient(emptySupplierReturnsSheet());
  const client = fakeClient({ products: [new Error('KiotViet products API timeout')] });

  await runStockout90dScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-20', daysBack: 19, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'error');
  assert.match(job.error.message, /KiotViet products API timeout/);
});

test('loi khi doc Google Sheets (Tra NCC) thi job chuyen sang status error', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = { async getMultipleSheetValues() { throw new Error('Google Sheets timeout'); } };
  const client = fakeClient({ products: [[product('SP001', { onHand: 5 })]] });

  await runStockout90dScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-20', daysBack: 19, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'error');
  assert.match(job.error.message, /Google Sheets timeout/);
});

test('loi khi goi API tra hang thi job chuyen sang status error', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient(emptySupplierReturnsSheet());
  const client = fakeClient({
    products: [[product('SP001', { onHand: 5 })]],
    returns: [new Error('KiotViet returns API timeout')]
  });

  await runStockout90dScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-20', daysBack: 19, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'error');
  assert.match(job.error.message, /KiotViet returns API timeout/);
});

test('mac dinh khong truyen dataFromDateFloor thi tu dong ghim ve moc san cua tinh nang', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient(emptySupplierReturnsSheet());
  const client = fakeClient({
    products: [[product('SP001', { name: 'Het hang tu thang 7', onHand: 0 })]],
    // Ban het toan bo 5 don vi ngay 01/07/2026 — sau moc san 2026-06-01 nen
    // van nam trong cua so tinh toan, khong bi loc boi quy tac "khong co giao
    // dich nao trong ky".
    invoices: [[invoice('2026-07-01', [{ productCode: 'SP001', quantity: 5 }])]]
  });

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

test('ma co Ton kho hien tai = 0 nhung giao dich gan nhat la Nhap hang chua tieu thu thi bi loai (du lieu KiotViet chua kip cap nhat)', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient(emptySupplierReturnsSheet());
  const client = fakeClient({
    products: [[product('SP001', { name: 'Ton kho chua kip cap nhat', onHand: 0 })]],
    // Nhap 400 ngay 05/09, khong co giao dich nao khac sau do — Ton kho
    // that su phai la 400, khong phai 0 nhu API dang bao (do webhook/polling
    // tre).
    purchaseorders: [[purchaseOrder('2026-09-05', [{ productCode: 'SP001', quantity: 400 }])]]
  });

  await runStockout90dScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-09-08', daysBack: 89, minConsecutiveDays: 5, dataFromDateFloor: '2026-06-01' });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.deepEqual(job.result.rows, []);
});

test('ma moi tao sau moc san khong bi bao dut hang truoc ngay no ton tai', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient({
    // Mot giao dich Tra NCC nho de khong bi loc boi quy tac "khong co giao
    // dich nao trong ky" — dat dung ngay tao (ngay dau tien cua mang, delta
    // ngay nay khong anh huong toi ket qua tinh nguoc) de khong lam lech dot
    // dut hang; muc dich test la kiem tra moc san rieng theo ngay tao.
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [
      ['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái'],
      ['SP001', '04/08/2026 09:44:00', 1, 'Hoàn thành']
    ]
  });
  const client = fakeClient({
    products: [[product('SP001', { name: 'Ma moi tao 04/08, chua tung co hang', onHand: 0, createdDate: '2026-08-04T09:44:00' })]]
  });

  await runStockout90dScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-09-08', daysBack: 89, minConsecutiveDays: 5, dataFromDateFloor: '2026-06-01' });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.equal(job.result.rows.length, 1);
  // Dot dut hang phai bat dau tu ngay tao (04/08), khong phai moc san chung
  // he thong (01/06) — SP001 khong the "dut hang" truoc khi no ton tai.
  assert.equal(job.result.rows[0].periods[0].fromDate, '2026-08-04');
});

test('ma khong co bat ky giao dich nao trong ky thi bi loai, du ton kho hien tai = 0', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient(emptySupplierReturnsSheet());
  const client = fakeClient({
    products: [[product('SP001', { name: 'Ton kho 0, khong dong tram', onHand: 0 })]]
  });

  await runStockout90dScanJob(store, jobId, { sheetsClient, client, todayKey: '2026-01-20', daysBack: 19, minConsecutiveDays: 5, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.deepEqual(job.result.rows, []);
});

test('ket qua luu lai co so luc quet (branch) de xuat Excel dung ten du sau do doi co so', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient(emptySupplierReturnsSheet());
  const client = fakeClient({ products: [[product('SP001', { name: 'A', onHand: 5 })]] });

  await runStockout90dScanJob(store, jobId, {
    sheetsClient, client, todayKey: '2026-01-20', daysBack: 19, dataFromDateFloor: null, branch: 'Hà Nội'
  });

  const job = store.getJob(jobId);
  assert.equal(job.result.branch, 'Hà Nội');
});
