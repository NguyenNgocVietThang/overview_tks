'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, 'migrations', '0016_hr_leave_telegram.sql'), 'utf8');

test('migration 0016 tạo 3 bảng nghỉ phép/Telegram và thu hồi quyền BI trên cả 3', () => {
  for (const table of ['hr_leave_requests', 'hr_telegram_links', 'hr_telegram_sessions']) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table} \\(`));
  }
  assert.match(sql, /REVOKE SELECT ON hr_leave_requests, hr_telegram_links, hr_telegram_sessions FROM reporting_readonly/);
});

test('migration 0016: đơn nghỉ phép có mã tự sinh, khoảng nghỉ có cấu trúc và ràng buộc thứ tự', () => {
  assert.match(sql, /request_id\s+TEXT NOT NULL UNIQUE DEFAULT/);
  assert.match(sql, /nextval\('hr_leave_request_no_seq'\)/);
  assert.match(sql, /tong_ngay_nghi\s+NUMERIC\(6, 1\) GENERATED ALWAYS AS \(tong_buoi_nghi \/ 2\.0\) STORED/);
  assert.match(sql, /branch IN \('hanoi', 'saigon'\)/);
  assert.match(sql, /start_session\s+TEXT NOT NULL CHECK \(start_session IN \('Sáng', 'Chiều'\)\)/);
  assert.match(sql, /hr_leave_requests_range_check/);
  assert.match(sql, /'Chưa duyệt', 'Tạm duyệt', 'Đã duyệt', 'Từ chối', 'Vi phạm'/);
  assert.match(sql, /user_id\s+UUID REFERENCES app_users\(id\) ON DELETE SET NULL/);
  assert.match(sql, /hr_employee_id\s+BIGINT REFERENCES hr_employees\(id\) ON DELETE SET NULL/);
});

test('migration 0016: hàng đợi báo kết quả duyệt có cột đánh dấu, index từng phần và trigger reset', () => {
  assert.match(sql, /decision_notified_at\s+TIMESTAMPTZ/);
  assert.match(sql, /hr_leave_requests_pending_notice_idx[\s\S]*WHERE thoi_diem_duyet IS NOT NULL AND decision_notified_at IS NULL/);
  assert.match(sql, /NEW\.decision_notified_at := NULL/);
});

test('migration 0016: liên kết Telegram là 1-1 giữa chat và tài khoản và đồng bộ app_users.telegram_id', () => {
  assert.match(sql, /hr_telegram_links_chat_linked_key[\s\S]*WHERE status = 'linked'/);
  assert.match(sql, /hr_telegram_links_user_linked_key[\s\S]*WHERE status = 'linked'/);
  assert.match(sql, /hr_telegram_links_code_pending_key[\s\S]*WHERE status = 'pending'/);
  assert.match(sql, /'pending', 'linked', 'expired', 'revoked'/);
  assert.match(sql, /CREATE TRIGGER hr_telegram_links_sync_app_user\s+AFTER INSERT OR UPDATE OR DELETE/);
  // Backfill phải chạy TRƯỚC khi gắn trigger đồng bộ.
  assert.ok(sql.indexOf('INSERT INTO hr_telegram_links') < sql.indexOf('CREATE TRIGGER hr_telegram_links_sync_app_user'));
});

test('migration 0016: phiên hội thoại khoá theo chat, dữ liệu JSONB và có hạn dùng', () => {
  assert.match(sql, /telegram_chat_id\s+TEXT PRIMARY KEY/);
  assert.match(sql, /data\s+JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(sql, /expires_at\s+TIMESTAMPTZ NOT NULL DEFAULT \(now\(\) \+ interval '60 minutes'\)/);
});
