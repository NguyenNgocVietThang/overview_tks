# Implementation plan hiện tại

Cập nhật: 2026-10-02.

## Kiến trúc đã triển khai

1. KiotViet API được đồng bộ vào Supabase bởi `server/kiotvietSync/` (webhook + polling + backfill).
2. Dashboard đọc các bảng vận hành từ Supabase qua `dashboardPgReader.js`; không còn đọc dữ liệu vận hành từ Google Sheets.
3. CN1/CN3/CN7 (công nợ 1/3/7 ngày, trước đây gọi là HN1/HN3/HN7) được refresh vào `customer_debt_activity_periods` và đọc bằng `customerDebtActivityRepository.js`.
4. **Trả NCC** đã hoàn toàn rời Google Sheets: người dùng tự upload file Excel xuất từ KiotViet, server lưu vào `supplier_return_imports` (migration `0017`) — pipeline kiểm tra đứt hàng (`stockoutPgSource.js`) đọc trực tiếp từ Postgres.
5. Apps Script HN/SG, tab `Users` và module vận chuyển cũ đã được xóa; tính năng tra cứu Vòng đời đơn hàng tiếp tục được duy trì qua Google Sheets (`ORDER_LIFECYCLE_SPREADSHEET_ID`).
6. Tài khoản và Telegram ID nằm trong PostgreSQL (`app_users`). Luồng liên kết Telegram hoàn thiện bởi migration `0016`: 3 bảng `hr_leave_requests`/`hr_telegram_links`/`hr_telegram_sessions`; trigger tự đồng bộ `app_users.telegram_id` từ `hr_telegram_links`.
7. Phân quyền theo tính năng từng tài khoản (`feature_permissions JSONB`, migration `0020`) và vai trò `Nhân viên marketing` (migration `0019`).
8. Báo cáo tổng hợp tải **theo từng tab**: `GET /api/dashboard?view=<tab>` chỉ đọc/tính/trả phần của tab (khai báo ở `dashboardViews.js`); cache bảng nguồn theo từng bảng, cache kết quả theo (cơ sở, tab, bộ lọc của tab).
9. Biểu đồ **Giá trị tồn kho theo ngày** (migration `0025`, job `inventoryValueSnapshot.js`), Báo cáo hàng hóa gộp 2 cơ sở (`product_report` migration `0018`), bảng chi tiết doanh số 90 ngày từng khách (`product_report_customers` migration `0023`).
10. **Vòng đời đơn hàng hợp nhất đơn KiotViet mọi trạng thái**: bảng ~60K đơn (Phiếu tạm, Đã xác nhận, Đang giao hàng, Hoàn thành, Đã hủy) ghép Google Sheet; lọc/sắp xếp/phân trang chạy ở server (`shipment/orderLifecycleQuery.js`); xuất Excel quyền `shipment.export` chỉ Quản lý; cache stale-while-revalidate 2 phút (`shipment/kiotOrdersRepository.js`).
11. **Quy định công ty** (tab HR): bảng `hr_rule_documents` (migration `0027`), 2 tài liệu dựng sẵn + PDF upload, quyền `hr.rules`/`hr.rules.manage`, thông báo chuông.
12. Dọn bảng `suppliers` và `daily_purchase_summary` (migration `0026`) sau khi gỡ tab Nhà cung cấp.

## Bot Telegram quản lý nghỉ phép — kế hoạch đã duyệt 02/10/2026

Bot riêng cho quản lý chạy trong Express, dùng webhook xác thực secret và quét PostgreSQL mỗi 5 giây mặc định. Bot xin nghỉ của nhân viên hiện có tiếp tục chạy ngoài repo. Phạm vi/chấp thuận chi tiết ở [kế hoạch lưu](../superpowers/plans/2026-10-02-telegram-manager-leave.md); hướng dẫn cấu hình ở [thiết lập bot](../telegram-manager-leave-setup.md).

| Hạng mục | Nội dung | Trạng thái |
|---|---|---|
| Schema | Migration `0029_hr_manager_telegram.sql`: `decision_version`, sự kiện tạo/đổi đơn, giao tin/lease/retry, phiên từ chối, inbox update idempotent và singleton mốc bật lần đầu | Đã duyệt |
| Quyết định | `hrLeaveDecisionService.js` dùng chung web/Telegram; khóa final trên Telegram, web sửa/mở lại; lý do tối đa 500 ký tự | Đã duyệt |
| Bot quản lý | `server/telegram/`: render, API native fetch, webhook, xử lý quyền/cơ sở, runtime quét và đồng bộ bản tin | Đã duyệt |
| Cầu web | `hrLeaveDbRealtime.js` phát SSE khi DB đổi ngoài repo, bản chụp/phiên bản dùng chung; connect/reconnect làm mới danh sách | Đã duyệt |
| Vận hành | Biến môi trường, `telegram-manager:set-webhook`, Start bot mới cho từng quản lý, kiểm tra cơ sở và trạng thái | Chờ cấu hình và kiểm tra môi trường triển khai |

Thứ tự vận hành: **áp migration 0029 trước khi chạy bản web mới, kể cả khi bot tắt** → cấu hình token/secret/origin → khởi động server → đăng ký webhook → quản lý Start bot → kiểm tra giao tin, quyết định, reopen và retry. Không thay `decision_notified_at` hay phiên bot nhân viên. Cần máy chủ luôn chạy để đạt gần thời gian thực; tắt `HR_MANAGER_TELEGRAM_ENABLED` dừng bot quản lý và giữ luồng web/bot nhân viên.

## Vận hành

- Chạy migration trước khi deploy: `npm run db:migrate`.
- Bật `KIOTVIET_SYNC_ENABLED=true` khi cấu hình KiotViet và Supabase đã hợp lệ.
- Service account cần quyền Viewer trên workbook Công nợ (`DEBT_MANAGEMENT_SPREADSHEET_ID`) và Editor trên workbook Vòng đời đơn hàng (`ORDER_LIFECYCLE_SPREADSHEET_ID`).
- Hai file Kiot HN/SG **không còn** được server truy cập (không cần cấu hình `SPREADSHEET_ID`/`SPREADSHEET_ID_SG`).
- Không tạo lại các tab KiotViet khác hoặc cài Apps Script vào hai file này.
