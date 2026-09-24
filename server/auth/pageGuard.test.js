'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPageGuard, isPageRequest } = require('./pageGuard');
const { ROLES } = require('./userRepository');

function fakeRes() {
  const res = { statusCode: null, redirectedTo: null, headers: {} };
  res.setHeader = (name, value) => { res.headers[name] = value; };
  res.redirect = (code, url) => { res.statusCode = code; res.redirectedTo = url; return res; };
  return res;
}

function fakeReq(path, { token = null } = {}) {
  return { method: 'GET', path, originalUrl: path, cookies: token ? { tks_auth: token } : {} };
}

/** Page guard voi mot tai khoan gia — khong cham Postgres. */
function guardFor(user, overrides = {}) {
  return createPageGuard({
    verifyToken: () => ({ id: 'u1' }),
    findUserById: async () => (user ? { id: 'u1', ...user } : null),
    resolveUser: async storedUser => storedUser,
    ...overrides
  });
}

async function run(guard, req) {
  const res = fakeRes();
  let nextCalled = false;
  await guard(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

test('isPageRequest chi nhan request dieu huong, bo qua tai nguyen tinh va /api', () => {
  for (const path of ['/', '/reports', '/reports/', '/account/', '/humanresources/', '/index.html']) {
    assert.equal(isPageRequest({ method: 'GET', path }), true, path);
  }
  for (const path of ['/api/auth/me', '/login/', '/register/', '/shared/shared.css',
    '/js/app.js', '/vendor/chart.umd.min.js', '/404.html', '/Logo.jpg', '/health']) {
    assert.equal(isPageRequest({ method: 'GET', path }), false, path);
  }
  assert.equal(isPageRequest({ method: 'POST', path: '/account/' }), false, 'chi gac GET/HEAD');
});

test('chua dang nhap: chuyen ve /login/ kem duong dan quay lai', async () => {
  const { res, nextCalled } = await run(guardFor({ vaiTro: ROLES.QUAN_LY }), fakeReq('/reports/'));
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 302);
  assert.equal(res.redirectedTo, '/login/?next=%2Freports%2F');
});

test('token hong: chuyen ve /login/', async () => {
  const guard = guardFor({ vaiTro: ROLES.QUAN_LY }, {
    verifyToken: () => { throw new Error('bad token'); }
  });
  const { res } = await run(guard, fakeReq('/reports/', { token: 'rac' }));
  assert.equal(res.statusCode, 302);
  assert.match(res.redirectedTo, /^\/login\//);
});

test('du quyen: cho qua va dat Cache-Control no-store', async () => {
  const guard = guardFor({ vaiTro: ROLES.QUAN_LY, trangThai: 'Đang hoạt động' });
  const { res, nextCalled } = await run(guard, fakeReq('/reports/', { token: 'ok' }));
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('thieu quyen: chuyen toi trang dau tien tai khoan vao duoc', async () => {
  const guest = guardFor({ vaiTro: ROLES.KHACH, trangThai: 'Đang hoạt động' });
  const { res } = await run(guest, fakeReq('/reports/', { token: 'ok' }));
  assert.equal(res.statusCode, 302);
  assert.equal(res.redirectedTo, '/shipment/lifecycle/');

  const accountant = guardFor({ vaiTro: ROLES.KE_TOAN, trangThai: 'Đang hoạt động' });
  const { res: res2 } = await run(accountant, fakeReq('/', { token: 'ok' }));
  assert.equal(res2.redirectedTo, '/shipment/lifecycle/', '"/" cung phuc vu trang bao cao');

  const { nextCalled } = await run(accountant, fakeReq('/humanresources/', { token: 'ok' }));
  assert.equal(nextCalled, true, 'Ke toan van vao duoc trang nhan su');
});

test('ghi de quyen theo tai khoan co hieu luc ngay o page guard', async () => {
  const guard = guardFor({
    vaiTro: ROLES.KE_TOAN,
    trangThai: 'Đang hoạt động',
    featurePermissions: { 'reports.overview': true }
  });
  const { nextCalled } = await run(guard, fakeReq('/reports/', { token: 'ok' }));
  assert.equal(nextCalled, true);
});

test('trang khong nam trong bang PAGE_FEATURES thi khong bi gac', async () => {
  const guard = guardFor({ vaiTro: ROLES.KHACH, trangThai: 'Đang hoạt động' });
  const { nextCalled } = await run(guard, fakeReq('/trang-la/', { token: 'ok' }));
  assert.equal(nextCalled, true);
});

test('loi DB/HR (5xx): CHO QUA — su co ha tang khong duoc lam chet ca site', async () => {
  const guard = guardFor(null, {
    findUserById: async () => { throw new Error('Postgres khong ket noi duoc'); }
  });
  const { res, nextCalled } = await run(guard, fakeReq('/reports/', { token: 'ok' }));
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('tai khoan khong con ton tai: chuyen ve /login/', async () => {
  const guard = guardFor(null, { findUserById: async () => null });
  const { res } = await run(guard, fakeReq('/account/', { token: 'ok' }));
  assert.equal(res.statusCode, 302);
  assert.match(res.redirectedTo, /^\/login\//);
});
