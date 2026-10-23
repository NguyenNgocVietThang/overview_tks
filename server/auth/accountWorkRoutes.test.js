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
test('partial updates validate effective workplace and preserve guest workplace without granting approval', async () => {
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
  assert.equal(res.body.user.workCoSo, 'Sài Gòn');
  assert.equal(res.body.user.boPhan, 'Kho SG');
  assert.deepEqual(res.body.user.leaveApprovalDepartments, ['Kho HN']);
  assert.ok(registry.resolvePermissions(res.body.user).includes('hr.leave.submit'));
  assert.equal(registry.hasFeature(res.body.user, 'hr.leave.manage'), false);
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

test('request-only legacy department can be offered and granted to a replacement approver', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const repository = require('./appUsersRepository');
  const { matchesApprovalScope, selectApprovers } = require('../hr/hrLeaveAuthorization');
  const original = repository.selectApprovalDepartmentCatalog;
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE app_users (bo_phan text, leave_approval_departments text[], is_deleted boolean);
      CREATE TABLE hr_leave_requests (bo_phan text);
      INSERT INTO app_users VALUES ('Kho HN', ARRAY[]::text[], false);
      INSERT INTO hr_leave_requests VALUES ('KHO');`);
    repository.selectApprovalDepartmentCatalog = () => original(db);
    store.setInMemoryUsers([{ id: 'staff', username: 'replacement', vaiTro: 'Trợ lý', coSo: 'Hà Nội', workCoSo: 'Hà Nội', boPhan: 'Kho HN', trangThai: 'Đang hoạt động', leaveApprovalDepartments: [] }]);
    const catalog = await request('get', '/api/admin/permissions/catalog');
    assert.ok(catalog.body.departments.includes('KHO'), 'request-only legacy department remains selectable for approval');
    assert.ok(!Object.values(catalog.body.departmentsByBranch).flat().includes('KHO'), 'legacy approval choices never enter the workplace catalog');
    const granted = await request('put', '/api/admin/users/:id/permissions', { overrides: { 'hr.leave.manage': true }, leaveApprovalDepartments: ['KHO'] });
    assert.equal(granted.statusCode, 200);
    assert.deepEqual(granted.body.leaveApprovalDepartments, ['KHO']);
    const approver = await store.getUserById('staff');
    const historical = { co_so: 'Hà Nội', bo_phan: 'KHO' };
    assert.equal(matchesApprovalScope(approver, historical), true);
    assert.equal(selectApprovers([approver], historical).fallback, false);
    assert.equal(approver.boPhan, 'Kho HN', 'membership stays canonical and independent of approval scope');
  } finally {
    repository.selectApprovalDepartmentCatalog = original;
    await db.close();
  }
});
test('create accepts an optional Telegram ID, validates it and rejects one already in use', async () => {
  store.setInMemoryUsers([{ id: 'taken', username: 'taken', vaiTro: 'Khách', telegramId: '111222333', trangThai: 'Đang hoạt động' }]);
  const body = { username: 'with-telegram', password: 'password123', hoTen: 'Kho', vaiTro: 'Nhân viên kho', workCoSo: 'Hà Nội', boPhan: 'Kho HN' };
  let res = await request('post', '/api/admin/users', { ...body, telegramId: '@abc' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_TELEGRAM_ID');
  res = await request('post', '/api/admin/users', { ...body, telegramId: ' 111222333 ' });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'TELEGRAM_ID_EXISTS');
  res = await request('post', '/api/admin/users', { ...body, telegramId: ' 9007199254740993 ' });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.user.telegramId, '9007199254740993');
  assert.equal(res.body.warning, undefined);
});
test('catalog suggests a department per role inside the selected workplace', async () => {
  const { canonicalDepartment } = require('../hr/hrDepartmentCatalog');
  const res = await request('get', '/api/admin/permissions/catalog');
  const suggestions = res.body.suggestedDepartmentByRole;
  assert.equal(suggestions['Hà Nội']['Nhân viên sale'], 'Sale HN');
  assert.equal(suggestions['Sài Gòn']['Kế toán'], 'Quản lý-KT SG');
  assert.equal(suggestions['Sài Gòn']['Trợ lý'], undefined);
  for (const [label, code] of [['Hà Nội', 'hanoi'], ['Sài Gòn', 'saigon']]) {
    for (const department of Object.values(suggestions[label])) assert.equal(canonicalDepartment(code, department), department);
  }
});
