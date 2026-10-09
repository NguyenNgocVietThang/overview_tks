# Implementation plan hiện tại

Cập nhật: 2026-10-09 (Đã hoàn thiện Báo cáo kinh doanh, Báo cáo Marketing, Sổ quỹ, Lịch làm việc & Hạn nghỉ phép, Trạng thái nhân sự, Audit log, Table controls; hệ thống schema đạt migration 0001–0042).

## Kiến trúc đã triển khai

1. KiotViet API được đồng bộ vào Supabase bởi `server/kiotvietSync/` (webhook + polling + backfill).
2. Dashboard đọc các bảng vận hành từ Supabase qua `dashboardPgReader.js`; không còn đọc dữ liệu vận hành từ Google Sheets.
3. CN1/CN3/CN7 (công nợ 1/3/7 ngày, trước đây gọi là HN1/HN3/HN7) được refresh vào `customer_debt_activity_periods` và đọc bằng `customerDebtActivityRepository.js`.
4. **Trả NCC** đã hoàn toàn rời Google Sheets: người dùng tự upload file Excel xuất từ KiotViet, server lưu vào `supplier_return_imports` (migration `0017`) — pipeline kiểm tra đứt hàng (`stockoutPgSource.js`) đọc trực tiếp từ Postgres.
5. Apps Script HN/SG, tab `Users` và module vận chuyển cũ đã được xóa. Google Sheets còn dùng cho: Công nợ (`DEBT_MANAGEMENT_SPREADSHEET_ID`, chỉ đọc), Vòng đời đơn hàng (`ORDER_LIFECYCLE_SPREADSHEET_ID`, đọc + ghi tab `Lịch sử cập nhật`) và Vị trí hàng (`STOCK_LOCATIONS_SPREADSHEET_ID`, chỉ đọc). Workbook HR không còn được đọc: danh sách nhân sự nằm ở Postgres `hr_employees`.
6. Tài khoản và Telegram ID nằm trong PostgreSQL (`app_users`). Luồng liên kết Telegram hoàn thiện bởi migration `0016`: 3 bảng `hr_leave_requests`/`hr_telegram_links`/`hr_telegram_sessions`; trigger tự đồng bộ `app_users.telegram_id` từ `hr_telegram_links`.
7. Phân quyền theo tính năng từng tài khoản (`feature_permissions JSONB`, migration `0020`) và vai trò `Nhân viên marketing` (migration `0019`).
8. Báo cáo tổng hợp tải **theo từng tab**: `GET /api/dashboard?view=<tab>` chỉ đọc/tính/trả phần của tab (khai báo ở `dashboardViews.js`); cache bảng nguồn theo từng bảng, cache kết quả theo (cơ sở, tab, bộ lọc của tab).
9. Biểu đồ **Giá trị tồn kho theo ngày** (migration `0025`, job `inventoryValueSnapshot.js`), Báo cáo hàng hóa gộp 2 cơ sở (`product_report` migration `0018`), bảng chi tiết doanh số 90 ngày từng khách (`product_report_customers` migration `0023`).
10. **Vòng đời đơn hàng hợp nhất đơn KiotViet mọi trạng thái**: bảng ~60K đơn (Phiếu tạm, Đã xác nhận, Đang giao hàng, Hoàn thành, Đã hủy) ghép Google Sheet; lọc/sắp xếp/phân trang chạy ở server (`shipment/orderLifecycleQuery.js`); xuất Excel quyền `shipment.export` chỉ Quản lý; cache stale-while-revalidate 2 phút (`shipment/kiotOrdersRepository.js`). Từ 2026-10-03 mọi quyền phụ (Tra cứu, Lịch sử, Xuất, Ghi đè) gắn vào `shipment.lifecycle`; Nhân viên kho/marketing/mua hàng và Khách không còn trang này.
11. **Quy định công ty** (tab HR): bảng `hr_rule_documents` (migration `0027`), 2 tài liệu dựng sẵn + PDF upload, quyền `hr.rules`/`hr.rules.manage`, thông báo chuông.
12. Dọn bảng `suppliers` và `daily_purchase_summary` (migration `0026`) sau khi gỡ tab Nhà cung cấp.
13. **Vị trí hàng** (2026-10-03): module `stockLocations/` đọc trực tiếp hai sheet HN/SG của workbook dùng chung, trang `/stock-locations/` 6 cột (Mã hàng, Tên hàng, Tổng SL, Ghi chú hàng hóa, Ngày về, Vị trí), quyền `stockLocations.view` (Khách bị chặn). Không migration, không job; xem [thiết lập](../stock-locations-setup.md).
14. **Tài khoản** (2026-10-03): tự đăng ký bị khóa (`ALLOW_SELF_REGISTRATION`), ID Telegram lưu trong một giao dịch đồng bộ `app_users`/`hr_telegram_links`/`hr_employees` và chỉ Quản lý được sửa; trang Quản lý người dùng nhập hộ ID.
15. **Nghỉ phép (web)**: gỡ trạng thái `Tạm duyệt` (migration `0030`), bảng nghỉ phép có phân trang, lịch nghỉ phép cạnh chuông thông báo (quyền `hr.leave`). Đơn xin nghỉ do bot ngoài repo ghi trực tiếp; web chỉ nhập tay "Tự ý nghỉ" và duyệt.
16. **Bảo mật hồ sơ & dọn API** (2026-10-05, đã commit): hồ sơ cá nhân không tự đổi email/SĐT (TK nhân sự chỉ Quản lý đổi; TK thường đổi email qua OTP gửi tới email mới — `/api/auth/profile/contact-change`); TK đã gắn dòng nhân sự không tự nhảy sang dòng khác. Gỡ API không còn dùng: `GET /api/search`, `GET /api/customer-product-top`, export `search.results`, `/api/auth/register/{channels,send-otp,verify}`, `GET /api/hr/telegram/link-status`, `POST /api/shipment/lifecycle/lookup`; gỡ trường payload dashboard không hiển thị (KPI "hôm nay", `activeProducts`, `stockByCategory`…, bộ lọc `ov*`). Không migration.
17. **Sổ quỹ** (2026-10-06 đến 2026-10-08): module `cashbook/` đọc phiếu thu/chi KiotViet, danh mục tài khoản ngân hàng `cash_book_accounts` và tên ngân hàng tùy chỉnh `cash_book_account_banks` (migration `0033`, `0034`); đối soát giữ lịch sử bằng `source_missing_at` (migration `0035`); bảng số dư hiển thị theo 5 nhóm tài khoản (`account_balance_groups`), phân tách cột ngân hàng riêng, bộ lọc nhóm và xuất Excel/HTML chọn cột. Tự cập nhật mốc revision mỗi 15 giây.
18. **Báo cáo kinh doanh** (2026-10-07 đến 2026-10-08): tab `/reports/#business` theo dõi tăng trưởng Sale / Khách hàng / Mã hàng theo tháng từ T3/2026 gộp HN + SG; doanh số tháng chốt cứng vào các bảng `business_monthly_*` (migration `0036`) bởi job `businessMonthlyRefresh.js`; phân chia Team cho sale theo `sale_teams` (migration `0037`, nạp từ `chia team.xlsx`); gộp khách hàng theo tên chuẩn hóa; panel chi tiết và hộp thoại xuất file tùy chọn cột.
19. **Báo cáo Marketing** (2026-10-08): tab `/reports/#marketing` kết nối 3 workbook Google Sheets (Trực page, SĐT, Ads); đối chiếu doanh số KiotViet theo tên khách hàng; Quản lý/Marketing có thể sửa trực tiếp Khách mới và Ghi chú đồng bộ ngược lại Google Sheets (`PUT /api/marketing-report/monthly/row`); xuất báo cáo XLSX và HTML.
20. **Lịch làm việc & Hạn đăng ký nghỉ phép** (migration `0038`, `0042`): bảng `hr_leave_work_schedules` và `hr_leave_submissions` bất biến; ca làm việc cố định sáng 07:45 / chiều 12:30; tự động gán nhãn `timing_status` Đúng hạn / Xin muộn / Vi phạm; cho phép mọi tài khoản nội bộ đang hoạt động (trừ Khách) chưa gắn hồ sơ nhân sự vẫn gửi được đơn xin nghỉ qua web.
21. **Quản lý trạng thái nhân sự & Quy định phúc lợi** (migration `0039`, `0041`): tài liệu Chi tiêu & Phúc lợi (`phuc-loi`), `hr_employees.employment_status` (`active` = Đang làm việc / `resigned` = Đã nghỉ việc) tách khỏi xóa mềm `is_active`, tự động khóa tài khoản liên kết khi nhân sự nghỉ việc (`lock_reason = 'hr_resigned'`) và mở khóa lại khi kích hoạt.
22. **Lịch sử chỉnh sửa tài khoản** (migration `0040`): bảng `account_audit_log` ghi log bất biến mọi thao tác tạo, sửa thông tin, đặt lại mật khẩu, xóa, phân quyền tài khoản; tab `/account/#history` phục vụ tra cứu quản trị.
23. **Chuẩn hóa điều khiển bảng dùng chung**: `public/shared/table-controls.js` (chọn cột, kéo chỉnh độ rộng cột, phân trang) và tiện ích `search-clear` trên toàn bộ hệ thống; tối ưu hóa giao diện responsive desktop/mobile.

## Bot Telegram quản lý nghỉ phép — kế hoạch đã duyệt 02/10/2026

Bot riêng cho quản lý chạy trong Express, dùng webhook xác thực secret và quét PostgreSQL mỗi 5 giây mặc định. Bot xin nghỉ của nhân viên hiện có tiếp tục chạy ngoài repo. Phạm vi/chấp thuận chi tiết ở [kế hoạch lưu](../superpowers/plans/2026-10-02-telegram-manager-leave.md); hướng dẫn cấu hình ở [thiết lập bot](../telegram-manager-leave-setup.md).

| Hạng mục | Nội dung | Trạng thái |
|---|---|---|
| Schema | Migration `0029_hr_manager_telegram.sql`: `decision_version`, sự kiện tạo/đổi đơn, giao tin/lease/retry, phiên từ chối, inbox update idempotent và singleton mốc bật lần đầu; `0030` gỡ `Tạm duyệt` | Đã triển khai trong code |
| Quyết định | `hrLeaveDecisionService.js` dùng chung web/Telegram; khóa final trên Telegram, web sửa/mở lại; lý do tối đa 500 ký tự | Đã triển khai trong code |
| Bot quản lý | `server/telegram/`: render, API native fetch, webhook, xử lý quyền/cơ sở, runtime quét và đồng bộ bản tin; chỉ hai nút Phê duyệt / Từ chối | Đã triển khai trong code (02/10) |
| Cầu web | `hrLeaveDbRealtime.js` phát SSE khi DB đổi ngoài repo, bản chụp/phiên bản dùng chung; connect/reconnect làm mới danh sách | Đã triển khai trong code |
| Vận hành | Biến môi trường, `telegram-manager:set-webhook`, Start bot mới cho từng quản lý, kiểm tra cơ sở và trạng thái | Chờ cấu hình và kiểm tra môi trường triển khai |

Thứ tự vận hành: **áp migration 0029 và 0030 trước khi chạy bản web mới, kể cả khi bot tắt** → cấu hình token/secret/origin → khởi động server → đăng ký webhook → quản lý Start bot → kiểm tra giao tin, quyết định, reopen và retry. Không thay `decision_notified_at` hay phiên bot nhân viên. Cần máy chủ luôn chạy để đạt gần thời gian thực; tắt `HR_MANAGER_TELEGRAM_ENABLED` dừng bot quản lý và giữ luồng web/bot nhân viên.

## Vận hành

- Chạy migration trước khi deploy: `npm run db:migrate`.
- Bật `KIOTVIET_SYNC_ENABLED=true` khi cấu hình KiotViet và Supabase đã hợp lệ.
- Service account cần quyền Viewer trên workbook Công nợ (`DEBT_MANAGEMENT_SPREADSHEET_ID`) và Vị trí hàng (`STOCK_LOCATIONS_SPREADSHEET_ID`), Editor trên workbook Vòng đời đơn hàng (`ORDER_LIFECYCLE_SPREADSHEET_ID`).
- Webhook KiotViet trỏ về `/api/kiotviet/webhook/<KIOTVIET_WEBHOOK_SECRET>`; sau khi đổi, đặt `KIOTVIET_WEBHOOK_LEGACY_PATH_ENABLED=false`. Webhook chỉ lưu thô — dữ liệu do polling cập nhật.
- Sau khi áp migration báo cáo mới (`0022`, `0023`, `0025`), chạy tay lần đầu `node kiotvietSync/customerInvoiceLinesRefresh.js`, `node kiotvietSync/productReportRefresh.js` trong `server/` để có dữ liệu ngay thay vì chờ job đêm.
- Hai file Kiot HN/SG **không còn** được server truy cập (không cần cấu hình `SPREADSHEET_ID`/`SPREADSHEET_ID_SG`).
- Không tạo lại các tab KiotViet khác hoặc cài Apps Script vào hai file này.


## Nâng cấp nghỉ phép/phân quyền 05/10/2026

Kế hoạch/checklist riêng tại [tasks/2026-10-05-hr-approval](../../tasks/2026-10-05-hr-approval/plan.md). Migration `0031` áp staging trước ứng dụng; nghiệm thu Telegram thật/latency và production chưa hoàn tất. Kế hoạch tasks có trước được giữ nguyên.
