'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AUTH_COOKIE_NAME } = require('../auth/authMiddleware');
const { signToken } = require('../auth/authService');
const router = require('./orderLifecycleRoutes');
const service = require('./orderLifecycleService');

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = code => { res.statusCode = code; return res; };
  res.json = payload => { res.body = payload; return res; };
  return res;
}

function getRouteStack(method, routePath) {
  const layer = router.stack.find(l => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`Không tìm thấy route: ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack.map(l => l.handle);
}

/**
 * Chay TOAN BO middleware stack cua 1 route (requireAuth -> requireRole ->
 * handler chinh) — mo phong dung hanh vi production, khac hrLeaveRoutes.test.js
 * chi goi rieng handler cuoi (role-gating da duoc kiem o authMiddleware.test.js
 * roi). O day can kiem tra ca role-list CU THE cua tung route nen phai chay het.
 */
async function callRoute(method, routePath, req, res) {
  const stack = getRouteStack(method, routePath);
  for (const handle of stack) {
    let calledNext = false;
    await handle(req, res, () => { calledNext = true; });
    if (!calledNext) break;
  }
}

function reqAs(vaiTro, params, query) {
  const token = signToken({ id: 'u1', username: 'u1', hoTen: 'Người dùng', vaiTro, coSo: 'Cả hai' });
  return { cookies: { [AUTH_COOKIE_NAME]: token }, params: params || {}, query: query || {} };
}

test.beforeEach(() => {
  service.findOrder = async () => ({ found: true, branch: 'HN', summary: { code: 'DELIVERED' }, detail: {} });
  service.listAllOrders = async () => ([{ orderCode: 'HD001' }]);
});

test('GET /api/shipment/lifecycle/:orderCode — Khách gọi được (200)', async () => {
  const req = reqAs('Khách', { orderCode: 'HD001' });
  const res = fakeRes();
  await callRoute('get', '/:orderCode', req, res);
  assert.equal(res.statusCode, 200);
});

test('GET /api/shipment/lifecycle — Khách bị 403', async () => {
  const req = reqAs('Khách');
  const res = fakeRes();
  await callRoute('get', '/', req, res);
  assert.equal(res.statusCode, 403);
});

const INTERNAL_ROLES = ['Kế toán', 'Trưởng kho', 'Quản lý', 'Trợ lý', 'Nhân viên sale'];

for (const role of INTERNAL_ROLES) {
  test(`GET /api/shipment/lifecycle/:orderCode — ${role} gọi được (200)`, async () => {
    const req = reqAs(role, { orderCode: 'HD001' });
    const res = fakeRes();
    await callRoute('get', '/:orderCode', req, res);
    assert.equal(res.statusCode, 200);
  });

  test(`GET /api/shipment/lifecycle — ${role} gọi được (200)`, async () => {
    const req = reqAs(role);
    const res = fakeRes();
    await callRoute('get', '/', req, res);
    assert.equal(res.statusCode, 200);
  });
}

const OUTSIDER_ROLES = ['Lái xe', 'Nhân viên kho', 'Nhân viên mua hàng'];

for (const role of OUTSIDER_ROLES) {
  test(`GET /api/shipment/lifecycle/:orderCode — ${role} bị 403`, async () => {
    const req = reqAs(role, { orderCode: 'HD001' });
    const res = fakeRes();
    await callRoute('get', '/:orderCode', req, res);
    assert.equal(res.statusCode, 403);
  });

  test(`GET /api/shipment/lifecycle — ${role} bị 403`, async () => {
    const req = reqAs(role);
    const res = fakeRes();
    await callRoute('get', '/', req, res);
    assert.equal(res.statusCode, 403);
  });
}

test('GET /api/shipment/lifecycle?branch=XX không hợp lệ -> 400', async () => {
  const req = reqAs('Quản lý', {}, { branch: 'XX' });
  const res = fakeRes();
  await callRoute('get', '/', req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_BRANCH');
});

test('GET /api/shipment/lifecycle/:orderCode không đăng nhập -> 401', async () => {
  const req = { cookies: {}, params: { orderCode: 'HD001' }, query: {} };
  const res = fakeRes();
  await callRoute('get', '/:orderCode', req, res);
  assert.equal(res.statusCode, 401);
});
