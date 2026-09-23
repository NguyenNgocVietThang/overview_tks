# TOKOSI Dashboard Server

Express backend cho dashboard TOKOSI.

## Nguồn dữ liệu

- KiotViet dashboard: Supabase PostgreSQL qua `dashboard/dashboardPgReader.js`.
- CN1/CN3/CN7: bảng `customer_debt_activity_periods` trong Supabase (công nợ 1/3/7 ngày, trước đây gọi là HN1/HN3/HN7).
- Trả NCC: tab `Trả NCC` trong `SPREADSHEET_ID` hoặc `SPREADSHEET_ID_SG`.
- Công nợ quản lý: workbook `DEBT_MANAGEMENT_SPREADSHEET_ID`.
- Nhân sự: workbook HR riêng.
- Vòng đời đơn hàng: Google Sheets workbook `ORDER_LIFECYCLE_SPREADSHEET_ID` (`DonHang_HN`, `DonHang_SG`, `Lịch sử cập nhật`).
- Tài khoản và Telegram ID: PostgreSQL `app_users`; không dùng tab `Users` hoặc `_HR_TELEGRAM_LINKS` để liên kết.

Không còn Apps Script KiotViet. Đã gỡ bỏ tính năng vận chuyển cũ (chỉ giữ lại tính năng vòng đời đơn hàng).

## Lệnh

```bash
npm install
npm run db:migrate
npm test
npm run dev
```

Các job đồng bộ:

```bash
npm run kiotviet-sync:preflight
npm run kiotviet-sync:backfill
npm run kiotviet-sync:reconcile
```

Khi `KIOTVIET_SYNC_ENABLED=true`, service chạy một lượt catch-up nền ngay lúc
khởi động từ checkpoint gần nhất, sau đó tiếp tục polling theo
`KIOTVIET_SYNC_FAST_INTERVAL_MS` và `KIOTVIET_SYNC_SLOW_INTERVAL_MS`.

## Cấu hình Sheets

Service account chỉ cần quyền Viewer trên hai file Kiot HN/SG vì server chỉ đọc `Trả NCC`. Không tạo thêm tab và không có tác vụ Node/Apps Script ghi vào hai file này.

## Cấu hình Supabase

Đặt `SUPABASE_DB_URL`, sau đó chạy `npm run db:migrate`. Migration `0014_customer_debt_activity_periods.sql` cung cấp dữ liệu CN1/CN3/CN7; migration `0015_app_users_telegram_id.sql` thêm Telegram ID lâu dài vào tài khoản; migration `0016_hr_leave_telegram.sql` tạo 3 bảng nghỉ phép (`hr_leave_requests`, `hr_telegram_links`, `hr_telegram_sessions`) thay cho 3 tab Google Sheets cũ. Migration `0018_product_report.sql` tạo bảng tổng hợp `product_report` cho báo cáo hàng hóa gộp 2 cơ sở. Bot Telegram chạy ngoài repo và đọc/ghi 3 bảng này trực tiếp — hợp đồng dữ liệu ở `db/SCHEMA.md`.
