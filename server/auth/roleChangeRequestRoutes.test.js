'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const localUserStore = require('./localUserStore');
const roleRepo = require('./roleChangeRequestRepository');
const notificationRepo = require('../notifications/notificationRepository');
const roleChangeRequestRoutes = require('./roleChangeRequestRoutes');

const usersDbPath = path.join(os.tmpdir(), `test-users-${Date.now()}.json`);
const requestsDbPath = path.join(os.tmpdir(), `test-role-requests-${Date.now()}.json`);
const notificationsDbPath = path.join(os.tmpdir(), `test-notifications-${Date.now()}.json`);
localUserStore.initStore(usersDbPath);
roleRepo.initStore(requestsDbPath);
notificationRepo.initStore(notificationsDbPath);

test.after(() => {
  [usersDbPath, requestsDbPath, notificationsDbPath].forEach(p => {
    if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch (e) {} }
  });
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

test('POST /api/role-requests tạo yêu cầu và báo cho toàn bộ Quản lý', async () => {
  localUserStore.setInMemoryUsers([
    { id: 'u1', username: 'nva', hoTen: 'Nguyễn Văn A', vaiTro: 'Trợ lý', trangThai: 'Đang hoạt động' },
    { id: 'm1', username: 'ql1', hoTen: 'Quản lý 1', vaiTro: 'Quản lý', trangThai: 'Đang hoạt động' },
    { id: 'm2', username: 'ql2', hoTen: 'Quản lý 2', vaiTro: 'Quản lý', trangThai: 'Đang hoạt động' }
  ]);
  roleRepo.setInMemoryRequests([]);
  notificationRepo.setInMemoryNotifications([]);

  const handler = getRouteHandler(roleChangeRequestRoutes, 'post', '/api/role-requests');
  const req = {
    user: { id: 'u1', username: 'nva', hoTen: 'Nguyễn Văn A', vaiTro: 'Trợ lý' },
    body: { requestedRole: 'Kế toán', reason: 'Muốn chuyển bộ phận' }
  };
  const res = fakeRes();
  await handler(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.request.status, roleRepo.ROLE_REQUEST_STATUS.PENDING);

  const notifM1 = await notificationRepo.listForUser('m1');
  const notifM2 = await notificationRepo.listForUser('m2');
  assert.equal(notifM1.length, 1);
  assert.equal(notifM2.length, 1);
  assert.equal(notifM1[0].type, 'role_change_request');
  assert.equal(notifM1[0].relatedId, res.body.request.id);
});

test('POST /api/role-requests từ chối vai trò trùng vai trò hiện tại', async () => {
  roleRepo.setInMemoryRequests([]);
  const handler = getRouteHandler(roleChangeRequestRoutes, 'post', '/api/role-requests');
  const req = { user: { id: 'u1', username: 'nva', hoTen: 'A', vaiTro: 'Trợ lý' }, body: { requestedRole: 'Trợ lý', reason: 'x' } };
  const res = fakeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'SAME_ROLE');
});

test('POST /api/role-requests từ chối khi đã có yêu cầu chờ duyệt', async () => {
  roleRepo.setInMemoryRequests([]);
  await roleRepo.createRequest({ userId: 'u1', username: 'nva', hoTen: 'A', currentRole: 'Trợ lý', requestedRole: 'Kế toán', reason: 'x' });
  const handler = getRouteHandler(roleChangeRequestRoutes, 'post', '/api/role-requests');
  const req = { user: { id: 'u1', username: 'nva', hoTen: 'A', vaiTro: 'Trợ lý' }, body: { requestedRole: 'Lái xe', reason: 'y' } };
  const res = fakeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'ROLE_REQUEST_PENDING');
});

test('GET /api/role-requests: Quản lý xem tất cả, người khác chỉ xem của mình', async () => {
  roleRepo.setInMemoryRequests([]);
  await roleRepo.createRequest({ userId: 'u1', username: 'a', hoTen: 'A', currentRole: 'Trợ lý', requestedRole: 'Kế toán', reason: 'x' });
  await roleRepo.createRequest({ userId: 'u2', username: 'b', hoTen: 'B', currentRole: 'Lái xe', requestedRole: 'Trưởng kho', reason: 'y' });

  const handler = getRouteHandler(roleChangeRequestRoutes, 'get', '/api/role-requests');

  const managerReq = { user: { id: 'm1', vaiTro: 'Quản lý' }, query: {} };
  const managerRes = fakeRes();
  await handler(managerReq, managerRes);
  assert.equal(managerRes.body.requests.length, 2);

  const staffReq = { user: { id: 'u1', vaiTro: 'Trợ lý' }, query: {} };
  const staffRes = fakeRes();
  await handler(staffReq, staffRes);
  assert.equal(staffRes.body.requests.length, 1);
  assert.equal(staffRes.body.requests[0].userId, 'u1');
});

test('PATCH /api/role-requests/:id/status duyệt -> cập nhật vaiTro của user và báo lại', async () => {
  localUserStore.setInMemoryUsers([
    { id: 'u1', username: 'nva', hoTen: 'Nguyễn Văn A', vaiTro: 'Trợ lý', trangThai: 'Đang hoạt động' }
  ]);
  roleRepo.setInMemoryRequests([]);
  notificationRepo.setInMemoryNotifications([]);
  const created = await roleRepo.createRequest({ userId: 'u1', username: 'nva', hoTen: 'Nguyễn Văn A', currentRole: 'Trợ lý', requestedRole: 'Kế toán', reason: 'x' });

  const handler = getRouteHandler(roleChangeRequestRoutes, 'patch', '/api/role-requests/:id/status');
  const req = {
    user: { id: 'm1', username: 'ql1', hoTen: 'Quản lý 1', vaiTro: 'Quản lý' },
    params: { id: created.id },
    body: { status: roleRepo.ROLE_REQUEST_STATUS.APPROVED, note: 'Đồng ý' }
  };
  const res = fakeRes();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.request.status, roleRepo.ROLE_REQUEST_STATUS.APPROVED);

  const updatedUser = await localUserStore.getUserById('u1');
  assert.equal(updatedUser.vaiTro, 'Kế toán');

  const requesterNotifs = await notificationRepo.listForUser('u1');
  assert.equal(requesterNotifs.length, 1);
  assert.equal(requesterNotifs[0].type, 'role_change_decision');
});

test('PATCH /api/role-requests/:id/status từ chối -> KHÔNG đổi vaiTro', async () => {
  localUserStore.setInMemoryUsers([
    { id: 'u1', username: 'nva', hoTen: 'Nguyễn Văn A', vaiTro: 'Trợ lý', trangThai: 'Đang hoạt động' }
  ]);
  roleRepo.setInMemoryRequests([]);
  notificationRepo.setInMemoryNotifications([]);
  const created = await roleRepo.createRequest({ userId: 'u1', username: 'nva', hoTen: 'Nguyễn Văn A', currentRole: 'Trợ lý', requestedRole: 'Kế toán', reason: 'x' });

  const handler = getRouteHandler(roleChangeRequestRoutes, 'patch', '/api/role-requests/:id/status');
  const req = {
    user: { id: 'm1', username: 'ql1', hoTen: 'Quản lý 1', vaiTro: 'Quản lý' },
    params: { id: created.id },
    body: { status: roleRepo.ROLE_REQUEST_STATUS.REJECTED, note: 'Chưa phù hợp' }
  };
  const res = fakeRes();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  const updatedUser = await localUserStore.getUserById('u1');
  assert.equal(updatedUser.vaiTro, 'Trợ lý');
});

test('PATCH /api/role-requests/:id/status trả 403/ROLE_REQUEST_SELF_REVIEW khi Quản lý tự duyệt yêu cầu của chính mình', async () => {
  localUserStore.setInMemoryUsers([
    { id: 'm1', username: 'ql1', hoTen: 'Quản lý 1', vaiTro: 'Quản lý', trangThai: 'Đang hoạt động' }
  ]);
  roleRepo.setInMemoryRequests([]);
  notificationRepo.setInMemoryNotifications([]);
  const created = await roleRepo.createRequest({ userId: 'm1', username: 'ql1', hoTen: 'Quản lý 1', currentRole: 'Quản lý', requestedRole: 'Khách', reason: 'x' });

  const handler = getRouteHandler(roleChangeRequestRoutes, 'patch', '/api/role-requests/:id/status');
  const req = {
    user: { id: 'm1', username: 'ql1', hoTen: 'Quản lý 1', vaiTro: 'Quản lý' },
    params: { id: created.id },
    body: { status: roleRepo.ROLE_REQUEST_STATUS.APPROVED, note: 'Tự duyệt' }
  };
  const res = fakeRes();
  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'ROLE_REQUEST_SELF_REVIEW');

  const updatedUser = await localUserStore.getUserById('m1');
  assert.equal(updatedUser.vaiTro, 'Quản lý');
});

test('POST /api/role-requests trả 400/ROLE_REQUEST_HARDCODED_ADMIN khi hardcoded admin gửi yêu cầu', async () => {
  localUserStore.setInMemoryUsers([
    { id: 'admin-id', username: 'admin', hoTen: 'Quản trị viên', vaiTro: 'Quản lý', trangThai: 'Đang hoạt động' }
  ]);
  roleRepo.setInMemoryRequests([]);
  const handler = getRouteHandler(roleChangeRequestRoutes, 'post', '/api/role-requests');
  const req = {
    user: { id: 'admin-id', username: 'admin', hoTen: 'Quản trị viên', vaiTro: 'Quản lý' },
    body: { requestedRole: 'Khách', reason: 'x' }
  };
  const res = fakeRes();
  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'ROLE_REQUEST_HARDCODED_ADMIN');
});

test('POST /api/role-requests chấp nhận yêu cầu chuyển sang các vai trò mới', async () => {
  localUserStore.setInMemoryUsers([
    { id: 'u1', username: 'nv1', hoTen: 'Nhân Viên 1', vaiTro: 'Khách', trangThai: 'Đang hoạt động' }
  ]);
  notificationRepo.setInMemoryNotifications([]);

  const newRoles = ['Nhân viên kho', 'Nhân viên sale', 'Nhân viên mua hàng'];
  for (const role of newRoles) {
    roleRepo.setInMemoryRequests([]);
    const handler = getRouteHandler(roleChangeRequestRoutes, 'post', '/api/role-requests');
    const req = {
      user: { id: 'u1', username: 'nv1', hoTen: 'Nhân Viên 1', vaiTro: 'Khách' },
      body: { requestedRole: role, reason: `Xin chuyển sang ${role}` }
    };
    const res = fakeRes();
    await handler(req, res);

    assert.equal(res.statusCode, 201, `Yêu cầu đổi sang ${role} thất bại`);
    assert.equal(res.body.request.requestedRole, role);
  }
});
