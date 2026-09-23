'use strict';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runStockout30dScanJob } = require('./stockout30dScanService');
const { createJobStore } = require('./jobManager');
const { fakeStockoutSource } = require('./stockoutTestSource');

function product(code, { name = code, onHand = 0, isActive = true, createdDate } = {}) {
  return { productCode: code, fullName: name, isActive, inventories: [{ onHand }], createdDate };
}

function invoice(dateKey, details) {
  return { status: 1, purchaseDate: `${dateKey}T08:00:00`, invoiceDetails: details };
}

function purchaseOrder(dateKey, details, status = 3) {
  return { status, purchaseDate: `${dateKey}T08:00:00`, purchaseOrderDetails: details };
}

test('quet toan bo ma dang kinh doanh, khong loc theo ton kho hien tai — hang con ton kho van bi bao cao neu tung dut hang du 5 ngay', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const source = fakeStockoutSource({
    products: [[product('SP001', { name: 'Con hang nhung tung dut 5 ngay', onHand: 5 })]],
    invoices: [[invoice('2026-01-06', [{ productCode: 'SP001', quantity: 5 }])]],
    purchaseorders: [[purchaseOrder('2026-01-11', [{ productCode: 'SP001', quantity: 5 }])]],
    returns: [[]]
  });

  await runStockout30dScanJob(store, jobId, { source, todayKey: '2026-01-20', daysBack: 19, minConsecutiveDays: 5, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.equal(job.result.rows.length, 1);
  assert.equal(job.result.rows[0].code, 'SP001');
  assert.equal(job.result.rows[0].stockoutCount, 1);
  assert.equal(job.result.rows[0].totalStockoutDays, 5);
  assert.equal(job.result.rows[0].currentOnHand, 5);
  assert.equal(job.result.sources.invoices, 'postgres');
  assert.equal(job.result.sources.purchases, 'postgres');
  assert.equal(job.result.sources.customerReturns, 'postgres');
  assert.equal(job.result.sources.supplierReturns, 'postgres');
  // Chua import Tra NCC nao cho co so nay trong fixture nay nen canh bao thieu
  // du lieu xuat hien, khong lien quan gi den nguon Postgres con lai.
  assert.equal(job.result.warnings.length, 1);
  assert.ok(job.result.warnings.some((w) => /Trả NCC/.test(w)));
});

test('nhieu dot dut hang duoc cong don dung so lan va tong so ngay', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const source = fakeStockoutSource({
    products: [[product('SP001', { name: 'Hang dut 2 dot', onHand: 3 })]],
    invoices: [[invoice('2026-01-15', [{ productCode: 'SP001', quantity: 10 }])]],
    purchaseorders: [[
      purchaseOrder('2026-01-06', [{ productCode: 'SP001', quantity: 10 }]),
      purchaseOrder('2026-01-20', [{ productCode: 'SP001', quantity: 3 }])
    ]],
    returns: [[]]
  });

  await runStockout30dScanJob(store, jobId, { source, todayKey: '2026-01-20', daysBack: 19, minConsecutiveDays: 5, dataFromDateFloor: null });

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

test('nguon Tra NCC va Khach tra hang (ca hai deu Postgres) cung gop vao 1 eventMap cho 1 ma', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const source = fakeStockoutSource({
    products: [[product('SP005', { name: 'Ket hop 2 nguon', onHand: 3 })]],
    // Tra 3 don vi ve NCC ngay 2026-01-06 -> tu 3 ve 0
    supplierReturns: [[{ code: 'SP005', dateKey: '2026-01-06', quantity: 3 }]],
    // Khach tra lai 3 don vi ngay 2026-01-11 -> ket thuc dot dut hang (tu 0 len 3, khop voi ton kho hien tai)
    returns: [[{ status: 1, returnDate: '2026-01-11T00:00:00Z', returnDetails: [{ productCode: 'SP005', quantity: 3 }] }]]
  });

  await runStockout30dScanJob(store, jobId, { source, todayKey: '2026-01-20', daysBack: 19, minConsecutiveDays: 5, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.equal(job.result.rows.length, 1);
  assert.equal(job.result.rows[0].code, 'SP005');
  assert.equal(job.result.rows[0].stockoutCount, 1);
  assert.equal(job.result.rows[0].totalStockoutDays, 5);
  assert.equal(job.result.rows[0].currentOnHand, 3);
});

test('khong co ung vien nao thi tra ket qua rong, khong doc phieu tra hang', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const source = fakeStockoutSource({ products: [[]] });

  await runStockout30dScanJob(store, jobId, { source, todayKey: '2026-01-20', daysBack: 19, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.deepEqual(job.result.rows, []);
  assert.equal(job.result.totalCandidates, 0);
  assert.equal(source.calls.some(call => call.kind === 'customerReturns'), false);
});

test('loi khi doc san pham tu Postgres thi job chuyen sang status error', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const source = fakeStockoutSource({ products: [new Error('products db timeout')] });

  await runStockout30dScanJob(store, jobId, { source, todayKey: '2026-01-20', daysBack: 19, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'error');
  assert.match(job.error.message, /products db timeout/);
});

test('loi khi doc Tra NCC tu Postgres thi job chuyen sang status error', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const source = fakeStockoutSource({
    products: [[product('SP001', { onHand: 5 })]],
    supplierReturns: [new Error('supplier returns db timeout')]
  });

  await runStockout30dScanJob(store, jobId, { source, todayKey: '2026-01-20', daysBack: 19, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'error');
  assert.match(job.error.message, /Trả NCC.*supplier returns db timeout/);
});

test('loi khi doc phieu tra hang tu Postgres thi job chuyen sang status error', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const source = fakeStockoutSource({
    products: [[product('SP001', { onHand: 5 })]],
    returns: [new Error('returns db timeout')]
  });

  await runStockout30dScanJob(store, jobId, { source, todayKey: '2026-01-20', daysBack: 19, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'error');
  assert.match(job.error.message, /returns db timeout/);
});

test('mac dinh khong truyen dataFromDateFloor thi tu dong ghim ve moc san cua tinh nang', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const source = fakeStockoutSource({
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
  await runStockout30dScanJob(store, jobId, { source, todayKey: '2026-09-08', daysBack: 183, minConsecutiveDays: 5 });

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
  const source = fakeStockoutSource({
    products: [[product('SP001', { name: 'Ton kho chua kip cap nhat', onHand: 0 })]],
    // Nhap 400 ngay 05/09, khong co giao dich nao khac sau do — Ton kho
    // that su phai la 400, khong phai 0 nhu API dang bao (do webhook/polling
    // tre).
    purchaseorders: [[purchaseOrder('2026-09-05', [{ productCode: 'SP001', quantity: 400 }])]]
  });

  await runStockout30dScanJob(store, jobId, { source, todayKey: '2026-09-08', daysBack: 89, minConsecutiveDays: 5, dataFromDateFloor: '2026-06-01' });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.deepEqual(job.result.rows, []);
});

test('ma moi tao sau moc san khong bi bao dut hang truoc ngay no ton tai', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const source = fakeStockoutSource({
    products: [[product('SP001', { name: 'Ma moi tao 04/08, chua tung co hang', onHand: 0, createdDate: '2026-08-04T09:44:00' })]],
    // Mot giao dich Tra NCC nho de khong bi loc boi quy tac "khong co giao
    // dich nao trong ky" — dat dung ngay tao (ngay dau tien cua mang, delta
    // ngay nay khong anh huong toi ket qua tinh nguoc) de khong lam lech dot
    // dut hang; muc dich test la kiem tra moc san rieng theo ngay tao.
    supplierReturns: [[{ code: 'SP001', dateKey: '2026-08-04', quantity: 1 }]]
  });

  await runStockout30dScanJob(store, jobId, { source, todayKey: '2026-09-08', daysBack: 89, minConsecutiveDays: 5, dataFromDateFloor: '2026-06-01' });

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
  const source = fakeStockoutSource({
    products: [[product('SP001', { name: 'Ton kho 0, khong dong tram', onHand: 0 })]]
  });

  await runStockout30dScanJob(store, jobId, { source, todayKey: '2026-01-20', daysBack: 19, minConsecutiveDays: 5, dataFromDateFloor: null });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.deepEqual(job.result.rows, []);
});

test('ket qua luu lai co so luc quet (branch) de xuat Excel dung ten du sau do doi co so', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const source = fakeStockoutSource({ products: [[product('SP001', { name: 'A', onHand: 5 })]] });

  await runStockout30dScanJob(store, jobId, {
    source, todayKey: '2026-01-20', daysBack: 19, dataFromDateFloor: null, branch: 'Hà Nội'
  });

  const job = store.getJob(jobId);
  assert.equal(job.result.branch, 'Hà Nội');
});
