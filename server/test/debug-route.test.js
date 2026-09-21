'use strict';

process.env.KIOTVIET_CLIENT_ID = process.env.KIOTVIET_CLIENT_ID || 'test-client-id';
process.env.KIOTVIET_CLIENT_SECRET = process.env.KIOTVIET_CLIENT_SECRET || 'test-client-secret';
process.env.KIOTVIET_RETAILER = process.env.KIOTVIET_RETAILER || 'test-retailer';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');

const poolPath = require.resolve('../db/pool');
const queries = [];
require.cache[poolPath] = {
  id: poolPath,
  filename: poolPath,
  loaded: true,
  exports: {
    getPool: () => ({
      query: async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [{ count: 7 }] };
      }
    })
  }
};

const router = require('../routes');

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = code => { res.statusCode = code; return res; };
  res.json = payload => { res.body = payload; return res; };
  return res;
}

function debugHandler() {
  const layer = router.stack.find(item => item.route && item.route.path === '/api/debug' && item.route.methods.get);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

test('GET /api/debug ở một cơ sở: đếm hóa đơn theo đúng mã cơ sở đó', async () => {
  queries.length = 0;
  const res = fakeRes();
  await debugHandler()({ branch: 'Sài Gòn' }, res);

  assert.equal(res.body.branch, 'Sài Gòn');
  assert.deepEqual(queries[0].params, [['saigon']]);
  assert.match(res.body.databaseTest, /^OK/);
});

test('GET /api/debug ở "Cả hai": đếm hóa đơn của cả hai cơ sở, không gửi mã rỗng xuống DB', async () => {
  queries.length = 0;
  const res = fakeRes();
  await debugHandler()({ branch: 'Cả hai' }, res);

  assert.equal(res.body.branch, 'Cả hai');
  assert.deepEqual(queries[0].params, [['hanoi', 'saigon']]);
  assert.equal(res.body.databaseError, null);
  assert.match(res.body.databaseTest, /^OK/);
});
