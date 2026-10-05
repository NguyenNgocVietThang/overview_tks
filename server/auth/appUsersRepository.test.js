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

test('rowToUser preserves stored approval departments, linked department and raw assigned branch', () => {
  const user = rowToUser({ id: 'scope', co_so: '', hr_branch: 'hanoi', hr_bo_phan: 'KẾ TOÁN', leave_approval_departments: ['  Kho  ', 'Kho', 'KẾ TOÁN'] });
  assert.equal(user.assignedCoSo, '');
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

test('rowToUser reports linked HR activity separately from account status', () => {
  assert.equal(rowToUser({ id: 'inactive-hr', hr_employee_id: 123, hr_employee_active: false, trang_thai: 'Đang hoạt động' }).hrEmployeeActive, false);
});
