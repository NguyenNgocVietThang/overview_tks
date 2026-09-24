'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const localUserStore = require('./localUserStore');
const employeeDirectory = require('../hr/employeeDirectory');
const adminUserRoutes = require('./adminUserRoutes');
const { createFakeAppUsersRepository } = require('./testHelpers/fakeAppUsersRepository');

// appUsersRepository that (Postgres) can vao SUPABASE_DB_URL — test dung
// repository gia trong bo nho de createUser/updateUser/deleteUser khong can
// ket noi CSDL that. setInMemoryUsers() seed du lieu vao ca cache va repo gia.
localUserStore.initStore(null, { repository: createFakeAppUsersRepository() });

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

test('Admin User Management: exposes HR source and persistent override metadata', async () => {
  localUserStore.setInMemoryUsers([{
    id: 'u1', username: 'a@example.com', hoTen: 'A', email: 'a@example.com',
    vaiTro: 'Trợ lý', coSo: 'Hà Nội', trangThai: 'Đang hoạt động', hrManaged: true,
    sheetVaiTro: 'Kế toán', sheetCoSo: 'Cả hai', vaiTroOverride: 'Trợ lý',
    coSoOverride: 'Hà Nội', roleSource: 'override', hrSourceBranch: 'Hà Nội'
  }]);
  const res = fakeRes();
  await getRouteHandler(adminUserRoutes, 'get', '/api/admin/users')({ user: { id: 'admin', vaiTro: 'Quản lý' } }, res);
  const user = res.body.users[0];
  assert.equal(user.hrManaged, true);
  assert.equal(user.sheetVaiTro, 'Kế toán');
  assert.equal(user.vaiTroOverride, 'Trợ lý');
  assert.equal(user.coSoOverride, 'Hà Nội');
  assert.equal(user.roleSource, 'override');
});

test('Admin User Management: sets and independently clears HR role and branch overrides', async () => {
  localUserStore.setInMemoryUsers([{
    id: 'u1', username: 'a@example.com', hoTen: 'A', email: 'a@example.com',
    vaiTro: 'Kế toán', coSo: 'Cả hai', trangThai: 'Đang hoạt động', hrManaged: true,
    sheetVaiTro: 'Kế toán', sheetCoSo: 'Cả hai'
  }]);
  const handler = getRouteHandler(adminUserRoutes, 'put', '/api/admin/users/:id');
  let res = fakeRes();
  await handler({
    user: { id: 'admin', username: 'admin', vaiTro: 'Quản lý' }, params: { id: 'u1' },
    body: { vaiTroOverride: 'Trợ lý', coSoOverride: 'Hà Nội' }
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.vaiTro, 'Trợ lý');
  assert.equal(res.body.user.coSo, 'Hà Nội');

  res = fakeRes();
  await handler({
    user: { id: 'admin', username: 'admin', vaiTro: 'Quản lý' }, params: { id: 'u1' },
    body: { vaiTroOverride: null, coSoOverride: null }
  }, res);
  assert.equal(res.body.user.vaiTro, 'Kế toán');
  assert.equal(res.body.user.coSo, 'Cả hai');
  assert.equal(res.body.user.vaiTroOverride, '');
  assert.equal(res.body.user.coSoOverride, '');
});

test('Admin User Management: editing vaiTro directly on an hrManaged user makes it sticky via override and syncs the sheet', async () => {
  localUserStore.setInMemoryUsers([{
    id: 'u1', username: 'a@example.com', hoTen: 'A', email: 'a@example.com',
    vaiTro: 'Kế toán', coSo: 'Cả hai', trangThai: 'Đang hoạt động', hrManaged: true,
    sheetVaiTro: 'Kế toán', sheetCoSo: 'Cả hai', hrSourceBranch: 'Hà Nội', hrRowIndex: 5
  }]);

  const originalWrite = employeeDirectory.writeDepartmentForRole;
  const calls = [];
  employeeDirectory.writeDepartmentForRole = async (branch, rowIndex, role) => {
    calls.push({ branch, rowIndex, role });
    return true;
  };
  try {
    const handler = getRouteHandler(adminUserRoutes, 'put', '/api/admin/users/:id');
    const res = fakeRes();
    await handler({
      user: { id: 'admin', username: 'admin', vaiTro: 'Quản lý' }, params: { id: 'u1' },
      body: { vaiTro: 'Trợ lý' }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.user.vaiTro, 'Trợ lý');
    // Vai trò phải "dính" qua override, không để resolveUser() tính lại từ sheet ở lần sau.
    assert.equal(res.body.user.roleSource, 'override');
    assert.deepEqual(calls, [{ branch: 'Hà Nội', rowIndex: 5, role: 'Trợ lý' }]);
  } finally {
    employeeDirectory.writeDepartmentForRole = originalWrite;
  }
});

test('Admin User Management: PUT still succeeds even if the best-effort sheet sync fails', async () => {
  localUserStore.setInMemoryUsers([{
    id: 'u1', username: 'a@example.com', hoTen: 'A', email: 'a@example.com',
    vaiTro: 'Kế toán', coSo: 'Cả hai', trangThai: 'Đang hoạt động', hrManaged: true,
    sheetVaiTro: 'Kế toán', sheetCoSo: 'Cả hai', hrSourceBranch: 'Hà Nội', hrRowIndex: 5
  }]);

  const originalWrite = employeeDirectory.writeDepartmentForRole;
  employeeDirectory.writeDepartmentForRole = async () => { throw new Error('sheet unreachable'); };
  try {
    const handler = getRouteHandler(adminUserRoutes, 'put', '/api/admin/users/:id');
    const res = fakeRes();
    await handler({
      user: { id: 'admin', username: 'admin', vaiTro: 'Quản lý' }, params: { id: 'u1' },
      body: { vaiTro: 'Trợ lý' }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.user.vaiTro, 'Trợ lý');
  } finally {
    employeeDirectory.writeDepartmentForRole = originalWrite;
  }
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

test('Admin User Management: POST /api/admin/users từ chối cơ sở không hợp lệ', async () => {
  localUserStore.setInMemoryUsers([]);

  const handler = getRouteHandler(adminUserRoutes, 'post', '/api/admin/users');
  const req = {
    user: { id: 'admin-1', vaiTro: 'Quản lý' },
    body: {
      username: 'nv_sai_coso',
      password: 'MatKhau@123',
      hoTen: 'Nhân viên',
      vaiTro: 'Kế toán',
      coSo: 'Đà Nẵng'
    }
  };
  const res = fakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Cơ sở phụ trách không hợp lệ/);
});

test('Admin User Management: POST /api/admin/users tự đổi tên cơ sở cũ sang tên mới', async () => {
  localUserStore.setInMemoryUsers([]);

  const handler = getRouteHandler(adminUserRoutes, 'post', '/api/admin/users');
  const req = {
    user: { id: 'admin-1', vaiTro: 'Quản lý' },
    body: {
      username: 'nv_an_khanh',
      password: 'MatKhau@123',
      hoTen: 'Nhân viên An Khánh',
      vaiTro: 'Kế toán',
      coSo: 'An Khánh'
    }
  };
  const res = fakeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.user.coSo, 'Hà Nội');
});

test('Admin User Management: POST /api/admin/users tạo user với các vai trò mới thành công', async () => {
  localUserStore.setInMemoryUsers([]);

  const newRoles = ['Nhân viên kho', 'Nhân viên sale', 'Nhân viên mua hàng'];
  for (const role of newRoles) {
    const handler = getRouteHandler(adminUserRoutes, 'post', '/api/admin/users');
    const req = {
      user: { id: 'admin-1', vaiTro: 'Quản lý' },
      body: {
        username: `user_${role.replace(/\s+/g, '_').toLowerCase()}`,
        password: 'Password@123',
        hoTen: `Họ tên ${role}`,
        vaiTro: role,
        coSo: 'Hà Nội'
      }
    };
    const res = fakeRes();
    await handler(req, res);

    assert.equal(res.statusCode, 201, `Tạo tài khoản với vai trò ${role} thất bại`);
    assert.equal(res.body.user.vaiTro, role);
  }
});

test('Super Admin Protection: DELETE /api/admin/users/:id chặn xóa tài khoản thangnnv2003@gmail.com', async () => {
  const thangUser = {
    id: 'thang-id',
    username: 'thangnnv2003@gmail.com',
    hoTen: 'Nguyễn Ngọc Việt Thắng',
    email: 'thangnnv2003@gmail.com',
    vaiTro: 'Quản lý',
    coSo: 'Cả hai',
    trangThai: 'Đang hoạt động',
    ngayTao: '01/01/2026'
  };
  localUserStore.setInMemoryUsers([thangUser]);

  const handler = getRouteHandler(adminUserRoutes, 'delete', '/api/admin/users/:id');
  const req = {
    user: { id: 'other-admin', username: 'admin2', vaiTro: 'Quản lý' },
    params: { id: 'thang-id' }
  };
  const res = fakeRes();

  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Không ai có quyền xóa tài khoản thangnnv2003@gmail\.com/);
});

test('Super Admin Protection: PUT /api/admin/users/:id chặn hạ quyền tài khoản thangnnv2003@gmail.com', async () => {
  const thangUser = {
    id: 'thang-id',
    username: 'thangnnv2003@gmail.com',
    hoTen: 'Nguyễn Ngọc Việt Thắng',
    email: 'thangnnv2003@gmail.com',
    vaiTro: 'Quản lý',
    coSo: 'Cả hai',
    trangThai: 'Đang hoạt động',
    ngayTao: '01/01/2026'
  };
  localUserStore.setInMemoryUsers([thangUser]);

  const handler = getRouteHandler(adminUserRoutes, 'put', '/api/admin/users/:id');
  const req = {
    user: { id: 'other-admin', username: 'admin2', vaiTro: 'Quản lý' },
    params: { id: 'thang-id' },
    body: { vaiTro: 'Kế toán' }
  };
  const res = fakeRes();

  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Không ai có quyền hạ quyền/);
});

test('Super Admin Protection: PUT /api/admin/users/:id chặn khóa tài khoản thangnnv2003@gmail.com', async () => {
  const thangUser = {
    id: 'thang-id',
    username: 'thangnnv2003@gmail.com',
    hoTen: 'Nguyễn Ngọc Việt Thắng',
    email: 'thangnnv2003@gmail.com',
    vaiTro: 'Quản lý',
    coSo: 'Cả hai',
    trangThai: 'Đang hoạt động',
    ngayTao: '01/01/2026'
  };
  localUserStore.setInMemoryUsers([thangUser]);

  const handler = getRouteHandler(adminUserRoutes, 'put', '/api/admin/users/:id');
  const req = {
    user: { id: 'other-admin', username: 'admin2', vaiTro: 'Quản lý' },
    params: { id: 'thang-id' },
    body: { trangThai: 'Khóa' }
  };
  const res = fakeRes();

  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Không ai có quyền khóa/);
});

test('User Status & Deletion: Cho phép trạng thái Không hoạt động và loại trừ user đã xóa', async () => {
  const activeUser = {
    id: 'u-1',
    username: 'user1',
    hoTen: 'User 1',
    vaiTro: 'Kế toán',
    coSo: 'Hà Nội',
    trangThai: 'Đang hoạt động',
    ngayTao: '01/01/2026'
  };
  const inactiveUser = {
    id: 'u-2',
    username: 'user2',
    hoTen: 'User 2',
    vaiTro: 'Lái xe',
    coSo: 'Sài Gòn',
    trangThai: 'Không hoạt động',
    ngayTao: '01/01/2026'
  };
  const userToDelete = {
    id: 'u-3',
    username: 'user3',
    hoTen: 'User 3',
    vaiTro: 'Khách',
    coSo: '',
    trangThai: 'Đang hoạt động',
    ngayTao: '01/01/2026'
  };
  localUserStore.setInMemoryUsers([activeUser, inactiveUser, userToDelete]);

  // Xóa u-3
  const deleteHandler = getRouteHandler(adminUserRoutes, 'delete', '/api/admin/users/:id');
  const delReq = {
    user: { id: 'admin-1', username: 'admin', vaiTro: 'Quản lý' },
    params: { id: 'u-3' }
  };
  const delRes = fakeRes();
  await deleteHandler(delReq, delRes);
  assert.equal(delRes.statusCode, 200);

  // Lấy danh sách qua GET /api/admin/users
  const getHandler = getRouteHandler(adminUserRoutes, 'get', '/api/admin/users');
  const getReq = { user: { id: 'admin-1', vaiTro: 'Quản lý' } };
  const getRes = fakeRes();
  await getHandler(getReq, getRes);

  assert.equal(getRes.statusCode, 200);
  const returnedUsernames = getRes.body.users.map(u => u.username);
  assert.ok(returnedUsernames.includes('user1'));
  assert.ok(returnedUsernames.includes('user2'));
  assert.ok(!returnedUsernames.includes('user3')); // u-3 đã bị xóa, không hiện
  assert.equal(getRes.body.users.find(u => u.username === 'user2').trangThai, 'Không hoạt động');
});

function getRouteMiddlewareStack(router, method, routePath) {
  const layer = router.stack.find(l => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`Không tìm thấy route: ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack.map(l => l.handle);
}

test('Phan quyen xem: GET /api/admin/users cho phep moi vai tro noi bo, chan Khach', () => {
  const stack = getRouteMiddlewareStack(adminUserRoutes, 'get', '/api/admin/users');
  const roleGuard = stack[stack.length - 2];
  const internalRoles = ['Quản lý', 'Kế toán', 'Trưởng kho', 'Trợ lý', 'Lái xe', 'Nhân viên kho', 'Nhân viên sale', 'Nhân viên mua hàng'];

  for (const role of internalRoles) {
    const req = { user: { vaiTro: role } };
    const res = fakeRes();
    let nextCalled = false;
    roleGuard(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true, `Vai tro ${role} phai xem duoc danh sach nguoi dung`);
  }

  const req = { user: { vaiTro: 'Khách' } };
  const res = fakeRes();
  let nextCalled = false;
  roleGuard(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test('Phan quyen ghi: POST/PUT/DELETE/reset-password chi Quan ly moi duoc phep', () => {
  const mutatingRoutes = [
    ['post', '/api/admin/users'],
    ['put', '/api/admin/users/:id'],
    ['post', '/api/admin/users/:id/reset-password'],
    ['delete', '/api/admin/users/:id']
  ];

  for (const [method, routePath] of mutatingRoutes) {
    const stack = getRouteMiddlewareStack(adminUserRoutes, method, routePath);
    const roleGuard = stack[stack.length - 2];

    const blockedReq = { user: { vaiTro: 'Kế toán' } };
    const blockedRes = fakeRes();
    let blockedNext = false;
    roleGuard(blockedReq, blockedRes, () => { blockedNext = true; });
    assert.equal(blockedNext, false, `${method.toUpperCase()} ${routePath} khong duoc chan Ke toan`);
    assert.equal(blockedRes.statusCode, 403);

    const allowedReq = { user: { vaiTro: 'Quản lý' } };
    const allowedRes = fakeRes();
    let allowedNext = false;
    roleGuard(allowedReq, allowedRes, () => { allowedNext = true; });
    assert.equal(allowedNext, true, `${method.toUpperCase()} ${routePath} phai cho phep Quan ly`);
  }
});

// ---------------------------------------------------------------------------
// PHAN QUYEN CHI TIET THEO TUNG TAI KHOAN
// ---------------------------------------------------------------------------

const featureRegistry = require('./featureRegistry');

function manager(id = 'admin-1', username = 'manager') {
  return { id, username, hoTen: 'Quản lý', vaiTro: 'Quản lý' };
}

test('GET /api/admin/permissions/catalog tra ve danh muc + mac dinh theo vai tro', async () => {
  localUserStore.setInMemoryUsers([]);
  const handler = getRouteHandler(adminUserRoutes, 'get', '/api/admin/permissions/catalog');
  const res = fakeRes();
  await handler({ user: manager() }, res);

  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.groups) && res.body.groups.length > 0);
  assert.equal(res.body.features.length, featureRegistry.FEATURE_KEYS.length);
  assert.ok(res.body.features.every(f => f.key && f.label && f.groupKey));
  assert.deepEqual(res.body.roleDefaults['Nhân viên marketing'], res.body.roleDefaults['Nhân viên sale']);
  assert.ok(res.body.features.find(f => f.key === 'account.profile').alwaysOn);
});

test('GET /api/admin/users/:id/permissions tra ve mac dinh, ghi de va hieu luc', async () => {
  localUserStore.setInMemoryUsers([
    { id: 'u1', username: 'ketoan', hoTen: 'Kế toán', vaiTro: 'Kế toán', trangThai: 'Đang hoạt động',
      featurePermissions: { 'reports.overview': true } }
  ]);
  const handler = getRouteHandler(adminUserRoutes, 'get', '/api/admin/users/:id/permissions');
  const res = fakeRes();
  await handler({ user: manager(), params: { id: 'u1' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.vaiTro, 'Kế toán');
  assert.ok(!res.body.defaults.includes('reports.overview'), 'mac dinh cua Ke toan khong co bao cao');
  assert.deepEqual(res.body.overrides, { 'reports.overview': true });
  assert.ok(res.body.effective.includes('reports.overview'), 'quyen hieu luc da tinh ghi de');
});

test('PUT /api/admin/users/:id/permissions luu ghi de va tra ve trang thai moi', async () => {
  localUserStore.setInMemoryUsers([
    { id: 'u1', username: 'troly', hoTen: 'Trợ lý', vaiTro: 'Trợ lý', trangThai: 'Đang hoạt động' }
  ]);
  const handler = getRouteHandler(adminUserRoutes, 'put', '/api/admin/users/:id/permissions');
  const res = fakeRes();
  await handler({ user: manager(), params: { id: 'u1' }, body: { overrides: { 'reports.debt': false } } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.overrides, { 'reports.debt': false });
  assert.ok(!res.body.effective.includes('reports.debt'));

  const saved = await localUserStore.getUserById('u1');
  assert.deepEqual(saved.featurePermissions, { 'reports.debt': false });
});

test('PUT /api/admin/users/:id/permissions: gui object rong = xoa het ghi de', async () => {
  localUserStore.setInMemoryUsers([
    { id: 'u1', username: 'troly', vaiTro: 'Trợ lý', trangThai: 'Đang hoạt động',
      featurePermissions: { 'reports.debt': false } }
  ]);
  const handler = getRouteHandler(adminUserRoutes, 'put', '/api/admin/users/:id/permissions');
  const res = fakeRes();
  await handler({ user: manager(), params: { id: 'u1' }, body: { overrides: {} } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.overrides, {});
  assert.ok(res.body.effective.includes('reports.debt'), 'quay ve mac dinh cua vai tro');
});

test('PUT /api/admin/users/:id/permissions tu choi key khong ton tai', async () => {
  localUserStore.setInMemoryUsers([{ id: 'u1', username: 'troly', vaiTro: 'Trợ lý', trangThai: 'Đang hoạt động' }]);
  const handler = getRouteHandler(adminUserRoutes, 'put', '/api/admin/users/:id/permissions');
  const res = fakeRes();
  await handler({ user: manager(), params: { id: 'u1' }, body: { overrides: { 'khong.ton.tai': true } } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'UNKNOWN_FEATURE');
  assert.match(res.body.error, /khong\.ton\.tai/);
});

test('PUT /api/admin/users/:id/permissions chan sua quyen cua Quan tri vien he thong', async () => {
  localUserStore.setInMemoryUsers([
    { id: 'sa', username: 'thangnnv2003@gmail.com', email: 'thangnnv2003@gmail.com',
      vaiTro: 'Quản lý', trangThai: 'Đang hoạt động' }
  ]);
  const handler = getRouteHandler(adminUserRoutes, 'put', '/api/admin/users/:id/permissions');
  const res = fakeRes();
  await handler({ user: manager(), params: { id: 'sa' }, body: { overrides: { 'reports.debt': false } } }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Quản trị viên hệ thống/);
});

test('PUT /api/admin/users/:id/permissions chan TU THU HOI quyen quan tri cua chinh minh', async () => {
  localUserStore.setInMemoryUsers([
    { id: 'admin-1', username: 'manager', vaiTro: 'Quản lý', trangThai: 'Đang hoạt động' }
  ]);
  const handler = getRouteHandler(adminUserRoutes, 'put', '/api/admin/users/:id/permissions');

  for (const key of ['account.permissions', 'account.users.manage']) {
    const res = fakeRes();
    await handler({ user: manager(), params: { id: 'admin-1' }, body: { overrides: { [key]: false } } }, res);
    assert.equal(res.statusCode, 400, key);
    assert.match(res.body.error, /chính mình/);
  }

  // Tu CAP them quyen cho chinh minh thi van duoc.
  const res = fakeRes();
  await handler({ user: manager(), params: { id: 'admin-1' }, body: { overrides: { 'shipment.override': true } } }, res);
  assert.equal(res.statusCode, 200);
});

test('GET /api/admin/users kem featurePermissions de bang hien nhan "tuy chinh"', async () => {
  localUserStore.setInMemoryUsers([
    { id: 'u1', username: 'a', vaiTro: 'Trợ lý', trangThai: 'Đang hoạt động',
      featurePermissions: { 'reports.debt': false, 'khong.ton.tai': true } }
  ]);
  const handler = getRouteHandler(adminUserRoutes, 'get', '/api/admin/users');
  const res = fakeRes();
  await handler({ user: manager() }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.users[0].featurePermissions, { 'reports.debt': false }, 'key la bi loai');
});
