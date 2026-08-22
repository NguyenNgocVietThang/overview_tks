'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const repo = require('./hrLeaveRepository');
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

test('route nhập tay tính buổi, loại Chủ nhật và định dạng mốc nghỉ', async () => {
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
    assert.equal(received.thoi_gian_bat_dau, 'Chiều 22/08/2026');
    assert.equal(received.thoi_gian_ket_thuc, 'Sáng 24/08/2026');
    assert.equal(received.tong_buoi_nghi, 2);
  } finally {
    repo.createLeaveRequest = originalCreate;
  }
});

test('route nhập tay từ chối khoảng chỉ có Chủ nhật', async () => {
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
      start_session: 'Sáng',
      end_date: '2026-08-23',
      end_session: 'Chiều',
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
