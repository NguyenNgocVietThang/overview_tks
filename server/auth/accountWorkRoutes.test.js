'use strict';
process.env.JWT_SECRET ||= 'test-secret';
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./localUserStore');
const router = require('./adminUserRoutes');
const registry = require('./featureRegistry');
store.initStore(null, { repository: require('./testHelpers/fakeAppUsersRepository').createFakeAppUsersRepository() });
async function request(method, path, body = {}, id = 'staff') {
  const handler = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
  const res = { status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
  await handler({ user: { id: 'admin', username: 'admin', vaiTro: 'Quản lý' }, params: { id }, body }, res);
  return res;
}
test('create persists independent role and workplace and rejects incomplete or cross-branch data', async () => {
  store.setInMemoryUsers([]);
  const body = { username: 'independent', password: 'password123', hoTen: 'Assistant', vaiTro: 'Trợ lý', coSo: 'Cả hai', workCoSo: 'Hà Nội', boPhan: 'kế toán' };
  const created = await request('post', '/api/admin/users', body);
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.user.workCoSo, 'Hà Nội');
  assert.equal(created.body.user.boPhan, 'Kế toán');
  assert.ok(registry.resolvePermissions(created.body.user).includes('hr.leave.submit'));
  assert.deepEqual(created.body.user.featurePermissions, {});
  for (const [patch, code] of [[{ workCoSo: '' }, 'WORK_BRANCH_REQUIRED'], [{ boPhan: '' }, 'DEPARTMENT_REQUIRED'], [{ boPhan: 'Sale SG' }, 'DEPARTMENT_BRANCH_MISMATCH']]) {
    const denied = await request('post', '/api/admin/users', { ...body, username: 'invalid', ...patch });
    assert.equal(denied.statusCode, 400);
    assert.equal(denied.body.code, code);
  }
});
test('partial updates validate effective workplace, preserve membership on role changes, and clear guest fields', async () => {
  store.setInMemoryUsers([{ id: 'staff', username: 'staff', vaiTro: 'Trợ lý', coSo: 'Cả hai', workCoSo: 'Hà Nội', boPhan: 'Kế toán', trangThai: 'Đang hoạt động', leaveApprovalDepartments: ['Kho HN'] }]);
  let res = await request('put', '/api/admin/users/:id', { vaiTro: 'Nhân viên kho' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.boPhan, 'Kế toán');
  res = await request('put', '/api/admin/users/:id', { workCoSo: 'Sài Gòn' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'DEPARTMENT_BRANCH_MISMATCH');
  res = await request('put', '/api/admin/users/:id', { workCoSo: 'Sài Gòn', boPhan: 'Kho SG' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.vaiTro, 'Nhân viên kho');
  for (const patch of [{ workCoSo: null }, { boPhan: null }]) {
    const invalid = await request('put', '/api/admin/users/:id', patch);
    assert.equal(invalid.statusCode, 400);
  }
  res = await request('put', '/api/admin/users/:id', { vaiTro: 'Khách' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.workCoSo, '');
  assert.equal(res.body.user.boPhan, '');
  assert.deepEqual(res.body.user.leaveApprovalDepartments, []);
});
test('catalog exposes fixed workplace departments without reading HR', async () => {
  const directory = require('../hr/employeeDirectory');
  const original = directory.getSnapshot;
  directory.getSnapshot = async () => { throw new Error('must not read HR catalog'); };
  try {
    const res = await request('get', '/api/admin/permissions/catalog');
    assert.deepEqual(res.body.departmentsByBranch, { 'Hà Nội': require('../hr/hrDepartmentCatalog').departmentsFor('hanoi'), 'Sài Gòn': require('../hr/hrDepartmentCatalog').departmentsFor('saigon') });
  } finally { directory.getSnapshot = original; }
});
