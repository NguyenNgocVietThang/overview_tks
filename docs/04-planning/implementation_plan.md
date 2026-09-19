# Implementation plan hiện tại

Cập nhật: 2026-09-19.

## Kiến trúc đã triển khai

1. KiotViet API được đồng bộ vào Supabase bởi `server/kiotvietSync/`.
2. Dashboard đọc các bảng vận hành từ Supabase qua `dashboardPgReader.js`.
3. HN1/HN3/HN7 được refresh vào `customer_debt_activity_periods` và đọc bằng `customerDebtActivityRepository.js`.
4. Hai file Google Sheets HN/SG chỉ giữ `Trả NCC` để nhập thủ công.
5. Apps Script HN/SG, tab `Users` và module vận chuyển đã được xóa.
6. Tài khoản nằm trong PostgreSQL; HR tiếp tục dùng workbook riêng.

## Vận hành

- Chạy migration trước khi deploy: `npm run db:migrate`.
- Bật `KIOTVIET_SYNC_ENABLED=true` khi cấu hình KiotViet và Supabase đã hợp lệ.
- Service account có quyền Viewer trên hai file Kiot HN/SG.
- Không tạo lại các tab KiotViet khác hoặc cài Apps Script vào hai file này.
