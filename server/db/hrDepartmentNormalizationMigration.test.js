'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('migration 0074 chuẩn hóa mọi Bộ phận cũ theo khóa không phân biệt hoa thường', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '0074_hr_department_case_normalization.sql'), 'utf8');

  assert.match(sql, /lower\(regexp_replace\(btrim\(bo_phan\), '\\s\+', ' ', 'g'\)\)/i);
  assert.match(sql, /PARTITION BY branch, lower\(regexp_replace\(btrim\(bo_phan\), '\\s\+', ' ', 'g'\)\)/i);
  assert.match(sql, /UPDATE hr_employees/i);
  assert.match(sql, /UPDATE hr_leave_requests/i);
});
