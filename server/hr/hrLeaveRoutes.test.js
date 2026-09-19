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
      user: { username: 'manager', hoTen: 'Quản lý Nguyễn' },
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

test('GET /api/hr/employees trả về nhân sự đúng cơ sở, đã lọc cột nhạy cảm', async () => {
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
    const req = { branch: 'Hà Nội' };
    const res = fakeRes();
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.employees.length, 2);
    assert.equal(res.body.employees[0].hoTen, 'Nguyễn Văn A');
    assert.equal(res.body.employees[1].hoTen, 'Nguyễn Văn B');
    assert.deepEqual(Object.keys(res.body.employees[0]).sort(), ['boPhan', 'email', 'hoTen', 'soDienThoai']);
  } finally {
    employeeDirectory.getSnapshot = originalGetSnapshot;
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
