'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, 'migrations', '0030_drop_leave_provisional_status.sql'), 'utf8');

test('migration 0030 chuyển đơn Tạm duyệt về Chưa duyệt trước khi siết CHECK', () => {
  const update = sql.indexOf("SET trang_thai = 'Chưa duyệt' WHERE trang_thai = 'Tạm duyệt'");
  assert.ok(update >= 0);
  assert.ok(update < sql.indexOf('ADD CONSTRAINT hr_leave_requests_trang_thai_check'));
});

test('migration 0030: CHECK trạng thái chỉ còn 4 giá trị, không có Tạm duyệt', () => {
  assert.match(sql, /DROP CONSTRAINT IF EXISTS hr_leave_requests_trang_thai_check/);
  assert.match(sql, /CHECK \(trang_thai IN \('Chưa duyệt', 'Đã duyệt', 'Từ chối', 'Vi phạm'\)\)/);
});
