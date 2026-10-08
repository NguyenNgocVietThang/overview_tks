'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const repo = require('./hrLeaveRepository');
const employeeDirectory = require('./employeeDirectory');
const schedulesRepo=require('./hrLeaveWorkSchedulesRepository');
const { createHrLeaveDecisionService } = require('./hrLeaveDecisionService');
const { createHrLeaveRoutes } = require('./hrLeaveRoutes');
// These route tests cover formatting, events and branch propagation. Scope enforcement
// is exercised separately with the shared authorization service and a real DB fixture.
const decisions = createHrLeaveDecisionService({
  repo: {
    getLeaveRequestById: async id => ({ request_id: id, co_so: 'Hà Nội', bo_phan: 'KHO', decision_version: '0' }),
    updateLeaveRequestStatus: (...args) => repo.updateLeaveRequestStatus(...args)
  },
  authorization: { authorize: async user => user, routingFor: async () => ({ users: [] }) },
  notifyManagers: async () => {}, findEmployee: async () => null
});
const router = createHrLeaveRoutes({ decisions, notifyAllUsers: async () => {} });

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
  const originalResolve=schedulesRepo.resolveEmployee;
  schedulesRepo.resolveEmployee=async()=>({id:'1',ho_ten:'Nhân viên A',bo_phan:'KHO',branch:'hanoi'});
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
    schedulesRepo.resolveEmployee=originalResolve;
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
      body: { expectedVersion: '0', status: 'Đã duyệt' }
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

test('PATCH status chuyển lý do từ chối (đã trim) xuống repo; không gửi note thì để undefined', async () => {
  const originalUpdate = repo.updateLeaveRequestStatus;
  const received = [];
  repo.updateLeaveRequestStatus = async (id, data) => {
    received.push(data);
    return { request_id: id, trang_thai: data.status, co_so: 'Hà Nội' };
  };
  try {
    const handler = getRouteHandler('patch', '/api/hr/leave-requests/:id/status');
    const user = { ...MANAGER_BOTH };
    await handler({ params: { id: 'NP-1' }, user, body: { expectedVersion: '0', status: 'Từ chối', note: '  Thiếu người trực ca ' } }, fakeRes());
    await handler({ params: { id: 'NP-2' }, user, body: { expectedVersion: '0', status: 'Từ chối', note: '' } }, fakeRes());
    await handler({ params: { id: 'NP-3' }, user, body: { expectedVersion: '0', status: 'Đã duyệt' } }, fakeRes());

    assert.equal(received[0].note, 'Người duyệt: Quản lý - Quản lý\nLý do từ chối: Thiếu người trực ca');
    assert.equal(received[1].note, 'Người duyệt: Quản lý - Quản lý');
    assert.equal(received[2].note, 'Người duyệt: Quản lý - Quản lý');
  } finally {
    repo.updateLeaveRequestStatus = originalUpdate;
  }
});

test('PATCH status từ chối lý do quá 500 ký tự hoặc không phải chuỗi (400 INVALID_NOTE)', async () => {
  const originalUpdate = repo.updateLeaveRequestStatus;
  let called = false;
  repo.updateLeaveRequestStatus = async () => { called = true; return {}; };
  try {
    const handler = getRouteHandler('patch', '/api/hr/leave-requests/:id/status');
    for (const note of ['x'.repeat(501), 123, { a: 1 }]) {
      const res = fakeRes();
      await handler({ params: { id: 'NP-1' }, user: { ...MANAGER_BOTH }, body: { expectedVersion: '0', status: 'Từ chối', note } }, res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.code, 'INVALID_NOTE');
    }
    assert.equal(called, false);
  } finally {
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
    assert.deepEqual(Object.keys(resAll.body.employees[0]).sort(), ['boPhan', 'coSo', 'email', 'hoTen', 'id', 'soDienThoai']);

    const resOne = fakeRes();
    await handler({ user: STAFF_HANOI, query: {} }, resOne);
    assert.deepEqual(resOne.body.employees.map(e => e.hoTen), ['Nguyễn Văn A', 'Nguyễn Văn B', 'Trần Thị C'], 'cơ sở chỉ là bộ lọc xem, tài khoản 1 cơ sở vẫn thấy cả hai');
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
    assert.deepEqual(received.branch, ['Hà Nội', 'Sài Gòn'], '"Tất cả" gồm cả hai cơ sở, không phụ thuộc coSo được gán');
  } finally {
    repo.getLeaveRequests = originalGet;
  }
});

test('GET /api/hr/leave-requests cho xem cơ sở khác coSo được gán, từ chối cơ sở không hợp lệ, không chạm DB', async () => {
  const originalGet = repo.getLeaveRequests;
  let called = false;
  repo.getLeaveRequests = async () => { called = true; return []; };
  try {
    const handler = getRouteHandler('get', '/api/hr/leave-requests');

    const forbidden = fakeRes();
    await handler({ user: STAFF_HANOI, query: { branch: 'Sài Gòn' } }, forbidden);
    assert.equal(forbidden.statusCode, 200, 'coSo chỉ là mặc định, tài khoản Hà Nội vẫn xem được Sài Gòn');
    assert.equal(called, true);
    called = false;

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
    await handler({ params: { id: 'NP-SG-1' }, branch: 'Hà Nội', user: MANAGER_BOTH, body: { expectedVersion: '0', status: 'Đã duyệt' } }, fakeRes());
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

test('GET /api/hr/telegram/link-status đã gỡ (không giao diện nào gọi) -> không còn route, Express trả 404', () => {
  const exists = router.stack.some(item => item.route && item.route.path === '/api/hr/telegram/link-status');
  assert.equal(exists, false);
});

// ---------------------------------------------------------------------------
// Co so "Cả hai": ban ghi nghi phep PHAI lay co so tu ho so nhan su, khong bao
// gio luu/phat di gia tri "Cả hai" (cot branch cua DB chi nhan hanoi/saigon).
// ---------------------------------------------------------------------------

const userRepository = require('../auth/userRepository');
const { leaveEvents } = require('./hrLeaveEvents');

function stubHrProfileSources({ employees = [], users = [] } = {}) {
  const originalSnapshot = employeeDirectory.getSnapshot;
  const originalFindUser = userRepository.findUserByUsername;
  const originalResolve=schedulesRepo.resolveEmployee;
  schedulesRepo.resolveEmployee=async({employeeId,username})=>{
    if(employeeId) {
      const employee=employees[Number(employeeId)-1];
      return employee ? {id:String(employeeId),ho_ten:employee.hoTen,bo_phan:'KHO',branch:employee.sourceBranch==='Sài Gòn' ? 'saigon' : 'hanoi'} : null;
    }
    const user=users.find(item=>item.username===username);
    return user ? {id:'1',username:user.username,ho_ten:'Nhân viên A',bo_phan:'KHO',branch:user.hrSourceBranch==='Sài Gòn' ? 'saigon' : 'hanoi'} : null;
  };
  employeeDirectory.getSnapshot = async () => ({ employees });
  userRepository.findUserByUsername = async username =>
    users.find(user => user.username === username) || null;
  return () => {
    employeeDirectory.getSnapshot = originalSnapshot;
    userRepository.findUserByUsername = originalFindUser;
    schedulesRepo.resolveEmployee=originalResolve;
  };
}

function manualAbsenceBody(overrides) {
  return Object.assign({
    ho_ten: 'Nhân viên A',
    ly_do: 'HR ghi nhận',
    start_date: '2026-08-22',
    start_session: 'Sáng',
    end_date: '2026-08-22',
    end_session: 'Chiều',
    co_tu_y_nghi: true
  }, overrides);
}

async function postLeaveRequest({ branch, body, employees, users, onCreate }) {
  const originalCreate = repo.createLeaveRequest;
  const restoreProfiles = stubHrProfileSources({ employees, users });
  const calls = [];
  repo.createLeaveRequest = async (payload, createBranch) => {
    calls.push({ payload, branch: createBranch });
    return onCreate ? onCreate(payload, createBranch) : Object.assign({}, payload, { id: 'REQ-1', co_so: createBranch });
  };
  const events = [];
  const onEvent = payload => events.push(payload);
  leaveEvents.on('leave-event', onEvent);
  try {
    const handler = getRouteHandler('post', '/api/hr/leave-requests');
    const req = { user: MANAGER_BOTH, branch, body };
    const res = fakeRes();
    await handler(req, res);
    await new Promise(resolve => setImmediate(resolve));
    return { res, calls, events };
  } finally {
    leaveEvents.removeListener('leave-event', onEvent);
    restoreProfiles();
    repo.createLeaveRequest = originalCreate;
  }
}

test('tạo đơn ở "Cả hai": cơ sở lấy từ định danh nhân sự, bỏ qua họ tên giả', async () => {
  const { res, calls } = await postLeaveRequest({
    branch: 'Cả hai',
    body: manualAbsenceBody({ hr_employee_id:'1',ho_ten: 'Tên giả' }),
    employees: [
      { hoTen: 'Nhân viên A', sourceBranch: 'Sài Gòn' },
      { hoTen: 'Nhân viên B', sourceBranch: 'Hà Nội' }
    ]
  });

  assert.equal(res.statusCode, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].branch, 'Sài Gòn');
});

test('tạo đơn ở "Cả hai": cơ sở lấy từ tài khoản web khi có web_username', async () => {
  const { res, calls } = await postLeaveRequest({
    branch: 'Cả hai',
    body: manualAbsenceBody({ ho_ten: 'Nhân viên A', web_username: 'nva' }),
    users: [{ username: 'nva', hrSourceBranch: 'Hà Nội', coSo: 'Cả hai' }],
    employees: [{ hoTen: 'Nhân viên A', sourceBranch: 'Sài Gòn' }]
  });

  assert.equal(res.statusCode, 201);
  assert.equal(calls[0].branch, 'Hà Nội');
});

test('tạo đơn ở "Cả hai": không xác định được cơ sở của nhân sự -> 400, không ghi bản ghi', async () => {
  const { res, calls } = await postLeaveRequest({
    branch: 'Cả hai',
    body: manualAbsenceBody({ ho_ten: 'Người lạ' }),
    employees: [{ hoTen: 'Nhân viên A', sourceBranch: 'Hà Nội' }]
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'LEAVE_EMPLOYEE_REQUIRED');
  assert.match(res.body.error, /nhân sự/i);
  assert.equal(calls.length, 0);
});

test('tạo đơn ở "Cả hai": trùng tên ở cả hai cơ sở -> 400, không đoán bừa cơ sở', async () => {
  const { res, calls } = await postLeaveRequest({
    branch: 'Cả hai',
    body: manualAbsenceBody({ ho_ten: 'Nhân viên A' }),
    employees: [
      { hoTen: 'Nhân viên A', sourceBranch: 'Hà Nội' },
      { hoTen: 'Nhân viên A', sourceBranch: 'Sài Gòn' }
    ]
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'LEAVE_EMPLOYEE_REQUIRED');
  assert.equal(calls.length, 0);
});

test('tạo đơn ở "Cả hai": sự kiện realtime mang cơ sở vật lý của bản ghi', async () => {
  const { events } = await postLeaveRequest({
    branch: 'Cả hai',
    body: manualAbsenceBody({ hr_employee_id:'1',ho_ten: 'Nhân viên A' }),
    employees: [{ hoTen: 'Nhân viên A', sourceBranch: 'Sài Gòn' }],
    // Ban ghi tra ve thieu co_so (phong thu) — su kien van khong duoc mang "Cả hai".
    onCreate: payload => Object.assign({}, payload, { id: 'REQ-1', co_so: '' })
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].branch, 'Sài Gòn');
});

test('tạo đơn ở cơ sở vật lý vẫn từ chối khi thiếu định danh nhân sự', async () => {
  const { res, calls } = await postLeaveRequest({
    branch: 'Hà Nội',
    body: manualAbsenceBody({ ho_ten: 'Người lạ' }),
    employees: []
  });

  assert.equal(res.statusCode, 400);
  assert.equal(calls.length,0);
});

test('đổi trạng thái ở "Cả hai": sự kiện realtime không bao giờ mang nhãn "Cả hai"', async () => {
  const originalUpdate = repo.updateLeaveRequestStatus;
  repo.updateLeaveRequestStatus = async () => ({ id: 'REQ-1', ho_ten: 'Nhân viên A', co_so: '' });
  const events = [];
  const onEvent = payload => events.push(payload);
  leaveEvents.on('leave-event', onEvent);
  try {
    const handler = getRouteHandler('patch', '/api/hr/leave-requests/:id/status');
    const req = {
      user: MANAGER_BOTH, branch: 'Cả hai',
      params: { id: 'REQ-1' }, body: { expectedVersion: '0', status: 'Đã duyệt' }
    };
    const res = fakeRes();
    await handler(req, res);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(res.statusCode, 200);
    assert.equal(events.length, 1);
    assert.notEqual(events[0].branch, 'Cả hai');
  } finally {
    leaveEvents.removeListener('leave-event', onEvent);
    repo.updateLeaveRequestStatus = originalUpdate;
  }
});

// ---------------------------------------------------------------------------
// Bo loc "Cơ sở" cua trang co the mang gia tri "Cả hai" (lua chon giao dien) —
// phai hieu la "Tất cả cơ sở" TRONG pham vi tai khoan, khong phai co so la.
// ---------------------------------------------------------------------------

test('GET /api/hr/leave-requests?branch="Cả hai": lọc theo mọi cơ sở được phép, không báo lỗi', async () => {
  const originalGet = repo.getLeaveRequests;
  let received;
  repo.getLeaveRequests = async (filters, branch) => { received = { filters, branch }; return []; };
  try {
    const handler = getRouteHandler('get', '/api/hr/leave-requests');

    const res = fakeRes();
    await handler({ user: MANAGER_BOTH, query: { branch: 'Cả hai' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(received.branch, ['Hà Nội', 'Sài Gòn']);

    // Tai khoan mot co so cung xem duoc ca hai.
    const staffRes = fakeRes();
    await handler({ user: STAFF_HANOI, query: { branch: 'Cả hai' } }, staffRes);
    assert.equal(staffRes.statusCode, 200);
    assert.deepEqual(received.branch, ['Hà Nội', 'Sài Gòn']);
  } finally {
    repo.getLeaveRequests = originalGet;
  }
});

test('GET /api/hr/employees/export?branch="Cả hai": xuất được, không báo cơ sở không hợp lệ', async () => {
  const originalGetSnapshot = employeeDirectory.getSnapshot;
  employeeDirectory.getSnapshot = async () => ({
    employees: [
      { hoTen: 'A', boPhan: 'KHO', sourceBranch: 'Hà Nội', soDienThoai: '0900000001', email: 'a@x.com' },
      { hoTen: 'B', boPhan: 'KHO', sourceBranch: 'Sài Gòn', soDienThoai: '0900000002', email: 'b@x.com' }
    ]
  });
  try {
    const handler = getRouteHandler('get', '/api/hr/employees/export');
    const sent = [];
    const res = fakeRes();
    res.setHeader = () => res;
    res.send = payload => { sent.push(payload); return res; };

    await handler({ user: MANAGER_BOTH, query: { branch: 'Cả hai' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(sent.length, 1);
  } finally {
    employeeDirectory.getSnapshot = originalGetSnapshot;
  }
});
