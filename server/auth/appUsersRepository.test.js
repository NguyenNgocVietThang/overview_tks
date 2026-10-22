'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rowToUser } = require('./appUsersRepository');

test('rowToUser ánh xạ Telegram ID từ app_users', () => {
  const user = rowToUser({
    id: 'user-1',
    username: 'employee@example.com',
    telegram_id: '6205968899',
    co_so: '',
    hr_branch: null
  });

  assert.equal(user.telegramId, '6205968899');
});

test('rowToUser dùng chuỗi rỗng khi tài khoản chưa có Telegram ID', () => {
  const user = rowToUser({ id: 'user-2', username: 'employee-2', co_so: '' });
  assert.equal(user.telegramId, '');
});

test('rowToUser lấy Bộ phận và Cơ sở công tác từ tài khoản, không từ hồ sơ nhân sự', () => {
  const user = rowToUser({ id: 'scope', co_so: '', work_branch: 'hanoi', bo_phan: 'KẾ TOÁN', hr_branch: 'saigon', hr_bo_phan: 'SALE', leave_approval_departments: ['  Kho  ', 'Kho', 'KẾ TOÁN'] });
  assert.equal(user.assignedCoSo, '');
  assert.equal(user.workCoSo, 'Hà Nội');
  assert.equal(user.boPhan, 'KẾ TOÁN');
  assert.deepEqual(user.leaveApprovalDepartments, ['Kho', 'KẾ TOÁN']);
});


test('department catalogue includes inactive HR, saved grants and historical request snapshots', async () => {
  const repository = require('./appUsersRepository');
  let query;
  const departments = await repository.selectApprovalDepartmentCatalog({ query: async sql => { query = sql; return { rows: [{ bo_phan: ' Old  Dept ' }, { bo_phan: 'old dept' }, { bo_phan: 'KHO' }] }; } });
  assert.deepEqual(departments, ['Old Dept', 'KHO']);
  assert.match(query, /hr_employees/);
  assert.match(query, /hr_leave_requests/);
  assert.match(query, /unnest\(leave_approval_departments\)/);
});

test('rowToUser không còn mang trạng thái hồ sơ HR: quyền chỉ theo trạng thái tài khoản', () => {
  assert.equal('hrEmployeeActive' in rowToUser({ id: 'inactive-hr', hr_employee_id: 123, hr_employee_active: false, trang_thai: 'Đang hoạt động' }), false);
});

test('selectFingerprint: băm toàn bộ snapshot trong SQL, chỉ trả 1 dòng (không kéo danh sách tài khoản về)', async () => {
  const repository = require('./appUsersRepository');
  const { getPool } = require('../db/pool');
  const pool = getPool();
  const original = pool.query;
  const calls = [];
  // Pool khong ket noi duoc trong test -> thay tam query de kiem tra SQL.
  const realGetPool = require.cache[require.resolve('../db/pool')].exports.getPool;
  require.cache[require.resolve('../db/pool')].exports.getPool = () => ({ query: async sql => { calls.push(sql); return { rows: [{ fingerprint: 'abc' }] }; } });
  try {
    delete require.cache[require.resolve('./appUsersRepository')];
    const fresh = require('./appUsersRepository');
    assert.equal(await fresh.selectFingerprint(), 'abc');
  } finally {
    require.cache[require.resolve('../db/pool')].exports.getPool = realGetPool;
    delete require.cache[require.resolve('./appUsersRepository')];
    void original; void repository;
  }
  assert.equal(calls.length, 1);
  assert.match(calls[0], /md5\(/);
  assert.match(calls[0], /string_agg/);
  assert.doesNotMatch(calls[0], /hr_employees/, 'fingerprint tài khoản không đọc hồ sơ nhân sự');
  assert.match(calls[0], /NOT u\.is_deleted/);
});
