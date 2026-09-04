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
 * Chay TOAN BO middleware stack cua 1 route (vd forgotPasswordRateLimit ->
 * handler chinh), khac voi getRouteHandler chi lay handler cuoi cung. Can
 * dung cho cac route co gan middleware (rate limit) truoc handler chinh.
 */
function getRouteStack(router, method, routePath) {
  const layer = router.stack.find(l => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`Không tìm thấy route: ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack.map(l => l.handle);
}

async function callRoute(router, method, routePath, req, res) {
  const stack = getRouteStack(router, method, routePath);
  for (const handle of stack) {
    let calledNext = false;
    await handle(req, res, () => { calledNext = true; });
    if (!calledNext) break;
  }
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
  findActiveUserByUsername = async () => null,
  findUserByIdentifier = async () => null,
  createActiveGuest,
  activatePendingGuest = async () => {},
  updateUserFields = async (id, fields) => ({ id, ...fields, trangThai: 'Đang hoạt động' })
}) {
  ['./authRoutes', './googleAuthService', './userRepository', './userWriteRepository', './otpService', '../config']
    .forEach(id => { delete require.cache[require.resolve(id)]; });

  const googleAuthService = require('./googleAuthService');
  googleAuthService.verifyGoogleIdToken = verifyGoogleIdToken;

  const userRepository = require('./userRepository');
  userRepository.findUserByEmail = findUserByEmail;
  userRepository.findUserByUsername = findUserByUsername;
  userRepository.findActiveUserByUsername = findActiveUserByUsername;
  userRepository.findUserByIdentifier = findUserByIdentifier;

  const userWriteRepository = require('./userWriteRepository');
  userWriteRepository.createActiveGuest = createActiveGuest;
  userWriteRepository.activatePendingGuest = activatePendingGuest;
  userWriteRepository.updateUserFields = updateUserFields;

  const emailSender = require('../notifications/emailSender');
  emailSender.isConfigured = () => false;
  const smsSender = require('../notifications/smsSender');
  smsSender.isConfigured = () => false;

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

test('POST /api/auth/register: dang ky bang so dien thoai hop le', async () => {
  let createdWith = null;
  const router = freshAuthRoutes({
    verifyGoogleIdToken: NEVER_CALL,
    findUserByEmail: async () => null,
    findUserByUsername: async () => null,
    createActiveGuest: async args => { createdWith = args; }
  });
  const handler = getRouteHandler(router, 'post', '/api/auth/register');
  const res = fakeRes();
  await handler({ body: { hoTen: 'Khách Phone', soDienThoai: '0912345678', password: 'Password123' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.username, '0912345678');
  assert.equal(res.body.vaiTro, 'Khách');
  assert.equal(createdWith.soDienThoai, '0912345678');
  assert.equal(res.cookies.length, 1);
});

test('POST /api/auth/register: so dien thoai khong hop le -> 400', async () => {
  const router = freshAuthRoutes({
    verifyGoogleIdToken: NEVER_CALL,
    findUserByEmail: NEVER_CALL,
    createActiveGuest: NEVER_CALL
  });
  const handler = getRouteHandler(router, 'post', '/api/auth/register');
  const res = fakeRes();
  await handler({ body: { hoTen: 'A', soDienThoai: '123', password: 'Password123' } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Số điện thoại không hợp lệ/);
});

test('POST /api/auth/login: nhap sai 5 lan -> 423 Locked kem lockoutRemainingSeconds va suggestReset', async () => {
  const router = freshAuthRoutes({
    verifyGoogleIdToken: NEVER_CALL,
    findUserByEmail: NEVER_CALL,
    createActiveGuest: NEVER_CALL
  });
  const { clearFailedLogins } = require('./authRoutes');
  clearFailedLogins('lockoutuser');

  const userRepository = require('./userRepository');
  userRepository.findActiveUserByUsername = async () => null; // User khong ton tai hoac sai pass

  const handler = getRouteHandler(router, 'post', '/api/auth/login');

  // 4 lan dau -> 401
  for (let i = 0; i < 4; i++) {
    const res = fakeRes();
    await handler({ body: { username: 'lockoutuser', password: 'wrongpassword' } }, res);
    assert.equal(res.statusCode, 401);
  }

  // Lan 5 -> 423
  const res5 = fakeRes();
  await handler({ body: { username: 'lockoutuser', password: 'wrongpassword' } }, res5);
  assert.equal(res5.statusCode, 423);
  assert.equal(res5.body.locked, true);
  assert.equal(res5.body.suggestReset, true);
  assert.ok(res5.body.lockoutRemainingSeconds > 0);

  clearFailedLogins('lockoutuser');
});

test('POST /api/auth/google: cap nhat ten va email vao tai khoan nguoi dung', async () => {
  let updatedFields = null;
  const router = freshAuthRoutes({
    verifyGoogleIdToken: async () => ({ email: 'existing@gmail.com', emailVerified: true, name: 'Nguyễn Văn A' }),
    findUserByEmail: async () => ({
      id: 'user-123',
      username: 'existing@gmail.com',
      hoTen: 'existing@gmail.com',
      email: '',
      vaiTro: 'Khách',
      coSo: '',
      trangThai: 'Đang hoạt động'
    }),
    createActiveGuest: NEVER_CALL,
    updateUserFields: async (id, fields) => {
      updatedFields = fields;
      return { id, username: 'existing@gmail.com', hoTen: fields.hoTen, email: fields.email, vaiTro: 'Khách', coSo: '', trangThai: 'Đang hoạt động' };
    }
  });

  const handler = getRouteHandler(router, 'post', '/api/auth/google');
  const res = fakeRes();
  await handler({ body: { credential: 'tok' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.email, 'existing@gmail.com');
  assert.equal(res.body.hoTen, 'Nguyễn Văn A');
  assert.equal(updatedFields.email, 'existing@gmail.com');
  assert.equal(updatedFields.hoTen, 'Nguyễn Văn A');
  assert.ok(updatedFields.dangNhapGanNhat);
});

test('POST /api/auth/login: tu dong cap nhat email neu dang nhap bang email ma truong email rong', async () => {
  let updatedFields = null;
  const { hashPassword } = require('./authService');
  const hashedPassword = await hashPassword('password123');

  const router = freshAuthRoutes({
    verifyGoogleIdToken: NEVER_CALL,
    findUserByEmail: NEVER_CALL,
    createActiveGuest: NEVER_CALL,
    findActiveUserByUsername: async () => ({
      id: 'user-456',
      username: 'user_email@domain.com',
      hoTen: 'Người Dùng',
      email: '',
      passwordHash: hashedPassword,
      vaiTro: 'Khách',
      coSo: '',
      trangThai: 'Đang hoạt động'
    }),
    updateUserFields: async (id, fields) => {
      updatedFields = fields;
      return { id, username: 'user_email@domain.com', hoTen: 'Người Dùng', email: fields.email, vaiTro: 'Khách', coSo: '', trangThai: 'Đang hoạt động' };
    }
  });

  const handler = getRouteHandler(router, 'post', '/api/auth/login');
  const res = fakeRes();
  await handler({ body: { username: 'user_email@domain.com', password: 'password123' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.email, 'user_email@domain.com');
  assert.equal(updatedFields.email, 'user_email@domain.com');
  assert.ok(updatedFields.dangNhapGanNhat);
});

test('POST /api/auth/login: tai khoan Không hoạt động dang nhap duoc va chuyen thanh Đang hoạt động', async () => {
  let updatedFields = null;
  const { hashPassword } = require('./authService');
  const hashedPassword = await hashPassword('password123');

  const router = freshAuthRoutes({
    verifyGoogleIdToken: NEVER_CALL,
    findUserByEmail: NEVER_CALL,
    createActiveGuest: NEVER_CALL,
    findActiveUserByUsername: async () => ({
      id: 'user-inactive',
      username: 'inactive_user',
      hoTen: 'Người Dùng Inactive',
      email: 'inactive@tokosi.vn',
      passwordHash: hashedPassword,
      vaiTro: 'Kế toán',
      coSo: 'Hà Nội',
      trangThai: 'Không hoạt động'
    }),
    updateUserFields: async (id, fields) => {
      updatedFields = fields;
      return { id, username: 'inactive_user', hoTen: 'Người Dùng Inactive', email: 'inactive@tokosi.vn', vaiTro: 'Kế toán', coSo: 'Hà Nội', ...fields };
    }
  });

  const handler = getRouteHandler(router, 'post', '/api/auth/login');
  const res = fakeRes();
  await handler({ body: { username: 'inactive_user', password: 'password123' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(updatedFields.trangThai, 'Đang hoạt động');
  assert.ok(updatedFields.dangNhapGanNhat);
});

test('POST /api/auth/google: thangnnv2003@gmail.com mac dinh nhan quyen Quan ly khi tao moi', async () => {
  let createdWith = null;
  const router = freshAuthRoutes({
    verifyGoogleIdToken: async () => ({ email: 'thangnnv2003@gmail.com', emailVerified: true, name: 'Nguyễn Ngọc Việt Thắng' }),
    findUserByEmail: async () => null,
    createActiveGuest: async args => {
      createdWith = args;
      return {
        id: 'thang-id',
        username: args.username,
        hoTen: args.hoTen,
        email: args.email,
        vaiTro: args.vaiTro || 'Quản lý',
        coSo: 'Cả hai',
        trangThai: 'Đang hoạt động'
      };
    }
  });

  const handler = getRouteHandler(router, 'post', '/api/auth/google');
  const res = fakeRes();
  await handler({ body: { credential: 'tok' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.email, 'thangnnv2003@gmail.com');
  assert.equal(res.body.vaiTro, 'Quản lý');
  assert.equal(createdWith.vaiTro, 'Quản lý');
});

test('POST /api/auth/google: thangnnv2003@gmail.com ton tai tu truoc duoc tu dong nang/giu quyen Quan ly', async () => {
  let updatedFields = null;
  const router = freshAuthRoutes({
    verifyGoogleIdToken: async () => ({ email: 'thangnnv2003@gmail.com', emailVerified: true, name: 'Nguyễn Ngọc Việt Thắng' }),
    findUserByEmail: async () => ({
      id: 'thang-id',
      username: 'thangnnv2003@gmail.com',
      hoTen: 'Nguyễn Ngọc Việt Thắng',
      email: 'thangnnv2003@gmail.com',
      vaiTro: 'Khách',
      coSo: '',
      trangThai: 'Đang hoạt động'
    }),
    createActiveGuest: NEVER_CALL,
    updateUserFields: async (id, fields) => {
      updatedFields = fields;
      return {
        id,
        username: 'thangnnv2003@gmail.com',
        hoTen: 'Nguyễn Ngọc Việt Thắng',
        email: 'thangnnv2003@gmail.com',
        vaiTro: fields.vaiTro || 'Quản lý',
        coSo: 'Cả hai',
        trangThai: 'Đang hoạt động'
      };
    }
  });

  const handler = getRouteHandler(router, 'post', '/api/auth/google');
  const res = fakeRes();
  await handler({ body: { credential: 'tok' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.vaiTro, 'Quản lý');
  assert.equal(updatedFields.vaiTro, 'Quản lý');
  assert.equal(updatedFields.trangThai, 'Đang hoạt động');
});

test('POST /api/auth/register: dang ky bang thangnnv2003@gmail.com duoc gan quyen Quan ly', async () => {
  let createdWith = null;
  const router = freshAuthRoutes({
    verifyGoogleIdToken: NEVER_CALL,
    findUserByEmail: async () => null,
    findUserByUsername: async () => null,
    createActiveGuest: async args => { createdWith = args; }
  });
  const handler = getRouteHandler(router, 'post', '/api/auth/register');
  const res = fakeRes();
  await handler({ body: { hoTen: 'Thắng', email: 'thangnnv2003@gmail.com', password: 'Password123' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.vaiTro, 'Quản lý');
  assert.equal(createdWith.vaiTro, 'Quản lý');
});

// -------------------------------------------------------------
// FORGOT PASSWORD / OTP — chong user enumeration, khong lo OTP, rate limit
// -------------------------------------------------------------

test('POST /api/auth/forgot-password/channels: tai khoan khong ton tai van tra ve 200 kem kenh gia (chong enumeration)', async () => {
  const router = freshAuthRoutes({
    verifyGoogleIdToken: NEVER_CALL,
    findUserByEmail: NEVER_CALL,
    createActiveGuest: NEVER_CALL,
    findUserByIdentifier: async () => null
  });
  const res = fakeRes();
  await callRoute(router, 'post', '/api/auth/forgot-password/channels', { body: { identifier: 'khong-ton-tai' } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.channels) && res.body.channels.length > 0);
  assert.equal(res.body.channels[0].targetRaw, null);
});

test('POST /api/auth/forgot-password/channels: tai khoan ton tai tra ve 200 kem kenh that, cung shape voi tai khoan gia', async () => {
  const router = freshAuthRoutes({
    verifyGoogleIdToken: NEVER_CALL,
    findUserByEmail: NEVER_CALL,
    createActiveGuest: NEVER_CALL,
    findUserByIdentifier: async () => ({ username: 'user1', email: 'user1@example.com' })
  });
  const res = fakeRes();
  await callRoute(router, 'post', '/api/auth/forgot-password/channels', { body: { identifier: 'user1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.channels) && res.body.channels.length > 0);
  assert.equal(res.body.channels[0].channel, 'email');
});

test('POST /api/auth/forgot-password/send-otp: tai khoan khong ton tai tra ve 200 gia, khong lo devCode/code', async () => {
  const router = freshAuthRoutes({
    verifyGoogleIdToken: NEVER_CALL,
    findUserByEmail: NEVER_CALL,
    createActiveGuest: NEVER_CALL,
    findUserByIdentifier: async () => null
  });
  const res = fakeRes();
  await callRoute(router, 'post', '/api/auth/forgot-password/send-otp', { body: { identifier: 'khong-ton-tai', channel: 'email' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.devCode, undefined);
  assert.equal(res.body.code, undefined);
});

test('POST /api/auth/forgot-password/send-otp: tai khoan that tra ve 200, khong lo devCode/code trong response', async () => {
  const router = freshAuthRoutes({
    verifyGoogleIdToken: NEVER_CALL,
    findUserByEmail: NEVER_CALL,
    createActiveGuest: NEVER_CALL,
    findUserByIdentifier: async () => ({ username: 'user1', email: 'user1@example.com' })
  });
  const res = fakeRes();
  await callRoute(router, 'post', '/api/auth/forgot-password/send-otp', { body: { identifier: 'user1', channel: 'email' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.devCode, undefined);
  assert.equal(res.body.code, undefined);
  assert.equal('devCode' in res.body, false);
});

test('POST /api/auth/forgot-password/verify: tai khoan khong ton tai tra ve 400 giong OTP sai/het han (khong phai 404)', async () => {
  const router = freshAuthRoutes({
    verifyGoogleIdToken: NEVER_CALL,
    findUserByEmail: NEVER_CALL,
    createActiveGuest: NEVER_CALL,
    findUserByIdentifier: async () => null
  });
  const res = fakeRes();
  await callRoute(router, 'post', '/api/auth/forgot-password/verify', { body: { identifier: 'khong-ton-tai', otp: '123456', newPassword: 'MatKhauMoi123' } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Mã OTP không tồn tại hoặc đã hết hạn/);
});

test('POST /api/auth/forgot-password/send-otp: goi lien tuc vuot nguong bi chan 429', async () => {
  const router = freshAuthRoutes({
    verifyGoogleIdToken: NEVER_CALL,
    findUserByEmail: NEVER_CALL,
    createActiveGuest: NEVER_CALL,
    findUserByIdentifier: async () => null
  });
  let sawRateLimited = false;
  for (let i = 0; i < 30; i++) {
    const res = fakeRes();
    await callRoute(router, 'post', '/api/auth/forgot-password/send-otp', { body: { identifier: 'spam-target', channel: 'email' } }, res);
    if (res.statusCode === 429) { sawRateLimited = true; break; }
  }
  assert.equal(sawRateLimited, true);
});


