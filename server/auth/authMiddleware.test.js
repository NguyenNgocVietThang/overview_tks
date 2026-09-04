'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AUTH_COOKIE_NAME, requireAuth, requireRole } = require('./authMiddleware');
const { signToken } = require('./authService');

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = code => { res.statusCode = code; return res; };
  res.json = payload => { res.body = payload; return res; };
  return res;
}

test('requireAuth: khong co cookie -> 401, khong goi next()', () => {
  const req = { cookies: {} };
  const res = fakeRes();
  let nextCalled = false;
  requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('requireAuth: cookie hop le -> gan req.user va goi next()', () => {
  const payload = { id: '1', username: 'quanly1', hoTen: 'Quản Lý A', vaiTro: 'Quản lý', coSo: 'Cả hai' };
  const token = signToken(payload);
  const req = { cookies: { [AUTH_COOKIE_NAME]: token } };
  const res = fakeRes();
  let nextCalled = false;
  requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
  assert.equal(req.user.username, 'quanly1');
  assert.equal(req.user.vaiTro, 'Quản lý');
});

test('requireAuth: cookie khong hop le -> 401, khong goi next()', () => {
  const req = { cookies: { [AUTH_COOKIE_NAME]: 'token-gia-mao' } };
  const res = fakeRes();
  let nextCalled = false;
  requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('requireRole: chua dang nhap (khong co req.user) -> 401', () => {
  const req = {};
  const res = fakeRes();
  let nextCalled = false;
  requireRole('Quản lý')(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('requireRole: vai tro nam trong danh sach cho phep -> goi next()', () => {
  const req = { user: { vaiTro: 'Kế toán' } };
  const res = fakeRes();
  let nextCalled = false;
  requireRole('Quản lý', 'Kế toán')(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('requireRole: vai tro khong nam trong danh sach cho phep -> 403', () => {
  const req = { user: { vaiTro: 'Trợ lý' } };
  const res = fakeRes();
  let nextCalled = false;
  requireRole('Quản lý', 'Kế toán')(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

test('requireRole: Khach bi chan khoi route chi danh cho noi bo', () => {
  const middleware = requireRole('Quản lý', 'Kế toán', 'Trưởng kho', 'Trợ lý');
  const req = { user: { vaiTro: 'Khách' } };
  const res = fakeRes();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

test('requireRole: Nhan vien kho, Nhan vien sale, Nhan vien mua hang hop le khi nam trong allowedRoles', () => {
  const middleware = requireRole('Nhân viên kho', 'Nhân viên sale', 'Nhân viên mua hàng');
  for (const role of ['Nhân viên kho', 'Nhân viên sale', 'Nhân viên mua hàng']) {
    const req = { user: { vaiTro: role } };
    const res = fakeRes();
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true, `Role ${role} phai duoc phep`);
    assert.equal(res.statusCode, null);
  }
});
