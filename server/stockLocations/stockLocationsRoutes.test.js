'use strict';
process.env.JWT_SECRET ||= 'test-secret';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||= '{}';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStockLocationsRouter } = require('./stockLocationsRoutes');

function setup() {
  const reads = [];
  const router = createStockLocationsRouter({
    requireAuth: (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Chưa đăng nhập.' }),
    resolveBranch: (req, res, next) => next(),
    service: { getLocations: async branch => { reads.push(branch); return { branch, rows: [] }; } }
  });
  const handlers = router.stack.find(layer => layer.route).route.stack;
  return { reads, run: async (query = 'HN', scope = 'Hà Nội', user = { vaiTro: 'Nhân viên kho' }) => {
    const req = { query: { branch: query }, branch: scope, user };
    const res = { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, setHeader(name, value) { this.headers[name] = value; } };
    for (const layer of handlers) {
      let next = false;
      await layer.handle(req, res, () => { next = true; });
      if (!next) break;
    }
    return res;
  } };
}

test('API only reads requested branch in current scope and bypasses HTTP cache', async () => {
  const { reads, run } = setup();
  assert.equal((await run()).statusCode, 200);
  assert.equal((await run('SG', 'Sài Gòn')).statusCode, 200);
  const res = await run('SG', 'Cả hai');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.deepEqual(res.body, { branch: 'SG', rows: [] });
  assert.deepEqual(reads, ['HN', 'SG', 'SG']);
});

test('wrong branch scope and malformed branch do not read Sheets', async () => {
  const { reads, run } = setup();
  assert.equal((await run('SG', 'Hà Nội')).statusCode, 403);
  assert.equal((await run('HN', 'Sài Gòn')).statusCode, 403);
  for (const value of ['both', '', '__proto__', 'constructor', undefined, ['HN', 'SG']]) {
    // Explicitly pass undefined as an object so the run default does not apply.
    const query = value === undefined ? {} : value;
    assert.equal((await run(query)).statusCode, 400);
  }
  assert.deepEqual(reads, []);
});

test('anonymous, denied staff and guest with forged grants cannot read Sheets', async () => {
  const { reads, run } = setup();
  assert.equal((await run('HN', 'Cả hai', null)).statusCode, 401);
  assert.equal((await run('HN', 'Cả hai', { vaiTro: 'Khách', featurePermissions: { 'stockLocations.view': true } })).statusCode, 403);
  assert.equal((await run('HN', 'Cả hai', { vaiTro: 'Khách', permissions: ['stockLocations.view'] })).statusCode, 403);
  assert.equal((await run('HN', 'Cả hai', { vaiTro: 'Nhân viên kho', featurePermissions: { 'stockLocations.view': false } })).statusCode, 403);
  assert.deepEqual(reads, []);
});
