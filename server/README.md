# TOKOSI Dashboard Server

Express backend cho dashboard TOKOSI.

## Nguồn dữ liệu

- KiotViet dashboard: Supabase PostgreSQL qua `dashboard/dashboardPgReader.js`.
- HN1/HN3/HN7: bảng `customer_debt_activity_periods` trong Supabase.
- Trả NCC: tab `Trả NCC` trong `SPREADSHEET_ID` hoặc `SPREADSHEET_ID_SG`.
- Công nợ quản lý: workbook `DEBT_MANAGEMENT_SPREADSHEET_ID`.
- Nhân sự: workbook HR riêng.
- Vòng đời đơn hàng: Google Sheets workbook `ORDER_LIFECYCLE_SPREADSHEET_ID` (`DonHang_HN`, `DonHang_SG`, `Lịch sử cập nhật`).
- Tài khoản: PostgreSQL `app_users`; không dùng tab `Users`.

Không còn Apps Script KiotViet. Đã gỡ bỏ tính năng vận chuyển (chỉ giữ lại tính năng vòng đời đơn hàng).

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

## Cấu hình Sheets

Service account chỉ cần quyền Viewer trên hai file Kiot HN/SG vì server chỉ đọc `Trả NCC`. Không tạo thêm tab và không có tác vụ Node/Apps Script ghi vào hai file này.

## Cấu hình Supabase

Đặt `SUPABASE_DB_URL`, sau đó chạy `npm run db:migrate`. Migration `0014_customer_debt_activity_periods.sql` cung cấp dữ liệu HN1/HN3/HN7 từ database.
