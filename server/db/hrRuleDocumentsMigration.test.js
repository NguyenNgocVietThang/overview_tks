'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, 'migrations', '0027_hr_rule_documents.sql'), 'utf8');

test('migration 0027 tạo hr_rule_documents chứa cả tài liệu dựng sẵn lẫn PDF (BYTEA)', () => {
  assert.match(sql, /CREATE TABLE hr_rule_documents/);
  assert.match(sql, /id\s+BIGSERIAL PRIMARY KEY/);
  assert.match(sql, /kind\s+TEXT NOT NULL CHECK \(kind IN \('builtin', 'pdf'\)\)/);
  assert.match(sql, /builtin_key\s+TEXT UNIQUE/);
  assert.match(sql, /content\s+BYTEA/);
  assert.match(sql, /sha256\s+CHAR\(64\)/);
  assert.match(sql, /uploaded_by_user_id\s+UUID REFERENCES app_users\(id\) ON DELETE SET NULL/);
});

test('migration 0027 ràng buộc hình dạng dòng theo kind (dựng sẵn không có nội dung, PDF phải đủ nội dung)', () => {
  assert.match(sql, /CONSTRAINT hr_rule_documents_kind_shape CHECK/);
  assert.match(sql, /kind = 'builtin' AND builtin_key IS NOT NULL AND content IS NULL/);
  assert.match(sql, /kind = 'pdf' AND builtin_key IS NULL AND content IS NOT NULL/);
});

test('migration 0027 seed 2 tài liệu dựng sẵn theo đúng thứ tự hiển thị', () => {
  assert.match(sql, /'builtin',\s+'gio-giac',\s+'Giờ giấc làm việc',\s+10\)/);
  assert.match(sql, /'builtin',\s+'nghi-phep',\s+'Quy định nghỉ phép',\s+20\)/);
});

test('migration 0027 thu hồi SELECT của reporting_readonly (bảng chứa file nội bộ)', () => {
  assert.match(sql, /REVOKE SELECT ON hr_rule_documents FROM reporting_readonly/);
});

test('migration 0039 thêm tài liệu dựng sẵn Chi tiêu & Phúc lợi, chạy lại không lỗi', () => {
  const welfare = fs.readFileSync(path.join(__dirname, 'migrations', '0039_hr_rule_document_welfare.sql'), 'utf8');
  assert.match(welfare, /'builtin',\s+'phuc-loi',\s+'Chi tiêu & Phúc lợi',\s+30\)/);
  assert.match(welfare, /ON CONFLICT \(builtin_key\) DO NOTHING/);
});
