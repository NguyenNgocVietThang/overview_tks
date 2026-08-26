'use strict';
process.env.KIOTVIET_CLIENT_ID = process.env.KIOTVIET_CLIENT_ID || 'test-client-id';
process.env.KIOTVIET_CLIENT_SECRET = process.env.KIOTVIET_CLIENT_SECRET || 'test-client-secret';
process.env.KIOTVIET_RETAILER = process.env.KIOTVIET_RETAILER || 'test-retailer';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const router = require('./stockoutCheckRoutes');
const stockoutCheckService = require('./stockoutCheckService');

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

function getRouteHandler(method, routePath) {
  const layer = router.stack.find((item) => item.route && item.route.path === routePath && item.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function buildXlsxBuffer(headerRow, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Mã hàng');
  sheet.addRow(headerRow);
  for (const row of rows) sheet.addRow(row);
  return workbook.xlsx.writeBuffer();
}

test('POST /api/products/stockout-check: upload thanh cong tao job va tra 202 + jobId', async () => {
  const original = stockoutCheckService.runStockoutCheckJob;
  let called = false;
  stockoutCheckService.runStockoutCheckJob = async () => { called = true; };
  try {
    const buffer = await buildXlsxBuffer(['Mã hàng'], [['SP001'], ['SP002']]);
    const handler = getRouteHandler('post', '/api/products/stockout-check');
    const req = { file: { buffer, originalname: 'test.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } };
    const res = fakeRes();

    await handler(req, res);

    assert.equal(res.statusCode, 202);
    assert.equal(typeof res.body.jobId, 'string');
    assert.equal(router.jobStore.getJob(res.body.jobId).status, 'running');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(called, true);
  } finally {
    stockoutCheckService.runStockoutCheckJob = original;
  }
});

test('POST /api/products/stockout-check: khong doc duoc ma hang nao thi tra 400 EMPTY_FILE', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Trống');
  const buffer = await workbook.xlsx.writeBuffer();
  const handler = getRouteHandler('post', '/api/products/stockout-check');
  const req = { file: { buffer, originalname: 'empty.xlsx', mimetype: 'application/vnd.ms-excel' } };
  const res = fakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'EMPTY_FILE');
});

test('POST /api/products/stockout-check: khong co file thi tra 400 EMPTY_FILE', async () => {
  const handler = getRouteHandler('post', '/api/products/stockout-check');
  const req = { file: undefined };
  const res = fakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'EMPTY_FILE');
});

test('GET progress: job khong ton tai tra 404 JOB_NOT_FOUND', async () => {
  const handler = getRouteHandler('get', '/api/products/stockout-check/:jobId/progress');
  const req = { params: { jobId: 'khong-ton-tai' } };
  const res = fakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'JOB_NOT_FOUND');
});

test('GET progress: job dang chay tra dung thong tin tien do', async () => {
  const jobId = router.jobStore.createJob();
  router.jobStore.updateProgress(jobId, {
    invalidCodes: ['SP999'],
    totalValidCodes: 2,
    progress: { phase: 1, phase1: { invoices: { pagesLoaded: 2, recordsLoaded: 200, total: 250 } } }
  });

  const handler = getRouteHandler('get', '/api/products/stockout-check/:jobId/progress');
  const req = { params: { jobId } };
  const res = fakeRes();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'running');
  assert.equal(res.body.phase, 1);
  assert.equal(res.body.invalidCodes.length, 1);
  assert.equal(res.body.totalValidCodes, 2);
});

test('GET result: job dang chay tra 409 JOB_NOT_READY', async () => {
  const jobId = router.jobStore.createJob();
  const handler = getRouteHandler('get', '/api/products/stockout-check/:jobId/result');
  const req = { params: { jobId } };
  const res = fakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'JOB_NOT_READY');
});

test('GET result: job da xong tra 200 + result', async () => {
  const jobId = router.jobStore.createJob();
  router.jobStore.setResult(jobId, { rows: [{ code: 'SP001' }] });

  const handler = getRouteHandler('get', '/api/products/stockout-check/:jobId/result');
  const req = { params: { jobId } };
  const res = fakeRes();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.result, { rows: [{ code: 'SP001' }] });
});

test('GET result: job loi tra 500 + thong tin loi', async () => {
  const jobId = router.jobStore.createJob();
  router.jobStore.setError(jobId, { message: 'that bai', code: 'BOOM' });

  const handler = getRouteHandler('get', '/api/products/stockout-check/:jobId/result');
  const req = { params: { jobId } };
  const res = fakeRes();
  await handler(req, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.code, 'BOOM');
});
