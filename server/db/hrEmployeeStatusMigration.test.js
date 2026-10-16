'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, 'migrations', '0041_hr_employee_status.sql'), 'utf8');

test('migration 0041 thêm employment_status mặc định active, chỉ nhận active/resigned', () => {
  assert.match(sql, /ALTER TABLE hr_employees/);
  assert.match(sql, /employment_status TEXT NOT NULL DEFAULT 'active'/);
  assert.match(sql, /CHECK \(employment_status IN \('active', 'resigned'\)\)/);
});

test('migration 0041 không đụng is_active (xóa mềm)', () => {
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /is_active/);
});
