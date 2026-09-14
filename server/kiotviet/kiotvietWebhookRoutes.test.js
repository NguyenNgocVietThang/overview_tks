'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const router = require('./kiotvietWebhookRoutes');

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

test('POST /api/kiotviet/webhook: tra 200 ngay lap tuc voi bat ky body nao', () => {
  const handler = getRouteHandler('post', '/api/kiotviet/webhook');
  const req = { body: { anything: 'khong quan trong o stub nay' } };
  const res = fakeRes();

  handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { received: true });
});

test('POST /api/kiotviet/webhook: tra 200 ke ca khi body rong', () => {
  const handler = getRouteHandler('post', '/api/kiotviet/webhook');
  const req = { body: undefined };
  const res = fakeRes();

  handler(req, res);

  assert.equal(res.statusCode, 200);
});
