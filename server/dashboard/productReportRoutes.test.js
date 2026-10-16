'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

// Thay repository bang ban gia TRUOC khi nap routes.js (routes.js destructure
// ham luc nap) - test khong cham DB.
const repositoryPath = require.resolve('./productReportRepository');
const realRepository = require(repositoryPath);
const calls = [];
require.cache[repositoryPath].exports = {
  ...realRepository,
  getProductReportCustomers: async (args) => {
    calls.push(args);
    if (!args.code) {
      const error = new Error('Thiếu mã hàng.');
      error.statusCode = 400;
      throw error;
    }
    return { code: args.code, totalRevenue: 10, customerCount: 1, rows: [{ customerName: 'KH A', revenue: 10, share: 1 }] };
  }
};

const router = require('../routes');

function routeLayer(method, routePath) {
  const layer = router.stack.find(item => item.route && item.route.path === routePath && item.route.methods[method]);
  if (!layer) throw new Error(`Khong tim thay route ${method} ${routePath}`);
  return layer;
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('GET /api/product-report/customers tra doanh so khach theo ma hang (?code=)', async () => {
  const res = fakeRes();
  await routeLayer('get', '/api/product-report/customers').route.stack.at(-1).handle({ query: { code: '012CUTIE' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.code, '012CUTIE');
  assert.deepEqual(calls.at(-1), { code: '012CUTIE' });
});

test('GET /api/product-report/customers tra 400 (khong phai 500) khi thieu ma hang', async () => {
  const originalError = console.error;
  console.error = () => {};
  const res = fakeRes();
  try {
    await routeLayer('get', '/api/product-report/customers').route.stack.at(-1).handle({ query: {} }, res);
  } finally {
    console.error = originalError;
  }
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /mã hàng/);
});

test('/api/product-report (ke ca /customers) chung guard reports.products, dat truoc route handler', () => {
  const guardIndex = router.stack.findIndex(layer => !layer.route && layer.regexp && layer.regexp.test('/api/product-report/customers'));
  const routeIndex = router.stack.indexOf(routeLayer('get', '/api/product-report/customers'));
  assert.ok(guardIndex >= 0, 'phai co middleware guard khop /api/product-report/customers');
  assert.ok(guardIndex < routeIndex, 'guard phai dung truoc route handler');
});
