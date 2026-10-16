'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

// Thay repository bang ban gia TRUOC khi nap routes.js (routes.js destructure ham luc nap).
const repositoryPath = require.resolve('./inventoryValueHistory');
const realRepository = require(repositoryPath);
const calls = [];
require.cache[repositoryPath].exports = {
  ...realRepository,
  getInventoryValueHistory: async (args) => {
    calls.push(args);
    if (args.from === 'loi') {
      const error = new Error('Ngày không hợp lệ.');
      error.statusCode = 400;
      throw error;
    }
    return { rows: [{ date: '2026-09-30', hanoi: 100, saigon: 50 }] };
  }
};

const router = require('../routes');
const { getInventoryValueHistory } = realRepository;

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

function fakePool(rows, { code } = {}) {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (code) { const error = new Error('x'); error.code = code; throw error; }
      return { rows };
    }
  };
}

test('repository gom 2 co so thanh 1 dong/ngay theo thu tu ngay, chi kem co so trong pham vi', async () => {
  const pool = fakePool([
    { date: '2026-09-30', branch: 'hanoi', stock_value: '1000.5' },
    { date: '2026-09-30', branch: 'saigon', stock_value: '200' },
    { date: '2026-10-01', branch: 'hanoi', stock_value: '1100' }
  ]);
  const result = await getInventoryValueHistory({ branchCodes: ['hanoi', 'saigon'], from: '2026-09-30', to: '2026-10-07', pool });
  assert.deepEqual(result, { rows: [
    { date: '2026-09-30', hanoi: 1000.5, saigon: 200 },
    { date: '2026-10-01', hanoi: 1100 }
  ] });
  assert.deepEqual(pool.queries[0].params, [['hanoi', 'saigon'], '2026-09-30', '2026-10-07']);
});

test('repository khong truyen from/to = khong gioi han; khong co co so thi khong cham DB', async () => {
  const pool = fakePool([]);
  await getInventoryValueHistory({ branchCodes: ['saigon'], pool });
  assert.deepEqual(pool.queries[0].params, [['saigon'], null, null]);

  const untouched = fakePool([]);
  assert.deepEqual(await getInventoryValueHistory({ branchCodes: [], pool: untouched }), { rows: [] });
  assert.equal(untouched.queries.length, 0);
});

test('repository tu choi ngay sai dinh dang (400) va bo qua bang chua co (migration chua ap)', async () => {
  await assert.rejects(
    () => getInventoryValueHistory({ branchCodes: ['hanoi'], from: '30/09/2026', pool: fakePool([]) }),
    error => error.statusCode === 400
  );
  const missingTable = fakePool([], { code: '42P01' });
  assert.deepEqual(await getInventoryValueHistory({ branchCodes: ['hanoi'], pool: missingTable }), { rows: [] });

  const otherError = fakePool([], { code: '57P01' });
  await assert.rejects(() => getInventoryValueHistory({ branchCodes: ['hanoi'], pool: otherError }));
});

test('GET /api/inventory-value-history doi co so dang xem thanh ma vat ly va truyen ?from=&to=', async () => {
  const res = fakeRes();
  await routeLayer('get', '/api/inventory-value-history').route.stack.at(-1).handle(
    { branch: 'Cả hai', query: { from: '2026-09-24', to: '2026-09-30' } }, res
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.at(-1), { branchCodes: ['hanoi', 'saigon'], from: '2026-09-24', to: '2026-09-30' });

  const single = fakeRes();
  await routeLayer('get', '/api/inventory-value-history').route.stack.at(-1).handle({ branch: 'Sài Gòn', query: {} }, single);
  assert.deepEqual(calls.at(-1).branchCodes, ['saigon']);
});

test('GET /api/inventory-value-history tra 400 (khong phai 500) khi ngay khong hop le', async () => {
  const originalError = console.error;
  console.error = () => {};
  const res = fakeRes();
  try {
    await routeLayer('get', '/api/inventory-value-history').route.stack.at(-1).handle({ branch: 'Hà Nội', query: { from: 'loi' } }, res);
  } finally {
    console.error = originalError;
  }
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Ngày/);
});

test('/api/inventory-value-history duoc gac boi guard, dat truoc route handler', () => {
  const guardIndex = router.stack.findIndex(layer => !layer.route && layer.regexp && layer.regexp.test('/api/inventory-value-history'));
  const routeIndex = router.stack.indexOf(routeLayer('get', '/api/inventory-value-history'));
  assert.ok(guardIndex >= 0, 'phai co middleware guard khop /api/inventory-value-history');
  assert.ok(guardIndex < routeIndex, 'guard phai dung truoc route handler');
});
