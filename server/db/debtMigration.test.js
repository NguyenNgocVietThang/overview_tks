'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('migration 0011 tạo khóa chính theo cơ sở + khách và ràng buộc trạng thái/chữ ký', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '0011_debt_collection_statuses.sql'), 'utf8');
  assert.match(sql, /PRIMARY KEY \(branch, customer_key\)/);
  assert.match(sql, /branch IN \('hanoi', 'saigon'\)/);
  assert.match(sql, /'Chưa xử lý'.*'Đang xử lý'.*'Đã xử lý'.*'Bỏ qua'/s);
  assert.match(sql, /alert_signature ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(sql, /updated_by_user_id\s+UUID/);
  assert.match(sql, /REVOKE SELECT ON debt_collection_statuses FROM reporting_readonly/);
});
