'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHrLeaveRoutes } = require('./hrLeaveRoutes');
const { HrEmployeeAdminError } = require('./hrEmployeeAdminService');

const MANAGER = { vaiTro: 'Quản lý', coSo: 'Cả hai', username: 'manager' };
const EMPLOYEE = { sourceBranch: 'Hà Nội', rowIndex: 7, hoTen: 'Chi', boPhan: 'KHO', soDienThoai: '0911111111', email: 'chi@x.com', employmentStatus: 'resigned', createdAt: '2026-10-09T00:00:00.000Z' };
const ACCOUNTS = { locked: ['chi'], unlocked: [], skipped: [] };

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = code => { res.statusCode = code; return res; };
  res.json = payload => { res.body = payload; return res; };
  return res;
}

function handlerOf(router, method, routePath) {
  const layer = router.stack.find(item => item.route && item.route.path === routePath && item.route.methods[method]);
  return { handler: layer.route.stack[layer.route.stack.length - 1].handle, layers: layer.route.stack.length };
}

test('POST /api/hr/employees trả 201 kèm nhân sự (có ngayThem, trạng thái chữ) và tài khoản đã khóa', async () => {
  let received;
  const router = createHrLeaveRoutes({ employeeAdmin: { createEmployee: async (actor, body) => { received = { actor, body }; return { employee: EMPLOYEE, accounts: ACCOUNTS }; } } });
  const { handler, layers } = handlerOf(router, 'post', '/api/hr/employees');
  assert.ok(layers >= 3, 'phải có requireAuth + requireFeature trước handler');
  const res = fakeRes();
  await handler({ user: MANAGER, body: { hoTen: 'Chi' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.employee.trangThai, 'Đã nghỉ việc');
  assert.equal(res.body.employee.id, '7');
  assert.equal(res.body.employee.ngayThem, EMPLOYEE.createdAt);
  assert.deepEqual(res.body.accounts, ACCOUNTS);
  assert.equal(received.actor, MANAGER);
});

test('PUT /api/hr/employees/:id chuyển lỗi nghiệp vụ (409) thành phản hồi JSON', async () => {
  const router = createHrLeaveRoutes({ employeeAdmin: { updateEmployee: async () => { throw new HrEmployeeAdminError('Trùng', 409, 'HR_IDENTITY_CONFLICT'); } } });
  const { handler } = handlerOf(router, 'put', '/api/hr/employees/:id');
  const res = fakeRes();
  await handler({ user: MANAGER, params: { id: '7' }, body: {} }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'HR_IDENTITY_CONFLICT');
});
