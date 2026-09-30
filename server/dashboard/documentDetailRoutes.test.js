'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

// Thay repository bang ban gia TRUOC khi nap routes.js (routes.js destructure ham luc nap).
const repositoryPath = require.resolve('./documentDetailRepository');
const realRepository = require(repositoryPath);
const calls = [];
require.cache[repositoryPath].exports = {
  ...realRepository,
  getOrderDetail: async (args) => { calls.push(['order', args]); return { kind: 'order', code: args.code, lines: [] }; },
  getReturnDetail: async (args) => { calls.push(['return', args]); return { kind: 'return', code: args.code, lines: [] }; },
  getInvoiceDetail: async (args) => { calls.push(['invoice', args]); return { kind: 'invoice', code: args.code, lines: [] }; }
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

async function call(path, req) {
  const res = fakeRes();
  const originalError = console.error;
  console.error = () => {};
  try {
    await routeLayer('get', path).route.stack.at(-1).handle(req, res);
  } finally {
    console.error = originalError;
  }
  return res;
}

test('GET /api/order-detail doi nhan co so ra ma vat ly roi goi repository', async () => {
  const res = await call('/api/order-detail', { branch: 'Cả hai', query: { code: 'DH1', branch: 'Sài Gòn' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.at(-1), ['order', { code: 'DH1', branchCode: 'saigon' }]);
});

test('GET /api/invoice-detail goi repository hoa don theo co so', async () => {
  const res = await call('/api/invoice-detail', { branch: 'Cả hai', query: { code: 'HD1', branch: 'Hà Nội' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.at(-1), ['invoice', { code: 'HD1', branchCode: 'hanoi' }]);
});

test('che do 1 co so: bo trang ?branch thi dung co so dang xem', async () => {
  const res = await call('/api/return-detail', { branch: 'Hà Nội', query: { code: 'TH1' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.at(-1), ['return', { code: 'TH1', branchCode: 'hanoi' }]);
});

test('che do "Cả hai" ma thieu ?branch -> 400', async () => {
  const res = await call('/api/order-detail', { branch: 'Cả hai', query: { code: 'DH1' } });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /cơ sở/);
});

test('khong duoc xem chung tu cua co so ngoai pham vi dang xem', async () => {
  const before = calls.length;
  const res = await call('/api/order-detail', { branch: 'Hà Nội', query: { code: 'DH1', branch: 'Sài Gòn' } });
  assert.equal(res.statusCode, 400);
  assert.equal(calls.length, before, 'khong duoc truy van DB');
});

test('ca 3 API chi tiet chung tu deu co guard dat truoc route handler', () => {
  for (const path of ['/api/order-detail', '/api/return-detail', '/api/invoice-detail']) {
    const guardIndex = router.stack.findIndex(layer => !layer.route && layer.regexp && layer.regexp.test(path));
    assert.ok(guardIndex >= 0 && guardIndex < router.stack.indexOf(routeLayer('get', path)), `${path} thieu guard`);
  }
});
