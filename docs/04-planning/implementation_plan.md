# Implementation plan hiện tại

Cập nhật: 2026-09-25.

## Kiến trúc đã triển khai

1. KiotViet API được đồng bộ vào Supabase bởi `server/kiotvietSync/` (webhook + polling + backfill).
2. Dashboard đọc các bảng vận hành từ Supabase qua `dashboardPgReader.js`; không còn đọc dữ liệu vận hành từ Google Sheets.
3. CN1/CN3/CN7 (công nợ 1/3/7 ngày, trước đây gọi là HN1/HN3/HN7) được refresh vào `customer_debt_activity_periods` và đọc bằng `customerDebtActivityRepository.js`.
4. **Trả NCC** đã hoàn toàn rời Google Sheets: người dùng tự upload file Excel xuất từ KiotViet, server lưu vào `supplier_return_imports` (migration `0017`) — pipeline kiểm tra đứt hàng (`stockoutPgSource.js`) đọc trực tiếp từ Postgres.
5. Apps Script HN/SG, tab `Users` và module vận chuyển cũ đã được xóa; tính năng tra cứu Vòng đời đơn hàng tiếp tục được duy trì qua Google Sheets (`ORDER_LIFECYCLE_SPREADSHEET_ID`).
6. Tài khoản và Telegram ID nằm trong PostgreSQL (`app_users`). Luồng liên kết Telegram hoàn thiện bởi migration `0016`: 3 bảng `hr_leave_requests`/`hr_telegram_links`/`hr_telegram_sessions`; trigger tự đồng bộ `app_users.telegram_id` từ `hr_telegram_links`.
7. Phân quyền theo tính năng từng tài khoản (`feature_permissions JSONB`, migration `0020`) và vai trò `Nhân viên marketing` (migration `0019`).

## Vận hành

- Chạy migration trước khi deploy: `npm run db:migrate`.
- Bật `KIOTVIET_SYNC_ENABLED=true` khi cấu hình KiotViet và Supabase đã hợp lệ.
- Service account cần quyền Viewer trên workbook Công nợ (`DEBT_MANAGEMENT_SPREADSHEET_ID`) và Editor trên workbook Vòng đời đơn hàng (`ORDER_LIFECYCLE_SPREADSHEET_ID`).
- Hai file Kiot HN/SG **không còn** được server truy cập (không cần cấu hình `SPREADSHEET_ID`/`SPREADSHEET_ID_SG`).
- Không tạo lại các tab KiotViet khác hoặc cài Apps Script vào hai file này.
