# Implementation plan hiện tại

Cập nhật: 2026-10-12 (Giảm egress Supabase: purchases.raw_hash, cache hóa đơn theo sự kiện, bot/realtime nghỉ phép nhẹ hơn; Đã hoàn thiện Ngày đặc biệt (thông báo chuông + pháo hoa), Báo cáo kinh doanh, Báo cáo Marketing, Sổ quỹ, Lịch làm việc & Hạn nghỉ phép, Trạng thái nhân sự, Audit log, Table controls; hệ thống schema đạt migration 0001–0044).

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
10b. **Vòng đời đơn hàng — luồng Đơn Bắc-Nam (12/10/2026)**: đọc thêm tab `DonHang_MienNam` của workbook `ORDER_LIFECYCLE_SPREADSHEET_ID`, tính như đơn Hà Nội (`_branch: 'HN'`), chỉ 4 mốc Mã đơn/Sale gửi KT/KT duyệt đơn/Đã ký nhận, không cảnh báo 24h, fail-soft; kế hoạch tại [tasks/2026-10-12-lifecycle-north-south](../../tasks/2026-10-12-lifecycle-north-south/plan.md).
10c. **Vòng đời đơn hàng — 5 luồng + cảnh báo có tên (12/10/2026)**: tab `Khách_HN`/`Khách_SG` (`_flow: PICKUP`), `computeWarnings` (6 mã, giờ làm việc 6h–18h cho Kế toán sót đơn), bộ lọc `warning`, xuất Excel ghi tên cảnh báo. Tính trong RAM, không migration.
10d. **Hộp "xem chi tiết" dùng chung (12/10/2026)**: `public/shared/detail-panel.css` (`.dp-*`) cho hộp chi tiết giao dịch/sản phẩm/báo cáo kinh doanh, đơn vòng đời, nghỉ phép, Marketing; hàng chỉ số tổng quan, bảng tắt bộ chọn cột (`data-table-controls="off"`). "Kế toán sót đơn" chỉ áp dụng khi trạng thái còn "Đơn đã gửi kế toán".
10e. **Phân trang bảng nhân sự & quản trị tài khoản (12/10/2026)**: áp dụng điều khiển phân trang chuẩn (`table-controls.js`) cho bảng nhân sự, chấm công, nghỉ phép tại `/humanresources/` và bảng quản lý người dùng tại `/account/` (test `test/frontend/hr-account-pagination.test.js`).
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
24. **Ngày đặc biệt: thông báo chuông + pháo hoa** (migration `0043`): `public/shared/special-days.js` (ngày lễ Việt Nam dương/âm lịch + sinh nhật 27/10, dùng chung server/trình duyệt), job `notifications/specialDayNotifier.js` báo lên chuông cho tài khoản có `hr.leave` (chống trùng bằng `special_day_notice_log`), `public/shared/fireworks.js` thay sao băng trong các ngày này; lịch nghỉ phép không đổi.
25. **Vòng đời đơn hàng: chỉ số tổng quát đầu trang** (2026-10-12, không migration): `GET /api/shipment/lifecycle` trả thêm `kpis` (`orderLifecycleQuery.countSummary`: Chưa gửi KT chỉ tính Phiếu tạm / Đã gửi KT / Đang giao + số đơn vi phạm theo từng mã cảnh báo, đếm theo bộ lọc hiện tại, tính trong RAM); dải thẻ bấm-để-lọc ở `public/shipment/lifecycle/index.html`.
26. **Giảm egress Supabase** (migration `0044`): đối soát phiếu nhập bằng `purchases.raw_hash`; cache Hóa đơn/Chi tiết hóa đơn hết hạn theo sự kiện `invoicesChanged` (dự phòng 15 phút, guard thế hệ); bot Telegram quản lý cache danh sách 5 phút nạp lazy; realtime nghỉ phép chỉ poll `getLeaveVersions`.

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

## Marketing Pancake — trạng thái 12/10/2026

Mã T3–T6 đã triển khai và qua kiểm thử; nguồn chính thức vẫn là Sheets. Ngày 12/10/2026 đã khôi phục ID tin nhắn từ sáu bản xuất đầy đủ (migration 0046): 18.304 dòng lịch sử thật đều có liên kết (18.294 duy nhất, 7 chỉ khác cách viết số +84/0 thừa đã kiểm cùng giây-cùng nhân viên, 3 dòng thuộc cặp tin tương đương = 6 liên kết); chỉ còn dòng tiêu đề lặp BL THÔ!1950 (không phải quan sát). 3.148 tin trong kỳ nằm ngoài nền Sheets được ghi sổ riêng, không tính. Đồng bộ thật đủ sáu page đạt (slot 12/10): 11.797 fact, 2.478 quan sát cùng ngày ghi nhận 12/10 (thay đổi nhân viên tích lũy từ lúc dán Sheets và 861 tin mới), 0 mục chưa giải quyết, 0 dòng lịch sử chưa liên kết; nền lịch sử khớp CHUẨN (11.942 nhóm SĐT); tổng khớp chi tiết 100/100 (T10) và 80/80 (T9). Công tắc job vẫn TẮT và nguồn vẫn Sheets: chưa có ba đợt hằng đêm đối soát, chưa cấu hình token trên Render. Lưu ý nghiệm thu: lần đồng bộ đầu dồn các thay đổi nhân viên cũ vào ngày 12/10 nên "chào lại" tháng 10 tăng mạnh (179 → 1.660); cần Quản lý xác nhận cách tính trước khi chuyển nguồn.

`PANCAKE_MARKETING_SYNC_ENABLED=false` mặc định; chỉ bật sau khi khôi phục ID và thử đồng bộ đạt. `MARKETING_REPORT_SOURCE=sheets` mặc định; đặt `postgres` sau ít nhất ba đợt hằng ngày đối soát đủ sáu page. Token `PANCAKE_PAGE_TOKEN_<pageId>` chỉ ở phía máy chủ, không commit hoặc trả API. Giữ riêng Tạo lúc và ngày ghi nhận thành công Việt Nam; lịch sử giữ ngày cũ. ADS luôn đọc Sheets (kể cả Quảng Châu); doanh số luôn lấy KiotViet theo tên, bán trừ trả hàng HN+SG.

T1/T2/T3 đã có bằng chứng DB; T4–T6 mã nguồn được kiểm thử sau công tắc; T7 chưa đạt. Khôi phục ID từ bản xuất đầy đủ trước đồng bộ thật, sau đó nghiệm thu ba ngày và mới chuyển nguồn.
