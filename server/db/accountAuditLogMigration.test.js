'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, 'migrations', '0040_account_audit_log.sql'), 'utf8');

test('migration 0040 tạo account_audit_log không FK tới app_users (giữ lịch sử sau khi xóa TK)', () => {
  assert.match(sql, /CREATE TABLE account_audit_log/);
  assert.match(sql, /action\s+TEXT NOT NULL CHECK \(action IN \('create', 'update', 'reset_password', 'delete', 'permissions'\)\)/);
  assert.match(sql, /changes\s+JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.doesNotMatch(sql, /REFERENCES app_users/);
});

test('migration 0040 chặn sửa/xóa nhật ký và thu hồi SELECT của reporting_readonly', () => {
  assert.match(sql, /BEFORE UPDATE OR DELETE ON account_audit_log/);
  assert.match(sql, /REVOKE SELECT ON account_audit_log FROM reporting_readonly/);
});
