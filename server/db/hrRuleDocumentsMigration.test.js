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

test('migration 0049 thêm tài liệu dựng sẵn Quy định treo hàng, chạy lại không lỗi', () => {
  const hold = fs.readFileSync(path.join(__dirname, 'migrations', '0049_hr_rule_document_hold_goods.sql'), 'utf8');
  assert.match(hold, /'builtin',\s+'treo-hang',\s+'Quy định treo hàng',\s+40\)/);
  assert.match(hold, /ON CONFLICT \(builtin_key\) DO NOTHING/);
});

test('migration 0060 thêm kind text (Quản lý gõ trực tiếp) và cột body/updated_at/updated_by_name', () => {
  const text = fs.readFileSync(path.join(__dirname, 'migrations', '0060_hr_rule_document_text.sql'), 'utf8');
  assert.match(text, /ADD COLUMN body TEXT CHECK/);
  assert.match(text, /ADD COLUMN updated_at TIMESTAMPTZ/);
  assert.match(text, /ADD COLUMN updated_by_name TEXT NOT NULL DEFAULT ''/);
  assert.match(text, /DROP CONSTRAINT IF EXISTS hr_rule_documents_kind_shape/);
  assert.match(text, /DROP CONSTRAINT IF EXISTS hr_rule_documents_kind_check/);
});

test('migration 0060 cho phép kind text và giữ nguyên ràng buộc builtin/pdf cũ', () => {
  const text = fs.readFileSync(path.join(__dirname, 'migrations', '0060_hr_rule_document_text.sql'), 'utf8');
  assert.match(text, /CHECK \(kind IN \('builtin', 'pdf', 'text'\)\)/);
  assert.match(text, /kind = 'builtin' AND builtin_key IS NOT NULL AND content IS NULL[\s\S]*?AND body IS NULL/);
  assert.match(text, /kind = 'pdf' AND builtin_key IS NULL AND content IS NOT NULL[\s\S]*?AND body IS NULL/);
  assert.match(text, /kind = 'text' AND builtin_key IS NULL AND content IS NULL[\s\S]*?AND body IS NOT NULL/);
});

test('migration 0061 chuyển body cũ (văn bản thuần) sang HTML an toàn trước khi nâng rich text', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '0061_hr_rule_document_rich_text.sql'), 'utf8');
  // Thu tu thoat phai la & truoc, roi moi < > " — nguoc lai se thoat kep (&lt; -> &amp;lt;)
  const ampIdx = sql.indexOf("'&', '&amp;'");
  const ltIdx = sql.indexOf("'<', '&lt;'");
  const gtIdx = sql.indexOf("'>', '&gt;'");
  assert.ok(ampIdx !== -1 && ltIdx !== -1 && gtIdx !== -1, 'phai co du 3 buoc thoat & < >');
  assert.ok(ampIdx < ltIdx && ltIdx < gtIdx, 'phai thoat & TRUOC < va >');
  assert.match(sql, /E'\\n', '<br>'/);
  assert.match(sql, /WHERE kind = 'text' AND body IS NOT NULL/);
});

test('migration 0061 nâng giới hạn body lên 200000 ký tự (HTML tốn chỗ hơn văn bản thuần)', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '0061_hr_rule_document_rich_text.sql'), 'utf8');
  assert.match(sql, /DROP CONSTRAINT IF EXISTS hr_rule_documents_body_check/);
  assert.match(sql, /CHECK \(body IS NULL OR char_length\(body\) BETWEEN 1 AND 200000\)/);
});

test('migration 0061 tạo bảng hr_rule_document_images (BYTEA, giới hạn 5MB, cascade xóa theo tài liệu)', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '0061_hr_rule_document_rich_text.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE hr_rule_document_images/);
  assert.match(sql, /document_id\s+BIGINT NOT NULL REFERENCES hr_rule_documents\(id\) ON DELETE CASCADE/);
  assert.match(sql, /content\s+BYTEA NOT NULL/);
  assert.match(sql, /content_type\s+TEXT NOT NULL CHECK \(content_type IN \('image\/png', 'image\/jpeg', 'image\/gif', 'image\/webp'\)\)/);
  assert.match(sql, /size_bytes\s+INTEGER NOT NULL CHECK \(size_bytes > 0 AND size_bytes <= 5242880\)/);
  assert.match(sql, /sha256\s+CHAR\(64\) NOT NULL CHECK \(sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(sql, /REVOKE SELECT ON hr_rule_document_images FROM reporting_readonly/);
});

test('migration 0065 chuyển 4 tài liệu dựng sẵn sang kind=text, gán icon tương ứng, xóa builtin_key', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '0065_hr_rule_document_builtin_to_text.sql'), 'utf8');
  const expected = [
    ['gio-giac', 'clock'],
    ['nghi-phep', 'calendar'],
    ['phuc-loi', 'gift'],
    ['treo-hang', 'box']
  ];
  for (const [key, icon] of expected) {
    const re = new RegExp(
      `SET kind = 'text', builtin_key = NULL, icon_key = '${icon}'[\\s\\S]*?WHERE builtin_key = '${key}' AND kind = 'builtin';`
    );
    assert.match(sql, re, `phải có UPDATE cho ${key} với icon_key='${icon}'`);
  }
  // Moi dong body phai la mot dollar-quote khac nhau (vd $body1$...$body1$), khong
  // dung chung 1 the cho ca 4 (tranh dong sai gan vao body khac khi noi dung trung chuoi).
  const tags = [...sql.matchAll(/\$(\w+)\$/g)].map(m => m[1]);
  const uniqueTags = new Set(tags);
  assert.equal(uniqueTags.size * 2, tags.length, 'moi dollar-quote tag phai xuat hien dung 2 lan (mo + dong)');
});
