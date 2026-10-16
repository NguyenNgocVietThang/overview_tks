'use strict';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AUTH_COOKIE_NAME, requireAuth, requireRole, requireFeature, createRequireAuth } = require('./authMiddleware');
const { signToken } = require('./authService');

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = code => { res.statusCode = code; return res; };
  res.json = payload => { res.body = payload; return res; };
  return res;
}

test('requireAuth: khong co cookie -> 401, khong goi next()', async () => {
  const req = { cookies: {} };
  const res = fakeRes();
  let nextCalled = false;
  await requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('requireAuth: cookie hop le -> gan req.user va goi next()', async () => {
  const payload = { id: '1', username: 'quanly1', hoTen: 'Quản Lý A', vaiTro: 'Quản lý', coSo: 'Cả hai' };
  const token = signToken(payload);
  const middleware = createRequireAuth({
    verifyToken: () => payload,
    findUserById: async () => payload,
    resolveUser: async user => user
  });
  const req = { cookies: { [AUTH_COOKIE_NAME]: token } };
  const res = fakeRes();
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
  assert.equal(req.user.username, 'quanly1');
  assert.equal(req.user.vaiTro, 'Quản lý');
});

test('requireAuth: cookie khong hop le -> 401, khong goi next()', async () => {
  const req = { cookies: { [AUTH_COOKIE_NAME]: 'token-gia-mao' } };
  const res = fakeRes();
  let nextCalled = false;
  await requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('requireAuth: hydrates the effective user instead of trusting the JWT role', async () => {
  const middleware = createRequireAuth({
    verifyToken: () => ({ id: 'u1', username: 'a@example.com', vaiTro: 'Quản lý' }),
    findUserById: async () => ({ id: 'u1', username: 'a@example.com', vaiTro: 'Quản lý' }),
    resolveUser: async user => ({ ...user, vaiTro: 'Khách', coSo: 'Cả hai', hrManaged: true }),
  });
  const req = { cookies: { [AUTH_COOKIE_NAME]: 'valid' } };
  const res = fakeRes();
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.user.vaiTro, 'Khách');
  // Bot VPS tự quản lý liên kết Telegram — authMiddleware không còn gọi ensureTelegramLink nữa.
});

test('requireAuth: returns structured resolver errors without trusting stale JWT permissions', async () => {
  const codedMiddleware = createRequireAuth({
    verifyToken: () => ({ id: 'u1', vaiTro: 'Quản lý' }),
    findUserById: async () => ({ id: 'u1', vaiTro: 'Quản lý' }),
    resolveUser: async () => { const err = new Error('removed'); err.code = 'ACCOUNT_HR_REMOVED'; err.statusCode = 403; throw err; }
  });
  const req = { cookies: { [AUTH_COOKIE_NAME]: 'valid' } };
  const res = fakeRes();
  await codedMiddleware(req, res, () => assert.fail('must not continue'));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'ACCOUNT_HR_REMOVED');
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

// ---------------------------------------------------------------------------
// requireFeature — cong chinh cua he phan quyen theo tinh nang
// ---------------------------------------------------------------------------

test('requireFeature: chua dang nhap -> 401', () => {
  const res = fakeRes();
  let nextCalled = false;
  requireFeature('hr.leave')({}, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('requireFeature: co quyen -> di tiep', () => {
  const req = { user: { vaiTro: 'Kế toán', permissions: ['hr.leave', 'shipment.lifecycle'] } };
  const res = fakeRes();
  let nextCalled = false;
  requireFeature('hr.leave')(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('requireFeature: thieu quyen -> 403 kem code FEATURE_FORBIDDEN va ten quyen', () => {
  const req = { user: { vaiTro: 'Kế toán', permissions: ['hr.leave'] } };
  const res = fakeRes();
  let nextCalled = false;
  requireFeature('reports.debt.edit')(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
  assert.equal(res.body.code, 'FEATURE_FORBIDDEN');
  assert.equal(res.body.feature, 'reports.debt.edit');
});

test('requireFeature: nhieu quyen dung ngu nghia HOAC (co mot la du)', () => {
  const req = { user: { vaiTro: 'Khách', permissions: ['shipment.lookup'] } };
  const res = fakeRes();
  let nextCalled = false;
  requireFeature('shipment.lifecycle', 'shipment.lookup')(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('requireFeature: user chua co permissions thi tu giai theo vai tro + ghi de', () => {
  const res = fakeRes();
  let nextCalled = false;
  requireFeature('reports.overview')({ user: { vaiTro: 'Trợ lý' } }, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  const res2 = fakeRes();
  let next2 = false;
  requireFeature('reports.overview')(
    { user: { vaiTro: 'Trợ lý', featurePermissions: { 'reports.overview': false } } },
    res2,
    () => { next2 = true; }
  );
  assert.equal(res2.statusCode, 403, 'ghi de "chan" phai thang mac dinh cua vai tro');
  assert.equal(next2, false);
});

test('requireAuth gan req.user.permissions da giai san', async () => {
  const guard = createRequireAuth({
    verifyToken: () => ({ id: 'u1' }),
    findUserById: async () => ({ id: 'u1', vaiTro: 'Quản lý', trangThai: 'Đang hoạt động' }),
    resolveUser: async user => user
  });
  const req = { cookies: { [AUTH_COOKIE_NAME]: 'token' } };
  const res = fakeRes();
  let nextCalled = false;
  await guard(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.ok(Array.isArray(req.user.permissions));
  assert.ok(req.user.permissions.includes('account.permissions'));
});
