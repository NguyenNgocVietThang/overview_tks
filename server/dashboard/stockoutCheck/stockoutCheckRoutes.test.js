'use strict';
process.env.KIOTVIET_CLIENT_ID = process.env.KIOTVIET_CLIENT_ID || 'test-client-id';
process.env.KIOTVIET_CLIENT_SECRET = process.env.KIOTVIET_CLIENT_SECRET || 'test-client-secret';
process.env.KIOTVIET_RETAILER = process.env.KIOTVIET_RETAILER || 'test-retailer';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const router = require('./stockoutCheckRoutes');

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

const recentStockoutScanService = require('./recentStockoutScanService');

test('POST /api/products/stockout-recent/scan: tao job va tra 202 + jobId', async () => {
  const original = recentStockoutScanService.runRecentStockoutScanJob;
  let called = false;
  recentStockoutScanService.runRecentStockoutScanJob = async () => { called = true; };
  try {
    const handler = getRouteHandler('post', '/api/products/stockout-recent/scan');
    const req = {};
    const res = fakeRes();

    await handler(req, res);

    assert.equal(res.statusCode, 202);
    assert.equal(typeof res.body.jobId, 'string');
    assert.equal(router.jobStore.getJob(res.body.jobId).status, 'running');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(called, true);
  } finally {
    recentStockoutScanService.runRecentStockoutScanJob = original;
  }
});

test('GET /api/products/stockout-recent/:jobId/progress: job khong ton tai tra 404', async () => {
  const handler = getRouteHandler('get', '/api/products/stockout-recent/:jobId/progress');
  const req = { params: { jobId: 'khong-ton-tai' } };
  const res = fakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'JOB_NOT_FOUND');
});

test('GET /api/products/stockout-recent/:jobId/result: job dang chay tra 409 JOB_NOT_READY', async () => {
  const jobId = router.jobStore.createJob();
  const handler = getRouteHandler('get', '/api/products/stockout-recent/:jobId/result');
  const req = { params: { jobId } };
  const res = fakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'JOB_NOT_READY');
});

test('GET /api/products/stockout-recent/:jobId/result: job xong tra 200 + result', async () => {
  const jobId = router.jobStore.createJob();
  router.jobStore.setResult(jobId, { asOfDate: '2026-01-10', totalProductsScanned: 100, totalCandidates: 1, rows: [{ code: 'SP001', name: 'A', lastOutOfStockDate: '2026-01-05', daysOutOfStock: 6 }] });
  const handler = getRouteHandler('get', '/api/products/stockout-recent/:jobId/result');
  const req = { params: { jobId } };
  const res = fakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.result.rows.length, 1);
});

const stockout90dScanService = require('./stockout90dScanService');

test('POST /api/products/stockout-90d/scan: tao job va tra 202 + jobId', async () => {
  const original = stockout90dScanService.runStockout90dScanJob;
  let called = false;
  stockout90dScanService.runStockout90dScanJob = async () => { called = true; };
  try {
    const handler = getRouteHandler('post', '/api/products/stockout-90d/scan');
    const req = { branch: 'Hà Nội' };
    const res = fakeRes();

    await handler(req, res);

    assert.equal(res.statusCode, 202);
    assert.equal(typeof res.body.jobId, 'string');
    assert.equal(router.jobStore.getJob(res.body.jobId).status, 'running');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(called, true);
  } finally {
    stockout90dScanService.runStockout90dScanJob = original;
  }
});

test('GET /api/products/stockout-90d/:jobId/progress: job khong ton tai tra 404', async () => {
  const handler = getRouteHandler('get', '/api/products/stockout-90d/:jobId/progress');
  const req = { params: { jobId: 'khong-ton-tai' } };
  const res = fakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'JOB_NOT_FOUND');
});

test('GET /api/products/stockout-90d/:jobId/result: job dang chay tra 409 JOB_NOT_READY', async () => {
  const jobId = router.jobStore.createJob();
  const handler = getRouteHandler('get', '/api/products/stockout-90d/:jobId/result');
  const req = { params: { jobId } };
  const res = fakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'JOB_NOT_READY');
});

test('GET /api/products/stockout-90d/:jobId/result: job xong tra 200 + result', async () => {
  const jobId = router.jobStore.createJob();
  router.jobStore.setResult(jobId, {
    asOfDate: '2026-01-20',
    fromDate: '2026-01-01',
    totalProductsScanned: 100,
    totalCandidates: 1,
    rows: [{ code: 'SP001', name: 'A', stockoutCount: 1, totalStockoutDays: 6, currentOnHand: 2 }]
  });
  const handler = getRouteHandler('get', '/api/products/stockout-90d/:jobId/result');
  const req = { params: { jobId } };
  const res = fakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.result.rows.length, 1);
});
