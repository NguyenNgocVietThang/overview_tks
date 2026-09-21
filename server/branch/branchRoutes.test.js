'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const router = require('./branchRoutes');

function handler(method, routePath) {
  const layer = router.stack.find(item => item.route && item.route.path === routePath && item.route.methods[method]);
  if (!layer) throw new Error(`Khong tim thay route ${method} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    cookies: [],
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    cookie(name, value) { this.cookies.push({ name, value }); return this; }
  };
}

test('GET /api/branch exposes selectable values including Ca hai for a dual-branch user', () => {
  const res = fakeRes();
  handler('get', '/api/branch')({
    user: { coSo: 'Cả hai' },
    cookies: { tks_branch: 'Cả hai' }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.current, 'Cả hai');
  assert.deepEqual(res.body.allowed, ['Hà Nội', 'Sài Gòn', 'Cả hai']);
});

test('POST /api/branch accepts Ca hai only for a dual-branch user', () => {
  const post = handler('post', '/api/branch');
  const dualRes = fakeRes();
  post({ user: { coSo: 'Cả hai' }, body: { branch: 'Cả hai' } }, dualRes);
  assert.equal(dualRes.statusCode, 200);
  assert.equal(dualRes.body.current, 'Cả hai');
  assert.deepEqual(dualRes.cookies, [{ name: 'tks_branch', value: 'Cả hai' }]);

  const singleRes = fakeRes();
  post({ user: { coSo: 'Hà Nội' }, body: { branch: 'Cả hai' } }, singleRes);
  assert.equal(singleRes.statusCode, 403);
  assert.equal(singleRes.body.code, 'BRANCH_FORBIDDEN');
});
