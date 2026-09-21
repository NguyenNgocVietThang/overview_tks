'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const repo = require('./hrLeaveRepository');
const employeeDirectory = require('./employeeDirectory');
const router = require('./hrLeaveRoutes');

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = code => { res.statusCode = code; return res; };
  res.json = payload => { res.body = payload; return res; };
  return res;
}

const MANAGER_BOTH = { vaiTro: 'Quản lý', coSo: 'Cả hai', username: 'manager', hoTen: 'Quản lý' };
const STAFF_HANOI = { vaiTro: 'Nhân viên kho', coSo: 'Hà Nội', username: 'staff' };

function getRouteHandler(method, routePath) {
  const layer = router.stack.find(item => item.route && item.route.path === routePath && item.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

test('route nhập tay tính đúng số buổi và chuyển khoảng nghỉ dạng cấu trúc', async () => {
  const originalCreate = repo.createLeaveRequest;
  let received;
  repo.createLeaveRequest = async payload => { received = payload; return payload; };
  try {
    const handler = getRouteHandler('post', '/api/hr/leave-requests');
    const req = {
      user: { username: 'manager', hoTen: 'Quản lý' },
      body: {
        ho_ten: 'Nhân viên A',
        ly_do: 'HR ghi nhận',
        start_date: '2026-08-22',
        start_session: 'Chiều',
        end_date: '2026-08-24',
        end_session: 'Sáng',
        co_tu_y_nghi: true
      }
    };
    const res = fakeRes();
    await handler(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(received.start_date, '2026-08-22');
    assert.equal(received.start_session, 'Chiều');
    assert.equal(received.end_date, '2026-08-24');
    assert.equal(received.end_session, 'Sáng');
    assert.equal(received.tong_buoi_nghi, 4);
  } finally {
    repo.createLeaveRequest = originalCreate;
  }
});

test('route nhập tay từ chối khoảng nghỉ không hợp lệ (Chiều đến Sáng cùng ngày)', async () => {
  const originalCreate = repo.createLeaveRequest;
  let createCalled = false;
  repo.createLeaveRequest = async () => { createCalled = true; return {}; };
  try {
    const handler = getRouteHandler('post', '/api/hr/leave-requests');
    const req = {
      user: { username: 'manager', hoTen: 'Quản lý' },
      body: {
        ho_ten: 'Nhân viên A',
        ly_do: 'HR ghi nhận',
        start_date: '2026-08-23',
        start_session: 'Chiều',
        end_date: '2026-08-23',
        end_session: 'Sáng',
        co_tu_y_nghi: true
      }
    };
    const res = fakeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'INVALID_LEAVE_RANGE');
    assert.equal(createCalled, false);
  } finally {
    repo.createLeaveRequest = originalCreate;
  }
});

test('PATCH status phát sự kiện LEAVE_STATUS_CHANGED qua hrLeaveEvents', async () => {
  const { leaveEvents } = require('./hrLeaveEvents');
  const originalUpdate = repo.updateLeaveRequestStatus;
  repo.updateLeaveRequestStatus = async (id, data) => ({
    request_id: id,
    trang_thai: data.status,
    nguoi_duyet: data.approver
  });

  let broadcastReceived = null;
  const onEvent = payload => { broadcastReceived = payload; };
  leaveEvents.on('leave-event', onEvent);

  try {
    const handler = getRouteHandler('patch', '/api/hr/leave-requests/:id/status');
    const req = {
      params: { id: 'NP-20260822-005' },
      user: { ...MANAGER_BOTH, hoTen: 'Quản lý Nguyễn' },
      body: { status: 'Đã duyệt' }
    };
    const res = fakeRes();
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(broadcastReceived, 'Phải phát broadcast event khi đổi trạng thái');
    assert.equal(broadcastReceived.type, 'LEAVE_STATUS_CHANGED');
    assert.equal(broadcastReceived.data.request_id, 'NP-20260822-005');
    assert.equal(broadcastReceived.data.trang_thai, 'Đã duyệt');
  } finally {
    leaveEvents.removeListener('leave-event', onEvent);
    repo.updateLeaveRequestStatus = originalUpdate;
  }
});

test('GET /api/hr/employees trả về nhân sự mọi cơ sở được phép kèm cơ sở, đã lọc cột nhạy cảm', async () => {
  const originalGetSnapshot = employeeDirectory.getSnapshot;
  employeeDirectory.getSnapshot = async () => ({
    employees: [
      { sourceBranch: 'Hà Nội', hoTen: 'Nguyễn Văn B', boPhan: 'SALE', soDienThoai: '0900000001', email: 'b@x.com', telegramId: '123' },
      { sourceBranch: 'Hà Nội', hoTen: 'Nguyễn Văn A', boPhan: 'KHO', soDienThoai: '0900000002', email: 'a@x.com', telegramId: '456' },
      { sourceBranch: 'Sài Gòn', hoTen: 'Trần Thị C', boPhan: 'TRỢ LÝ', soDienThoai: '0900000003', email: 'c@x.com', telegramId: '789' }
    ],
    stale: false
  });
  try {
    const handler = getRouteHandler('get', '/api/hr/employees');

    const resAll = fakeRes();
    await handler({ user: MANAGER_BOTH, query: {} }, resAll);
    assert.equal(resAll.statusCode, 200);
    assert.deepEqual(resAll.body.employees.map(e => e.hoTen), ['Nguyễn Văn A', 'Nguyễn Văn B', 'Trần Thị C']);
    assert.deepEqual(resAll.body.employees.map(e => e.coSo), ['Hà Nội', 'Hà Nội', 'Sài Gòn']);
    assert.deepEqual(Object.keys(resAll.body.employees[0]).sort(), ['boPhan', 'coSo', 'email', 'hoTen', 'soDienThoai']);

    const resOne = fakeRes();
    await handler({ user: STAFF_HANOI, query: {} }, resOne);
    assert.deepEqual(resOne.body.employees.map(e => e.hoTen), ['Nguyễn Văn A', 'Nguyễn Văn B'], 'tài khoản 1 cơ sở không thấy cơ sở khác');
  } finally {
    employeeDirectory.getSnapshot = originalGetSnapshot;
  }
});

test('GET /api/hr/leave-requests mặc định gộp mọi cơ sở được phép và chuyển bộ lọc phòng ban', async () => {
  const originalGet = repo.getLeaveRequests;
  let received;
  repo.getLeaveRequests = async (filters, branch) => { received = { filters, branch }; return []; };
  try {
    const handler = getRouteHandler('get', '/api/hr/leave-requests');

    await handler({ user: MANAGER_BOTH, query: { department: 'KHO' } }, fakeRes());
    assert.deepEqual(received.branch, ['Hà Nội', 'Sài Gòn'], 'mặc định = tất cả cơ sở được phép');
    assert.equal(received.filters.department, 'KHO');

    await handler({ user: MANAGER_BOTH, query: { branch: 'Sài Gòn' } }, fakeRes());
    assert.deepEqual(received.branch, ['Sài Gòn']);

    await handler({ user: STAFF_HANOI, query: {} }, fakeRes());
    assert.deepEqual(received.branch, ['Hà Nội'], '"Tất cả" không vượt quá cơ sở được phép');
  } finally {
    repo.getLeaveRequests = originalGet;
  }
});

test('GET /api/hr/leave-requests từ chối cơ sở ngoài quyền hoặc không hợp lệ, không chạm DB', async () => {
  const originalGet = repo.getLeaveRequests;
  let called = false;
  repo.getLeaveRequests = async () => { called = true; return []; };
  try {
    const handler = getRouteHandler('get', '/api/hr/leave-requests');

    const forbidden = fakeRes();
    await handler({ user: STAFF_HANOI, query: { branch: 'Sài Gòn' } }, forbidden);
    assert.equal(forbidden.statusCode, 403);
    assert.equal(forbidden.body.code, 'BRANCH_FORBIDDEN');

    const invalid = fakeRes();
    await handler({ user: MANAGER_BOTH, query: { branch: 'Đà Nẵng' } }, invalid);
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body.code, 'INVALID_BRANCH');
    assert.equal(called, false);
  } finally {
    repo.getLeaveRequests = originalGet;
  }
});

test('PATCH status tìm đơn ở mọi cơ sở được phép và phát sự kiện đúng cơ sở của đơn', async () => {
  const { leaveEvents } = require('./hrLeaveEvents');
  const originalUpdate = repo.updateLeaveRequestStatus;
  let searchedBranches;
  repo.updateLeaveRequestStatus = async (id, data, branch) => {
    searchedBranches = branch;
    return { request_id: id, trang_thai: data.status, nguoi_duyet: data.approver, co_so: 'Sài Gòn' };
  };
  let broadcast = null;
  const onEvent = payload => { broadcast = payload; };
  leaveEvents.on('leave-event', onEvent);
  try {
    const handler = getRouteHandler('patch', '/api/hr/leave-requests/:id/status');
    // Quản lý đang chọn Hà Nội ở thanh điều hướng nhưng sửa đơn của Sài Gòn từ danh sách "Tất cả cơ sở".
    await handler({ params: { id: 'NP-SG-1' }, branch: 'Hà Nội', user: MANAGER_BOTH, body: { status: 'Đã duyệt' } }, fakeRes());
    assert.deepEqual(searchedBranches, ['Hà Nội', 'Sài Gòn']);
    assert.equal(broadcast.branch, 'Sài Gòn');
  } finally {
    leaveEvents.removeListener('leave-event', onEvent);
    repo.updateLeaveRequestStatus = originalUpdate;
  }
});

test('luồng tạo mã Telegram cũ đã ngừng và không ghi Google Sheets', async () => {
  const originalCreateLinkCode = repo.createLinkCode;
  let sheetCalled = false;
  repo.createLinkCode = async () => { sheetCalled = true; };
  try {
    const handler = getRouteHandler('post', '/api/hr/telegram/link-code');
    const res = fakeRes();
    await handler({ user: { username: 'employee' } }, res);
    assert.equal(res.statusCode, 410);
    assert.equal(res.body.code, 'TELEGRAM_SHEET_LINK_DISABLED');
    assert.equal(sheetCalled, false);
  } finally {
    repo.createLinkCode = originalCreateLinkCode;
  }
});

test('trạng thái Telegram đọc từ app_users qua req.user, không đọc Google Sheets', async () => {
  const originalFindLink = repo.findLinkByWebUsername;
  let sheetCalled = false;
  repo.findLinkByWebUsername = async () => { sheetCalled = true; };
  try {
    const handler = getRouteHandler('get', '/api/hr/telegram/link-status');
    const res = fakeRes();
    await handler({ user: { telegramId: '6205968899' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { linked: true, telegramId: '6205968899', source: 'postgres' });
    assert.equal(sheetCalled, false);
  } finally {
    repo.findLinkByWebUsername = originalFindLink;
  }
});
