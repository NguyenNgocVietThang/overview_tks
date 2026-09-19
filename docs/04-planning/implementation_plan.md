# Implementation plan hiện tại

Cập nhật: 2026-09-19.

## Kiến trúc đã triển khai

1. KiotViet API được đồng bộ vào Supabase bởi `server/kiotvietSync/`.
2. Dashboard đọc các bảng vận hành từ Supabase qua `dashboardPgReader.js`.
3. CN1/CN3/CN7 (công nợ 1/3/7 ngày, trước đây gọi là HN1/HN3/HN7) được refresh vào `customer_debt_activity_periods` và đọc bằng `customerDebtActivityRepository.js`.
4. Hai file Google Sheets HN/SG chỉ giữ `Trả NCC` để nhập thủ công.
5. Apps Script HN/SG, tab `Users` và module vận chuyển cũ đã được xóa; tính năng tra cứu Vòng đời đơn hàng tiếp tục được duy trì qua Google Sheets (`ORDER_LIFECYCLE_SPREADSHEET_ID`).
6. Tài khoản và Telegram ID nằm trong PostgreSQL (`app_users`); HR tiếp tục dùng workbook riêng cho nghiệp vụ nghỉ phép, nhưng luồng liên kết Telegram qua `_HR_TELEGRAM_LINKS` tạm ngừng.

## Vận hành

- Chạy migration trước khi deploy: `npm run db:migrate`.
- Bật `KIOTVIET_SYNC_ENABLED=true` khi cấu hình KiotViet và Supabase đã hợp lệ.
- Service account có quyền Viewer trên hai file Kiot HN/SG và quyền đọc/ghi trên workbook Vòng đời đơn hàng / HR.
- Không tạo lại các tab KiotViet khác hoặc cài Apps Script vào hai file này.
