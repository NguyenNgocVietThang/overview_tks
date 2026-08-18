'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const localUserStore = require('./localUserStore');
const adminUserRoutes = require('./adminUserRoutes');

const testDbPath = path.join(os.tmpdir(), `test-users-${Date.now()}.json`);
localUserStore.initStore(testDbPath);

test.after(() => {
  if (fs.existsSync(testDbPath)) {
    try { fs.unlinkSync(testDbPath); } catch (e) {}
  }
});

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = code => { res.statusCode = code; return res; };
  res.json = payload => { res.body = payload; return res; };
  return res;
}

function getRouteHandler(router, method, routePath) {
  const layer = router.stack.find(l => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`Không tìm thấy route: ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

test('Admin User Management: GET /api/admin/users trả về danh sách user không lộ passwordHash', async () => {
  const adminUser = {
    id: 'admin-1',
    username: 'admin',
    hoTen: 'Quản trị viên',
    email: 'admin@tokosi.vn',
    passwordHash: 'secret-hash',
    vaiTro: 'Quản lý',
    coSo: 'Cả hai',
    trangThai: 'Đang hoạt động',
    ngayTao: '01/01/2026',
    dangNhapGanNhat: ''
  };
  localUserStore.setInMemoryUsers([adminUser]);

  const handler = getRouteHandler(adminUserRoutes, 'get', '/api/admin/users');
  const req = { user: { id: 'admin-1', vaiTro: 'Quản lý' } };
  const res = fakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.users));
  assert.equal(res.body.users.length, 1);
  assert.equal(res.body.users[0].username, 'admin');
  assert.equal(res.body.users[0].passwordHash, undefined);
  assert.equal(res.body.users[0].hasPassword, true);
});

test('Admin User Management: POST /api/admin/users tạo user mới hợp lệ', async () => {
  localUserStore.setInMemoryUsers([]);

  const handler = getRouteHandler(adminUserRoutes, 'post', '/api/admin/users');
  const req = {
    user: { id: 'admin-1', vaiTro: 'Quản lý' },
    body: {
      username: 'ketoan_moi',
      password: 'Password123',
      hoTen: 'Kế Toán Mới',
      email: 'ketoan@tokosi.vn',
      vaiTro: 'Kế toán',
      coSo: 'An Khánh'
    }
  };
  const res = fakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.user.username, 'ketoan_moi');
  assert.equal(res.body.user.vaiTro, 'Kế toán');
  assert.equal(res.body.user.trangThai, 'Đang hoạt động');
});

test('Admin User Management: POST /api/admin/users từ chối mật khẩu ngắn hoặc vai trò không hợp lệ', async () => {
  const handler = getRouteHandler(adminUserRoutes, 'post', '/api/admin/users');
  const req = {
    user: { id: 'admin-1', vaiTro: 'Quản lý' },
    body: {
      username: 'user_ngan',
      password: '123',
      hoTen: 'Tên User',
      vaiTro: 'Kế toán'
    }
  };
  const res = fakeRes();

  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /8 ký tự/);
});

test('Admin User Management: PUT /api/admin/users/:id chặn Quản lý tự hạ quyền chính mình', async () => {
  const adminUser = {
    id: 'admin-1',
    username: 'admin',
    hoTen: 'Quản trị viên',
    email: 'admin@tokosi.vn',
    passwordHash: 'secret-hash',
    vaiTro: 'Quản lý',
    coSo: 'Cả hai',
    trangThai: 'Đang hoạt động',
    ngayTao: '01/01/2026'
  };
  localUserStore.setInMemoryUsers([adminUser]);

  const handler = getRouteHandler(adminUserRoutes, 'put', '/api/admin/users/:id');
  const req = {
    user: { id: 'admin-1', username: 'admin', vaiTro: 'Quản lý' },
    params: { id: 'admin-1' },
    body: {
      vaiTro: 'Khách' // Tự hạ quyền
    }
  };
  const res = fakeRes();

  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /tự hạ quyền/i);
});

test('Admin User Management: PUT /api/admin/users/:id chặn Quản lý tự khóa tài khoản của mình', async () => {
  const adminUser = {
    id: 'admin-1',
    username: 'admin',
    hoTen: 'Quản trị viên',
    email: 'admin@tokosi.vn',
    passwordHash: 'secret-hash',
    vaiTro: 'Quản lý',
    coSo: 'Cả hai',
    trangThai: 'Đang hoạt động',
    ngayTao: '01/01/2026'
  };
  localUserStore.setInMemoryUsers([adminUser]);

  const handler = getRouteHandler(adminUserRoutes, 'put', '/api/admin/users/:id');
  const req = {
    user: { id: 'admin-1', username: 'admin', vaiTro: 'Quản lý' },
    params: { id: 'admin-1' },
    body: {
      trangThai: 'Khóa'
    }
  };
  const res = fakeRes();

  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /tự khóa/i);
});

test('Admin User Management: DELETE /api/admin/users/:id chặn tự xóa chính mình', async () => {
  const adminUser = {
    id: 'admin-1',
    username: 'admin',
    hoTen: 'Quản trị viên',
    email: 'admin@tokosi.vn',
    passwordHash: 'secret-hash',
    vaiTro: 'Quản lý',
    coSo: 'Cả hai',
    trangThai: 'Đang hoạt động',
    ngayTao: '01/01/2026'
  };
  localUserStore.setInMemoryUsers([adminUser]);

  const handler = getRouteHandler(adminUserRoutes, 'delete', '/api/admin/users/:id');
  const req = {
    user: { id: 'admin-1', username: 'admin', vaiTro: 'Quản lý' },
    params: { id: 'admin-1' }
  };
  const res = fakeRes();

  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /tự xóa/i);
});

test('Admin User Management: POST /api/admin/users/:id/reset-password đặt lại mật khẩu thành công', async () => {
  const normalUser = {
    id: 'user-2',
    username: 'laixe1',
    hoTen: 'Lái Xe 1',
    email: 'laixe@tokosi.vn',
    passwordHash: 'old-hash',
    vaiTro: 'Lái xe',
    coSo: 'Tân Phú',
    trangThai: 'Đang hoạt động',
    ngayTao: '01/01/2026'
  };
  localUserStore.setInMemoryUsers([normalUser]);

  const handler = getRouteHandler(adminUserRoutes, 'post', '/api/admin/users/:id/reset-password');
  const req = {
    user: { id: 'admin-1', username: 'admin', vaiTro: 'Quản lý' },
    params: { id: 'user-2' },
    body: {
      newPassword: 'NewPassword999'
    }
  };
  const res = fakeRes();

  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);

  const updated = await localUserStore.getUserById('user-2');
  assert.notEqual(updated.passwordHash, 'old-hash');
});
