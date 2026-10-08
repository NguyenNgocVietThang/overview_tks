'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const accountAuditLog = require('./accountAuditLog');

function fakePool(rows = []) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/count\(\*\)/.test(sql)) return { rows: [{ total: rows.length }] };
      return { rows };
    }
  };
}

test.afterEach(() => accountAuditLog.setPool(null));

test('diffUser chỉ trả về trường thực sự đổi, chuẩn hóa chuỗi và mảng phòng ban', () => {
  const before = { hoTen: 'An ', email: 'a@x.vn', vaiTro: 'Kế toán', coSo: 'Hà Nội', leaveApprovalDepartments: ['Kho', 'Sale'], passwordHash: 'h1' };
  const after = { hoTen: 'An', email: 'b@x.vn', vaiTro: 'Kế toán', coSo: 'Sài Gòn', leaveApprovalDepartments: ['Sale', 'Kho'], passwordHash: 'h2' };
  const changes = accountAuditLog.diffUser(before, after);
  assert.deepEqual(changes.map(c => c.field), ['email', 'coSo']);
  assert.deepEqual(changes[0], { field: 'email', label: 'Email', before: 'a@x.vn', after: 'b@x.vn' });
  assert.ok(!JSON.stringify(changes).includes('h1'));
  assert.ok(!JSON.stringify(changes).includes('h2'));
});

test('initialValues bỏ trường rỗng của tài khoản mới', () => {
  const changes = accountAuditLog.initialValues({ username: 'nv1', hoTen: 'Nhân viên', vaiTro: 'Khách', email: '', passwordHash: 'x' });
  assert.deepEqual(changes.map(c => c.field), ['hoTen', 'username', 'vaiTro']);
  assert.ok(changes.every(c => c.before === ''));
});

test('diffPermissions ghi nhãn quyền thêm/bỏ theo quyền hiệu lực', () => {
  const before = { vaiTro: 'Nhân viên sale', featurePermissions: {} };
  const after = { vaiTro: 'Nhân viên sale', featurePermissions: { 'reports.export': true, 'reports.debt': false } };
  const [perm] = accountAuditLog.diffPermissions(before, after);
  assert.equal(perm.field, 'permissions');
  assert.deepEqual(perm.added, ['Xuất Excel báo cáo']);
  assert.deepEqual(perm.removed, ['Công nợ']);
  assert.deepEqual(accountAuditLog.diffPermissions(before, before), []);
});

test('record ghi đúng cột, bỏ qua update không có thay đổi', async () => {
  const pool = fakePool();
  accountAuditLog.setPool(pool);
  const actor = { id: 'a1', username: 'ql', hoTen: 'Quản lý A' };
  const target = { id: 'u1', username: 'nv', hoTen: '' };
  assert.equal(await accountAuditLog.record({ action: 'update', actor, target, changes: [] }), false);
  assert.equal(pool.calls.length, 0);
  assert.equal(await accountAuditLog.record({ action: 'reset_password', actor, target }), true);
  const { params } = pool.calls[0];
  assert.deepEqual(params, ['reset_password', 'a1', 'ql', 'Quản lý A', 'u1', 'nv', 'nv', '[]']);
});

test('record nuốt lỗi DB (best-effort, không làm hỏng thao tác)', async () => {
  accountAuditLog.setPool({ query: async () => { throw new Error('db down'); } });
  const origError = console.error;
  console.error = () => {};
  try {
    assert.equal(await accountAuditLog.record({ action: 'delete', actor: { id: 'a' }, target: { id: 'b' } }), false);
  } finally {
    console.error = origError;
  }
});

test('listEntries lọc ở SQL, escape ký tự LIKE, phân trang', async () => {
  const pool = fakePool([{ id: 5, created_at: new Date('2026-10-08T03:00:00Z'), action: 'update', actor_user_id: 'a', actor_username: 'ql', actor_name: 'QL', target_user_id: 'u', target_username: 'nv', target_name: 'NV', changes: [{ field: 'hoTen' }] }]);
  accountAuditLog.setPool(pool);
  const result = await accountAuditLog.listEntries({ q: '50%_x', action: 'update', from: '2026-10-01', to: '2026-10-08', page: '2', pageSize: '500' });
  assert.equal(result.total, 1);
  assert.equal(result.pageSize, 100);
  assert.equal(result.entries[0].createdAt, '2026-10-08T03:00:00.000Z');
  assert.equal(result.entries[0].actor.name, 'QL');
  const listCall = pool.calls[1];
  assert.match(listCall.sql, /Asia\/Ho_Chi_Minh/);
  assert.equal(listCall.params[0], '%50\\%\\_x%');
  assert.deepEqual(listCall.params.slice(-2), [100, 100]);
  const none = await accountAuditLog.listEntries({ action: 'drop table', from: '01/10/2026' });
  assert.equal(pool.calls[2].params.length, 0);
  assert.equal(none.page, 1);
});
