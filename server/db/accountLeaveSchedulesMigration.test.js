'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('migration tài khoản hóa lịch nghỉ giữ lịch cũ và thêm khóa user_id', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '0081_hr_leave_account_schedules.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES app_users\(id\)/);
  assert.match(sql, /UPDATE hr_leave_work_schedules s[\s\S]*u\.hr_employee_id = s\.employee_id/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS hr_leave_work_schedules_user_date_idx/);
});

test('migration tài khoản hóa đơn nghỉ thay trigger dùng app_users, không dùng HR để quyết định đơn mới', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '0081_hr_leave_account_schedules.sql'), 'utf8');
  assert.match(sql, /u\.work_branch/);
  assert.match(sql, /u\.bo_phan/);
  assert.match(sql, /WHERE user_id = NEW\.user_id AND work_date = NEW\.start_date/);
  assert.doesNotMatch(sql, /FROM hr_employees e WHERE e\.id=NEW\.hr_employee_id/, 'trigger mới không được suy phạm vi từ hồ sơ HR');
});
