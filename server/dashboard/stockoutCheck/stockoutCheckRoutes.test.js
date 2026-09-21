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

// ---------------------------------------------------------------------------
// Co so "Cả hai": chay job con cho tung co so vat ly roi gop ket qua.
// ---------------------------------------------------------------------------

test('POST /api/products/stockout-recent/scan ở "Cả hai": quét cả hai cơ sở vật lý và gộp kết quả', async () => {
  const original = recentStockoutScanService.runRecentStockoutScanJob;
  const scannedBranches = [];
  recentStockoutScanService.runRecentStockoutScanJob = async (store, jobId, deps) => {
    scannedBranches.push(deps.branch);
    store.setResult(jobId, {
      asOfDate: '2026-09-21', branch: deps.branch, totalProductsScanned: 5, totalCandidates: 1,
      sources: {}, warnings: [], rows: [{ code: 'SP001', name: 'A', periods: [] }]
    });
  };
  try {
    const handler = getRouteHandler('post', '/api/products/stockout-recent/scan');
    const req = { branch: 'Cả hai' };
    const res = fakeRes();

    await handler(req, res);
    assert.equal(res.statusCode, 202);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(scannedBranches, ['Hà Nội', 'Sài Gòn']);
    const job = router.jobStore.getJob(res.body.jobId);
    assert.equal(job.status, 'done');
    assert.equal(job.result.branch, 'Cả hai');
    assert.deepEqual(job.result.rows.map((row) => row.branch), ['Hà Nội', 'Sài Gòn']);
  } finally {
    recentStockoutScanService.runRecentStockoutScanJob = original;
  }
});

test('POST /api/products/stockout-90d/scan ở "Cả hai": quét cả hai cơ sở vật lý và gộp kết quả', async () => {
  const original = stockout90dScanService.runStockout90dScanJob;
  const scannedBranches = [];
  stockout90dScanService.runStockout90dScanJob = async (store, jobId, deps) => {
    scannedBranches.push(deps.branch);
    store.setResult(jobId, {
      asOfDate: '2026-09-21', fromDate: '2026-06-23', branch: deps.branch,
      totalProductsScanned: 5, totalCandidates: 1, sources: {}, warnings: [],
      rows: [{ code: 'SP001', name: 'A', periods: [] }]
    });
  };
  try {
    const handler = getRouteHandler('post', '/api/products/stockout-90d/scan');
    const req = { branch: 'Cả hai' };
    const res = fakeRes();

    await handler(req, res);
    assert.equal(res.statusCode, 202);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(scannedBranches, ['Hà Nội', 'Sài Gòn']);
    const job = router.jobStore.getJob(res.body.jobId);
    assert.equal(job.status, 'done');
    assert.equal(job.result.branch, 'Cả hai');
    assert.equal(job.result.fromDate, '2026-06-23');
  } finally {
    stockout90dScanService.runStockout90dScanJob = original;
  }
});

test('POST /api/products/stockout-recent/scan ở cơ sở vật lý: vẫn chỉ quét đúng cơ sở đó', async () => {
  const original = recentStockoutScanService.runRecentStockoutScanJob;
  const scannedBranches = [];
  recentStockoutScanService.runRecentStockoutScanJob = async (_store, _jobId, deps) => {
    scannedBranches.push(deps.branch);
  };
  try {
    const handler = getRouteHandler('post', '/api/products/stockout-recent/scan');
    const req = { branch: 'Sài Gòn' };
    const res = fakeRes();

    await handler(req, res);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(res.statusCode, 202);
    assert.deepEqual(scannedBranches, ['Sài Gòn']);
  } finally {
    recentStockoutScanService.runRecentStockoutScanJob = original;
  }
});
