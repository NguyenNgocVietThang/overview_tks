'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-client-id.apps.googleusercontent.com';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AUTH_COOKIE_NAME } = require('./authMiddleware');
const { comparePassword } = require('./authService');

function fakeRes() {
  const res = { statusCode: null, body: null, cookies: [] };
  res.status = code => { res.statusCode = code; return res; };
  res.json = payload => { res.body = payload; return res; };
  res.cookie = (name, value, options) => { res.cookies.push({ name, value, options }); return res; };
  return res;
}

function getRouteHandler(router, method, routePath) {
  const layer = router.stack.find(l => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`Không tìm thấy route: ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

/**
 * Require lai authRoutes.js VOI cac dependency da mock san. authRoutes.js
 * destructure ham ngay luc require (const { x } = require(...)), nen phai
 * ghi de tren MODULE dependency truoc, roi moi require authRoutes.js fresh
 * de no "chup" dung ham da mock (khong the mock sau khi da require).
 */
function freshAuthRoutes({
  verifyGoogleIdToken,
  findUserByEmail,
  findUserByUsername = async () => null,
  createActiveGuest,
  activatePendingGuest = async () => {}
}) {
  ['./authRoutes', './googleAuthService', './userRepository', './userWriteRepository', '../config']
    .forEach(id => { delete require.cache[require.resolve(id)]; });

  const googleAuthService = require('./googleAuthService');
  googleAuthService.verifyGoogleIdToken = verifyGoogleIdToken;

  const userRepository = require('./userRepository');
  userRepository.findUserByEmail = findUserByEmail;
  userRepository.findUserByUsername = findUserByUsername;

  const userWriteRepository = require('./userWriteRepository');
  userWriteRepository.createActiveGuest = createActiveGuest;
  userWriteRepository.activatePendingGuest = activatePendingGuest;

  return require('./authRoutes');
}

const NEVER_CALL = async () => { throw new Error('khong nen goi ham nay'); };

test('POST /api/auth/register: thieu du lieu, email sai hoac mat khau ngan -> 400', async () => {
  const router = freshAuthRoutes({
    verifyGoogleIdToken: NEVER_CALL,
    findUserByEmail: NEVER_CALL,
    createActiveGuest: NEVER_CALL
  });
  const handler = getRouteHandler(router, 'post', '/api/auth/register');
  for (const body of [
    {},
    { hoTen: 'A', email: 'email-sai', password: '12345678' },
    { hoTen: 'A', email: 'a@example.com', password: '1234567' }
  ]) {
    const res = fakeRes();
    await handler({ body }, res);
    assert.equal(res.statusCode, 400);
  }
});

test('POST /api/auth/register: email da ton tai -> 409, khong ghi user', async () => {
  const router = freshAuthRoutes({
    verifyGoogleIdToken: NEVER_CALL,
    findUserByEmail: async () => ({ id: 'old' }),
    createActiveGuest: NEVER_CALL
  });
  const handler = getRouteHandler(router, 'post', '/api/auth/register');
  const res = fakeRes();
  await handler({ body: { hoTen: 'A', email: 'a@example.com', password: '12345678' } }, res);
  assert.equal(res.statusCode, 409);
});

test('POST /api/auth/register: tao Khach, bam mat khau va set cookie', async () => {
  let createdWith = null;
  const router = freshAuthRoutes({
    verifyGoogleIdToken: NEVER_CALL,
    findUserByEmail: async () => null,
    findUserByUsername: async () => null,
    createActiveGuest: async args => { createdWith = args; }
  });
  const handler = getRouteHandler(router, 'post', '/api/auth/register');
  const res = fakeRes();
  await handler({ body: { hoTen: ' Khách A ', email: ' KHACH@Example.com ', password: 'MatKhau123' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.username, 'khach@example.com');
  assert.equal(res.body.vaiTro, 'Khách');
  assert.equal(createdWith.email, 'khach@example.com');
  assert.notEqual(createdWith.passwordHash, 'MatKhau123');
  assert.equal(await comparePassword('MatKhau123', createdWith.passwordHash), true);
  assert.equal(res.cookies[0].name, AUTH_COOKIE_NAME);
});

test('POST /api/auth/google: thieu credential -> 400', async () => {
  const router = freshAuthRoutes({ verifyGoogleIdToken: NEVER_CALL, findUserByEmail: NEVER_CALL, createActiveGuest: NEVER_CALL });
  const handler = getRouteHandler(router, 'post', '/api/auth/google');
  const res = fakeRes();
  await handler({ body: {} }, res);
  assert.equal(res.statusCode, 400);
});

test('POST /api/auth/google: GOOGLE_CLIENT_ID chua cau hinh -> 500, khong goi Google', async () => {
  const original = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = '';
  try {
    const router = freshAuthRoutes({ verifyGoogleIdToken: NEVER_CALL, findUserByEmail: NEVER_CALL, createActiveGuest: NEVER_CALL });
    const handler = getRouteHandler(router, 'post', '/api/auth/google');
    const res = fakeRes();
    await handler({ body: { credential: 'tok' } }, res);
    assert.equal(res.statusCode, 500);
  } finally {
    process.env.GOOGLE_CLIENT_ID = original;
  }
});

test('POST /api/auth/google: token khong xac thuc duoc -> 401', async () => {
  const router = freshAuthRoutes({
    verifyGoogleIdToken: async () => { throw new Error('invalid_token'); },
    findUserByEmail: NEVER_CALL,
    createActiveGuest: NEVER_CALL
  });
  const handler = getRouteHandler(router, 'post', '/api/auth/google');
  const res = fakeRes();
  await handler({ body: { credential: 'bad-token' } }, res);
  assert.equal(res.statusCode, 401);
});

test('POST /api/auth/google: email Google chua xac minh -> 401', async () => {
  const router = freshAuthRoutes({
    verifyGoogleIdToken: async () => ({ email: 'a@gmail.com', emailVerified: false, name: 'A' }),
    findUserByEmail: NEVER_CALL,
    createActiveGuest: NEVER_CALL
  });
  const handler = getRouteHandler(router, 'post', '/api/auth/google');
  const res = fakeRes();
  await handler({ body: { credential: 'tok' } }, res);
  assert.equal(res.statusCode, 401);
});

test('POST /api/auth/google: email chua co -> tao Khach hoat dong va dang nhap ngay', async () => {
  let createdWith = null;
  const router = freshAuthRoutes({
    verifyGoogleIdToken: async () => ({ email: 'nguoimoi@gmail.com', emailVerified: true, name: 'Người Mới' }),
    findUserByEmail: async () => null,
    createActiveGuest: async args => { createdWith = args; }
  });
  const handler = getRouteHandler(router, 'post', '/api/auth/google');
  const res = fakeRes();
  await handler({ body: { credential: 'tok' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.vaiTro, 'Khách');
  assert.equal(createdWith.email, 'nguoimoi@gmail.com');
  assert.equal(createdWith.hoTen, 'Người Mới');
  assert.equal(res.cookies.length, 1);
});

test('POST /api/auth/google: tai khoan dang "Chờ duyệt" -> kich hoat thanh Khach', async () => {
  let createCalled = false;
  let activatedWith = null;
  const router = freshAuthRoutes({
    verifyGoogleIdToken: async () => ({ email: 'cho@gmail.com', emailVerified: true, name: 'Chờ' }),
    findUserByEmail: async () => ({ id: '1', username: 'cho@gmail.com', hoTen: 'Chờ', vaiTro: 'Trợ lý', coSo: '', trangThai: 'Chờ duyệt' }),
    createActiveGuest: async () => { createCalled = true; },
    activatePendingGuest: async args => { activatedWith = args; }
  });
  const handler = getRouteHandler(router, 'post', '/api/auth/google');
  const res = fakeRes();
  await handler({ body: { credential: 'tok' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.vaiTro, 'Khách');
  assert.equal(createCalled, false);
  assert.deepEqual(activatedWith, { email: 'cho@gmail.com', hoTen: 'Chờ' });
});

test('POST /api/auth/google: tai khoan bi khoa -> 403, khong co pending flag', async () => {
  const router = freshAuthRoutes({
    verifyGoogleIdToken: async () => ({ email: 'khoa@gmail.com', emailVerified: true, name: 'Khóa' }),
    findUserByEmail: async () => ({ id: '1', username: 'khoa@gmail.com', hoTen: 'Khóa', vaiTro: 'Trợ lý', coSo: '', trangThai: 'Khóa' }),
    createActiveGuest: NEVER_CALL
  });
  const handler = getRouteHandler(router, 'post', '/api/auth/google');
  const res = fakeRes();
  await handler({ body: { credential: 'tok' } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.pending, undefined);
});

test('POST /api/auth/google: tai khoan dang hoat dong -> 200, set cookie tks_auth, tra ve user (khong lo passwordHash)', async () => {
  const router = freshAuthRoutes({
    verifyGoogleIdToken: async () => ({ email: 'quanly@gmail.com', emailVerified: true, name: 'Quản Lý A' }),
    findUserByEmail: async () => ({
      id: '1', username: 'quanly@gmail.com', hoTen: 'Quản Lý A', vaiTro: 'Quản lý', coSo: 'Cả hai',
      trangThai: 'Đang hoạt động', passwordHash: 'khong-duoc-lo-ra'
    }),
    createActiveGuest: NEVER_CALL
  });
  const handler = getRouteHandler(router, 'post', '/api/auth/google');
  const res = fakeRes();
  await handler({ body: { credential: 'tok' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.username, 'quanly@gmail.com');
  assert.equal(res.body.vaiTro, 'Quản lý');
  assert.equal(res.body.passwordHash, undefined);
  assert.equal(res.cookies.length, 1);
  assert.equal(res.cookies[0].name, AUTH_COOKIE_NAME);
});

test('GET /api/auth/google-config: tra ve clientId da cau hinh', () => {
  const router = freshAuthRoutes({ verifyGoogleIdToken: NEVER_CALL, findUserByEmail: NEVER_CALL, createActiveGuest: NEVER_CALL });
  const handler = getRouteHandler(router, 'get', '/api/auth/google-config');
  const res = fakeRes();
  handler({}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.clientId, process.env.GOOGLE_CLIENT_ID);
});

test('GET /api/auth/google-config: chua cau hinh -> clientId null (de trang login an nut)', () => {
  const original = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = '';
  try {
    const router = freshAuthRoutes({ verifyGoogleIdToken: NEVER_CALL, findUserByEmail: NEVER_CALL, createActiveGuest: NEVER_CALL });
    const handler = getRouteHandler(router, 'get', '/api/auth/google-config');
    const res = fakeRes();
    handler({}, res);
    assert.equal(res.body.clientId, null);
  } finally {
    process.env.GOOGLE_CLIENT_ID = original;
  }
});
