'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('migration 0076 sao chép cơ sở và Bộ phận HR hiện hữu sang tài khoản trước khi tách', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '0076_account_hr_decoupling.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS work_branch TEXT NOT NULL DEFAULT ''/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS bo_phan TEXT NOT NULL DEFAULT ''/);
  assert.match(sql, /UPDATE app_users u[\s\S]*FROM hr_employees e/);
  assert.match(sql, /u\.hr_employee_id = e\.id/);
});

test('migration 0076 đóng băng vai trò và cơ sở hiệu lực đang hiển thị trên web trước khi bỏ đồng bộ HR', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '0076_account_hr_decoupling.sql'), 'utf8');
  assert.match(sql, /vai_tro = COALESCE\(NULLIF\(u\.vai_tro_override, ''\), NULLIF\(u\.sheet_vai_tro, ''\), u\.vai_tro\)/);
  assert.match(sql, /co_so = CASE[\s\S]*u\.co_so_override[\s\S]*u\.sheet_co_so/);
  assert.doesNotMatch(sql, /feature_permissions\s*=/, 'quyền ghi đè riêng phải được giữ nguyên, không được thay thế');
});
