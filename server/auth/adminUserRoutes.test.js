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

test('permission catalog marks guest exclusion; granting stock locations to a guest is rejected without saving', async () => {
  const catalog = fakeRes();
  getRouteHandler(adminUserRoutes, 'get', '/api/admin/permissions/catalog')({}, catalog);
  assert.deepEqual(catalog.body.features.find(f => f.key === 'stockLocations.view').forbiddenRoles, ['Khách']);
  localUserStore.setInMemoryUsers([{ id: 'location-guest', username: 'location-guest', vaiTro: 'Khách', trangThai: 'Đang hoạt động' }]);
  const res = fakeRes();
  await getRouteHandler(adminUserRoutes, 'put', '/api/admin/users/:id/permissions')({
    user: { id: 'admin', username: 'admin', vaiTro: 'Quản lý' },
    params: { id: 'location-guest' }, body: { overrides: { 'stockLocations.view': true } }
  }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'FEATURE_ROLE_FORBIDDEN');
  assert.ok(!(await localUserStore.getUserById('location-guest')).featurePermissions?.['stockLocations.view']);
});

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

test('Phan quyen xem: GET /api/admin/users chi Quan ly, chan moi vai tro khac', () => {
  const stack = getRouteMiddlewareStack(adminUserRoutes, 'get', '/api/admin/users');
  const roleGuard = stack[stack.length - 2];

  const allowedRes = fakeRes();
  let allowedNext = false;
  roleGuard({ user: { vaiTro: 'Quản lý' } }, allowedRes, () => { allowedNext = true; });
  assert.equal(allowedNext, true, 'Quan ly phai xem duoc danh sach nguoi dung');

  const otherRoles = ['Kế toán', 'Trưởng kho', 'Trợ lý', 'Lái xe', 'Nhân viên kho', 'Nhân viên sale', 'Nhân viên mua hàng', 'Khách'];
  for (const role of otherRoles) {
    const res = fakeRes();
    let nextCalled = false;
    roleGuard({ user: { vaiTro: role } }, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false, `Vai tro ${role} khong duoc xem danh sach nguoi dung`);
    assert.equal(res.statusCode, 403);
  }
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
  // Marketing giong Sale tru 5 tab xem bao cao (Sale duoc mo them tu 2026-10-02) va Vong doi don hang (shipment.lifecycle:
  // bo Nhan vien mua hang + marketing, 2026-10-02).
  const saleViewKeys = ['reports.overview', 'reports.products', 'reports.invoices', 'reports.customers', 'reports.debt'];
  assert.deepEqual(
    res.body.roleDefaults['Nhân viên marketing'],
    res.body.roleDefaults['Nhân viên sale'].filter(key => !saleViewKeys.includes(key) && key !== 'shipment.lifecycle')
  );
  assert.ok(res.body.roleDefaults['Nhân viên sale'].includes('reports.overview'));
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

// ---------------------------------------------------------------------------
// CHAN LEO THANG QUYEN: tai khoan KHONG phai Quan ly duoc cap quyen quan tri
// tai khoan chi duoc tac dong trong pham vi quyen cua chinh ho (accountPolicy.js)
// ---------------------------------------------------------------------------

function delegate() {
  return {
    id: 'del-1', username: 'delegate', hoTen: 'Trợ lý được ủy quyền', vaiTro: 'Trợ lý', trangThai: 'Đang hoạt động',
    featurePermissions: { 'account.users.manage': true, 'account.permissions': true }
  };
}

function seedWithDelegate() {
  localUserStore.setInMemoryUsers([
    delegate(),
    { id: 'mgr-1', username: 'quanly1', hoTen: 'Quản lý 1', email: 'ql1@tokosi.vn', vaiTro: 'Quản lý', trangThai: 'Đang hoạt động' },
    { id: 'kt-1', username: 'ketoan1', hoTen: 'Kế toán 1', email: 'kt1@tokosi.vn', vaiTro: 'Kế toán', trangThai: 'Đang hoạt động' },
    { id: 'nv-1', username: 'nvkho1', hoTen: 'NV kho 1', email: 'nv1@tokosi.vn', vaiTro: 'Nhân viên kho', trangThai: 'Đang hoạt động' }
  ]);
}

test('Chong leo thang: POST tao tai khoan Quan ly bi chan voi nguoi khong phai Quan ly', async () => {
  seedWithDelegate();
  const handler = getRouteHandler(adminUserRoutes, 'post', '/api/admin/users');
  const res = fakeRes();
  await handler({ user: delegate(), body: { username: 'moi1234', password: 'matkhau123', hoTen: 'Mới', vaiTro: 'Quản lý' } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'ACCOUNT_POLICY_DENIED');
  const all = await localUserStore.getAllUsers();
  assert.ok(!all.some(u => u.username === 'moi1234'), 'tai khoan khong duoc tao');
});

test('Chong leo thang: POST vai tro vuot quyen actor bi chan, vai tro <= actor duoc tao', async () => {
  seedWithDelegate();
  const handler = getRouteHandler(adminUserRoutes, 'post', '/api/admin/users');

  const blocked = fakeRes();
  await handler({ user: delegate(), body: { username: 'moi1234', password: 'matkhau123', hoTen: 'Mới', vaiTro: 'Kế toán' } }, blocked);
  assert.equal(blocked.statusCode, 403);

  const ok = fakeRes();
  await handler({ user: delegate(), body: { username: 'moi5678', password: 'matkhau123', hoTen: 'Mới', vaiTro: 'Nhân viên kho' } }, ok);
  assert.equal(ok.statusCode, 201);
});

test('Chong leo thang: PUT khong the nang ai len Quan ly, va khong sua duoc tai khoan Quan ly', async () => {
  seedWithDelegate();
  const handler = getRouteHandler(adminUserRoutes, 'put', '/api/admin/users/:id');

  const promote = fakeRes();
  await handler({ user: delegate(), params: { id: 'nv-1' }, body: { vaiTro: 'Quản lý' } }, promote);
  assert.equal(promote.statusCode, 403);
  assert.equal((await localUserStore.getUserById('nv-1')).vaiTro, 'Nhân viên kho');

  const editManager = fakeRes();
  await handler({ user: delegate(), params: { id: 'mgr-1' }, body: { hoTen: 'Bị sửa' } }, editManager);
  assert.equal(editManager.statusCode, 403);

  const lockManager = fakeRes();
  await handler({ user: delegate(), params: { id: 'mgr-1' }, body: { trangThai: 'Khóa' } }, lockManager);
  assert.equal(lockManager.statusCode, 403);
  assert.equal((await localUserStore.getUserById('mgr-1')).trangThai, 'Đang hoạt động');
});

test('Chong leo thang: PUT chi chan NANG quyen — sua thong tin co ban tai khoan cao hon van duoc', async () => {
  seedWithDelegate();
  const handler = getRouteHandler(adminUserRoutes, 'put', '/api/admin/users/:id');

  // Frontend luon gui lai vaiTro/email hien tai: khong duoc coi la nang quyen.
  const res = fakeRes();
  await handler({ user: delegate(), params: { id: 'kt-1' }, body: { hoTen: 'Kế toán đổi tên', vaiTro: 'Kế toán', email: 'kt1@tokosi.vn' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.hoTen, 'Kế toán đổi tên');

  // Nhung doi vai tro thanh gia tri mang them quyen actor khong co thi bi chan.
  const up = fakeRes();
  await handler({ user: delegate(), params: { id: 'nv-1' }, body: { vaiTro: 'Kế toán' } }, up);
  assert.equal(up.statusCode, 403);
});

test('Chong leo thang: PUT doi email/SDT tai khoan cao hon bi chan (duong chiem quyen qua OTP)', async () => {
  seedWithDelegate();
  const handler = getRouteHandler(adminUserRoutes, 'put', '/api/admin/users/:id');

  const email = fakeRes();
  await handler({ user: delegate(), params: { id: 'kt-1' }, body: { email: 'attacker@evil.com' } }, email);
  assert.equal(email.statusCode, 403);
  assert.equal((await localUserStore.getUserById('kt-1')).email, 'kt1@tokosi.vn');

  const phone = fakeRes();
  await handler({ user: delegate(), params: { id: 'kt-1' }, body: { soDienThoai: '0912345678' } }, phone);
  assert.equal(phone.statusCode, 403);

  // Tai khoan <= actor thi duoc doi email.
  const own = fakeRes();
  await handler({ user: delegate(), params: { id: 'nv-1' }, body: { email: 'nv1-moi@tokosi.vn' } }, own);
  assert.equal(own.statusCode, 200);
});

test('Chong leo thang: reset mat khau chi voi tai khoan <= actor; Quan ly va cao hon bi chan', async () => {
  seedWithDelegate();
  const handler = getRouteHandler(adminUserRoutes, 'post', '/api/admin/users/:id/reset-password');

  for (const id of ['mgr-1', 'kt-1']) {
    const res = fakeRes();
    await handler({ user: delegate(), params: { id }, body: { newPassword: 'matkhaumoi123' } }, res);
    assert.equal(res.statusCode, 403, id);
  }
  const ok = fakeRes();
  await handler({ user: delegate(), params: { id: 'nv-1' }, body: { newPassword: 'matkhaumoi123' } }, ok);
  assert.equal(ok.statusCode, 200);
});

test('Chong leo thang: DELETE tai khoan Quan ly bi chan', async () => {
  seedWithDelegate();
  const handler = getRouteHandler(adminUserRoutes, 'delete', '/api/admin/users/:id');
  const res = fakeRes();
  await handler({ user: delegate(), params: { id: 'mgr-1' } }, res);
  assert.equal(res.statusCode, 403);
  assert.ok(await localUserStore.getUserById('mgr-1'), 'tai khoan Quan ly con nguyen');

  const ok = fakeRes();
  await handler({ user: delegate(), params: { id: 'nv-1' } }, ok);
  assert.equal(ok.statusCode, 200);
});

test('Chong leo thang: PUT permissions khong tu cap them / cap them quyen actor khong co', async () => {
  seedWithDelegate();
  const handler = getRouteHandler(adminUserRoutes, 'put', '/api/admin/users/:id/permissions');

  const self = fakeRes();
  await handler({ user: delegate(), params: { id: 'del-1' }, body: { overrides: { 'account.users.manage': true, 'account.permissions': true, 'system.syncStatus': true } } }, self);
  assert.equal(self.statusCode, 403);

  const other = fakeRes();
  await handler({ user: delegate(), params: { id: 'nv-1' }, body: { overrides: { 'shipment.override': true } } }, other);
  assert.equal(other.statusCode, 403);

  const mgr = fakeRes();
  await handler({ user: delegate(), params: { id: 'mgr-1' }, body: { overrides: { 'reports.debt': false } } }, mgr);
  assert.equal(mgr.statusCode, 403);

  // Cap quyen ma chinh actor co (reports.overview la mac dinh cua Tro ly) thi duoc.
  const ok = fakeRes();
  await handler({ user: delegate(), params: { id: 'nv-1' }, body: { overrides: { 'reports.overview': true } } }, ok);
  assert.equal(ok.statusCode, 200);

  // Rut bot quyen cua tai khoan cao hon van duoc.
  const reduce = fakeRes();
  await handler({ user: delegate(), params: { id: 'kt-1' }, body: { overrides: { 'shipment.override': false } } }, reduce);
  assert.equal(reduce.statusCode, 200);
});

// ---------------------------------------------------------------------------
// LUAT 4 (2026-10-01): QUAN LY THUONG KHONG TAC DONG DUOC LEN QUAN LY KHAC.
// Chi Quan ly cap cao (admin cung) moi duoc dat lai mat khau / doi email-SDT / ha vai tro /
// rut quyen / khoa / xoa tai khoan cua Quan ly khac. Voi nhan vien thuong va chinh minh
// Quan ly thuong van lam duoc nhu truoc.
// ---------------------------------------------------------------------------

const ordinaryManagerActor = { id: 'ql-1', username: 'quanly1', hoTen: 'Quản lý 1', vaiTro: 'Quản lý' };
const seniorActor = { id: 'adm-1', username: 'admin', hoTen: 'Admin', vaiTro: 'Quản lý' };

function seedManagersAndStaff() {
  const base = { coSo: 'Cả hai', trangThai: 'Đang hoạt động', ngayTao: '01/01/2026' };
  localUserStore.setInMemoryUsers([
    { id: 'ql-1', username: 'quanly1', hoTen: 'Quản lý 1', email: 'ql1@example.com', passwordHash: 'h1', vaiTro: 'Quản lý', ...base },
    { id: 'ql-2', username: 'quanly2', hoTen: 'Quản lý 2', email: 'ql2@example.com', passwordHash: 'h2', vaiTro: 'Quản lý', ...base },
    { id: 'nv-1', username: 'nhanvien1', hoTen: 'Nhân viên 1', email: 'nv1@example.com', passwordHash: 'h3', vaiTro: 'Nhân viên kho', ...base }
  ]);
}

async function callRoute(method, routePath, req) {
  const res = fakeRes();
  await getRouteHandler(adminUserRoutes, method, routePath)(req, res);
  return res;
}

function assertSeniorOnly(res) {
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'ACCOUNT_POLICY_DENIED');
  assert.match(res.body.error, /Chỉ Quản lý cấp cao mới được .* của Quản lý khác/);
}

test('Luat 4: Quan ly thuong KHONG dat lai mat khau cua Quan ly khac; van dat lai cho nhan vien; cap cao thi duoc', async () => {
  seedManagersAndStaff();
  const path = '/api/admin/users/:id/reset-password';

  const denied = await callRoute('post', path, { user: ordinaryManagerActor, params: { id: 'ql-2' }, body: { newPassword: 'MatKhauMoi123' } });
  assertSeniorOnly(denied);
  assert.equal((await localUserStore.getUserById('ql-2')).passwordHash, 'h2', 'mat khau khong doi');

  const staff = await callRoute('post', path, { user: ordinaryManagerActor, params: { id: 'nv-1' }, body: { newPassword: 'MatKhauMoi123' } });
  assert.equal(staff.statusCode, 200);
  assert.notEqual((await localUserStore.getUserById('nv-1')).passwordHash, 'h3');

  const senior = await callRoute('post', path, { user: seniorActor, params: { id: 'ql-2' }, body: { newPassword: 'MatKhauMoi123' } });
  assert.equal(senior.statusCode, 200);
  assert.notEqual((await localUserStore.getUserById('ql-2')).passwordHash, 'h2');
});

test('Luat 4: Quan ly thuong KHONG doi email/SDT cua Quan ly khac (duong chiem quyen qua OTP) nhung van sua ho ten; tu sua minh duoc', async () => {
  seedManagersAndStaff();
  const path = '/api/admin/users/:id';

  assertSeniorOnly(await callRoute('put', path, { user: ordinaryManagerActor, params: { id: 'ql-2' }, body: { email: 'chiem@example.com' } }));
  assertSeniorOnly(await callRoute('put', path, { user: ordinaryManagerActor, params: { id: 'ql-2' }, body: { soDienThoai: '0912345678' } }));
  assert.equal((await localUserStore.getUserById('ql-2')).email, 'ql2@example.com');

  const rename = await callRoute('put', path, { user: ordinaryManagerActor, params: { id: 'ql-2' }, body: { hoTen: 'Tên mới' } });
  assert.equal(rename.statusCode, 200, 'sua ho ten khong phai ha quyen');

  const self = await callRoute('put', path, { user: ordinaryManagerActor, params: { id: 'ql-1' }, body: { email: 'moi-ql1@example.com' } });
  assert.equal(self.statusCode, 200, 'tu doi email cua chinh minh khong bi chan');
});

test('Luat 4: Quan ly thuong KHONG ha vai tro cua Quan ly khac; cap cao thi duoc; nang len Quan ly khong bi chan', async () => {
  seedManagersAndStaff();
  const path = '/api/admin/users/:id';

  assertSeniorOnly(await callRoute('put', path, { user: ordinaryManagerActor, params: { id: 'ql-2' }, body: { vaiTro: 'Trợ lý' } }));
  assert.equal((await localUserStore.getUserById('ql-2')).vaiTro, 'Quản lý');

  const promote = await callRoute('put', path, { user: ordinaryManagerActor, params: { id: 'nv-1' }, body: { vaiTro: 'Quản lý' } });
  assert.equal(promote.statusCode, 200, 'chi chan HA vai tro cua Quan ly, khong chan nang len');

  const senior = await callRoute('put', path, { user: seniorActor, params: { id: 'ql-2' }, body: { vaiTro: 'Trợ lý' } });
  assert.equal(senior.statusCode, 200);
  assert.equal((await localUserStore.getUserById('ql-2')).vaiTro, 'Trợ lý');
});

test('Luat 4: ghi de vai tro cua Quan ly HR-managed khac cung bi chan voi Quan ly thuong', async () => {
  const base = { coSo: 'Cả hai', trangThai: 'Đang hoạt động', ngayTao: '01/01/2026' };
  localUserStore.setInMemoryUsers([
    { id: 'ql-1', username: 'quanly1', hoTen: 'Quản lý 1', vaiTro: 'Quản lý', ...base },
    { id: 'hr-ql', username: 'hr-ql@example.com', hoTen: 'QL HR', email: 'hr-ql@example.com', vaiTro: 'Quản lý',
      hrManaged: true, sheetVaiTro: 'Quản lý', sheetCoSo: 'Cả hai', ...base }
  ]);
  const res = await callRoute('put', '/api/admin/users/:id', {
    user: ordinaryManagerActor, params: { id: 'hr-ql' }, body: { vaiTroOverride: 'Kế toán' }
  });
  assertSeniorOnly(res);
  assert.equal((await localUserStore.getUserById('hr-ql')).vaiTro, 'Quản lý');
});

test('Luat 4: Quan ly thuong KHONG khoa / xoa Quan ly khac; van khoa/xoa nhan vien; cap cao thi duoc', async () => {
  seedManagersAndStaff();
  const putPath = '/api/admin/users/:id';

  assertSeniorOnly(await callRoute('put', putPath, { user: ordinaryManagerActor, params: { id: 'ql-2' }, body: { trangThai: 'Khóa' } }));
  assert.equal((await localUserStore.getUserById('ql-2')).trangThai, 'Đang hoạt động');
  assertSeniorOnly(await callRoute('delete', putPath, { user: ordinaryManagerActor, params: { id: 'ql-2' } }));
  assert.ok(await localUserStore.getUserById('ql-2'), 'tai khoan van con');

  const lockStaff = await callRoute('put', putPath, { user: ordinaryManagerActor, params: { id: 'nv-1' }, body: { trangThai: 'Khóa' } });
  assert.equal(lockStaff.statusCode, 200);
  const deleteStaff = await callRoute('delete', putPath, { user: ordinaryManagerActor, params: { id: 'nv-1' } });
  assert.equal(deleteStaff.statusCode, 200);

  const lockBySenior = await callRoute('put', putPath, { user: seniorActor, params: { id: 'ql-2' }, body: { trangThai: 'Khóa' } });
  assert.equal(lockBySenior.statusCode, 200);
  const deleteBySenior = await callRoute('delete', putPath, { user: seniorActor, params: { id: 'ql-2' } });
  assert.equal(deleteBySenior.statusCode, 200);
});

test('Luat 4: Quan ly thuong KHONG rut quyen cua Quan ly khac (khong doi gi thi van duoc); cap cao thi duoc', async () => {
  seedManagersAndStaff();
  const path = '/api/admin/users/:id/permissions';

  assertSeniorOnly(await callRoute('put', path, { user: ordinaryManagerActor, params: { id: 'ql-2' }, body: { overrides: { 'reports.debt': false } } }));
  assert.deepEqual((await localUserStore.getUserById('ql-2')).featurePermissions || {}, {}, 'quyen khong bi rut');

  const noChange = await callRoute('put', path, { user: ordinaryManagerActor, params: { id: 'ql-2' }, body: { overrides: {} } });
  assert.equal(noChange.statusCode, 200, 'khong rut quyen nao thi khong phai ha quyen');

  const staff = await callRoute('put', path, { user: ordinaryManagerActor, params: { id: 'nv-1' }, body: { overrides: { 'shipment.override': true } } });
  assert.equal(staff.statusCode, 200, 'nhan vien thuong khong bi gioi han');

  const senior = await callRoute('put', path, { user: seniorActor, params: { id: 'ql-2' }, body: { overrides: { 'reports.debt': false } } });
  assert.equal(senior.statusCode, 200);
});
