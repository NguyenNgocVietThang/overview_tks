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

test('GET /api/invoice-detail doi nhan co so ra ma vat ly roi goi repository hoa don', async () => {
  const res = await call('/api/invoice-detail', { branch: 'Cả hai', query: { code: 'HD1', branch: 'Sài Gòn' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.at(-1), ['invoice', { code: 'HD1', branchCode: 'saigon' }]);
  const hanoi = await call('/api/invoice-detail', { branch: 'Cả hai', query: { code: 'HD2', branch: 'Hà Nội' } });
  assert.equal(hanoi.statusCode, 200);
  assert.deepEqual(calls.at(-1), ['invoice', { code: 'HD2', branchCode: 'hanoi' }]);
});

test('che do 1 co so: bo trang ?branch thi dung co so dang xem', async () => {
  const res = await call('/api/invoice-detail', { branch: 'Hà Nội', query: { code: 'HD3' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.at(-1), ['invoice', { code: 'HD3', branchCode: 'hanoi' }]);
});

test('che do "Cả hai" ma thieu ?branch -> 400', async () => {
  const res = await call('/api/invoice-detail', { branch: 'Cả hai', query: { code: 'HD1' } });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /cơ sở/);
});

test('khong duoc xem chung tu cua co so ngoai pham vi dang xem', async () => {
  const before = calls.length;
  const res = await call('/api/invoice-detail', { branch: 'Hà Nội', query: { code: 'HD1', branch: 'Sài Gòn' } });
  assert.equal(res.statusCode, 400);
  assert.equal(calls.length, before, 'khong duoc truy van DB');
});

test('API chi tiet hoa don co guard dat truoc route handler', () => {
  const path = '/api/invoice-detail';
  const guardIndex = router.stack.findIndex(layer => !layer.route && layer.regexp && layer.regexp.test(path));
  assert.ok(guardIndex >= 0 && guardIndex < router.stack.indexOf(routeLayer('get', path)), `${path} thieu guard`);
});

test('/api/order-detail va /api/return-detail da bo cung 2 bang Dat hang / Tra hang cua tab Hoa don (chi tiet don Phieu tam o Vong doi don hang)', () => {
  for (const path of ['/api/order-detail', '/api/return-detail']) {
    assert.equal(router.stack.some(item => item.route && item.route.path === path), false, `${path} khong con route`);
  }
});
