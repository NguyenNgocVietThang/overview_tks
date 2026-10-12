# CURRENT: BẢNG TRẠNG THÁI THỜI GIAN THỰC (REALTIME DASHBOARD)

> **Cập nhật gần nhất:** 12/10/2026 (Asia/Ho_Chi_Minh), phiên "giảm egress Supabase"  
> **Trạng thái Git:** Branch `perf/egress-reduction`, chưa merge vào `main`, chưa deploy.
> **Quy tắc:** Cập nhật liên tục vào đầu và cuối mỗi phiên làm việc để không bị đứt đoạn ngữ cảnh dự án.

---

## 1. Tổng quan trạng thái hiện tại (Current Status)

| Hạng mục | Trạng thái | Chi tiết |
|---|---|---|
| **Mã nguồn Backend** | Hoàn thành | Node.js Express, hỗ trợ 7 tab báo cáo, sổ quỹ, nhân sự, tài khoản, bot Telegram |
| **Cơ sở dữ liệu** | 0001 → 0044 | Đầy đủ 44 migration từ dữ liệu lõi đến đánh dấu thông báo ngày đặc biệt (`0043`, chưa áp Production) và `purchases.raw_hash` (`0044`, chưa áp) |
| **Kiểm thử tự động** | 2.195/2.199 xanh | Test mới của tính năng đều xanh. 4 test lỗi ở xuất Excel/HTML tồn kho (`dashboard/exportService.test.js`, `test/frontend/branch-column-tables.test.js`: cột "Vận chuyển SG"), không thuộc phạm vi phiên này, chưa xử lý |
| **Knowledge Graph** | Đã cập nhật | Graphify updated ngày 09/10/2026 (6.389 nodes, 12.615 edges, 368 communities) |
| **Tài liệu hệ thống** | Đồng bộ 100% | `README.md`, `server/README.md`, `SCHEMA.md`, `implementation_plan.md`, SRS, BRD, MEMORY.md |

---

## 2. Các đầu việc vừa hoàn thành (Recently Completed — Tháng 10/2026)

0. **Vòng đời đơn hàng — chỉ số tổng quát đầu trang (12/10/2026, branch `main`, chưa commit/deploy, không migration):**
   - Dải thẻ trên bảng "Toàn bộ đơn hàng": Chưa gửi kế toán (**chỉ đơn Phiếu tạm**), Đã gửi kế toán, Đang được giao; và Tổng đơn vi phạm + 6 thẻ theo từng loại cảnh báo. Bấm thẻ = lọc nhanh bảng (bấm lại để bỏ).
   - API `GET /api/shipment/lifecycle` thêm `kpis: { status, warnings }` (`orderLifecycleQuery.countSummary`): đếm theo bộ lọc hiện tại, thẻ trạng thái bỏ lọc `status`, thẻ cảnh báo bỏ lọc `warning`. Tính trong RAM, 0 truy vấn mới. `warningCounts` (theo cơ sở) giữ nguyên.
   - Test: `orderLifecycleQuery.test.js`, `orderLifecycleWarning.test.js`, `test/frontend/order-lifecycle-kpis.test.js` (mới), `lifecycleFakeServer.js` trả `kpis`.

0. **Vòng đời đơn hàng — 5 luồng + 6 cảnh báo có tên (12/10/2026, branch `main`, chưa commit/deploy, không migration):**
   - Đọc thêm tab `Khách_HN`/`Khách_SG` (khách/ship lấy tại kho; chỉ Mã đơn / Sale gửi KT / KT duyệt / Ship nhận đơn; fail-soft). `DonHang_HN/SG` bỏ qua cột Ship nhận đơn.
   - Cờ cảnh báo 24h cũ thay bằng `warnings` (mã) + `warning` (boolean): Kế toán sót đơn (mọi tab: Sale gửi KT, KT chưa duyệt, đủ 30 phút tính trong giờ 6h–18h), Lái xe chưa chụp đơn (DonHang_HN/SG: Sale gửi >24h, chưa Tài xế gửi xác nhận, chưa ký nhận), Lái xe quên chụp (DonHang_HN/SG: đã ký nhận mà chưa Tài xế gửi xác nhận), Chưa nhận đơn quá 6 giờ (DonHang_HN/SG: Tài xế gửi xác nhận >6h chưa ký nhận), Khách/Ship chưa lấy (Khách_HN/SG: Sale gửi >2 ngày chưa Ship nhận đơn), Chưa chụp bill tàu (DonHang_MienNam: Sale gửi >24h chưa ký nhận). Tự mất khi bước tương ứng đã làm; đơn hủy/sự cố không cảnh báo.
   - Tính trong RAM từ dữ liệu sheet + đồng hồ (0 truy vấn Supabase mới). Thêm bộ lọc "Cảnh báo" (`?warning=any|<mã>`), `warningCounts` trong API, xuất Excel ghi tên cảnh báo.
   - Lỗi tồn tại sẵn (không do thay đổi này): 4 test `dashboard/exportService.test.js` + `test/frontend/branch-column-tables.test.js` fail cả trên HEAD sạch.

0. **Vòng đời đơn hàng — luồng Đơn Bắc-Nam (12/10/2026, branch `main`, chưa commit/deploy, không migration):**
   - Đọc thêm tab `DonHang_MienNam` (cùng workbook `ORDER_LIFECYCLE_SPREADSHEET_ID`); tính như đơn Hà Nội, chỉ 4 mốc (Mã đơn / Sale gửi KT / KT duyệt đơn / Đã ký nhận), bỏ qua cột lái xe/ship, không cảnh báo 24h, fail-soft có log.
   - Code: `config.js`, `shipment/orderLifecycleRepository.js`, `shipment/orderLifecycleService.js`; 8 test mới (`orderLifecycleRepository.test.js`, `orderLifecycleWarning.test.js`). Đã kiểm tra thật: `DH043419` hiện Hà Nội, "Đơn đã gửi kế toán".
   - Kế hoạch/danh sách việc: `tasks/2026-10-12-lifecycle-north-south/`. Deploy chỉ cần restart server.

1. **Giảm egress Supabase (Migration `0044`, nhánh `perf/egress-reduction`, chưa merge/deploy):**
   - `purchases.raw_hash`: đối soát phiếu nhập so băm thay vì tải `raw`.
   - Cache Hóa đơn/Chi tiết hóa đơn hết hạn theo `invoicesChanged` (dự phòng 15 phút, guard thế hệ); CLI backfill hiện sau ≤15 phút.
   - Bot Telegram quản lý: cache danh sách quản lý 5 phút, nạp lazy; realtime nghỉ phép chỉ poll `getLeaveVersions`.
   - **Lưu ý deploy:** phải áp `0044` TRƯỚC khi chạy code mới; lượt quét phiếu nhập đầu tiên sẽ ghi lại toàn bộ một lần.
   - 4 test lỗi cũ (xuất Excel/HTML tồn kho) vẫn còn, không thuộc phạm vi.

2. **Ngày đặc biệt — thông báo chuông + pháo hoa (Migration `0043`):**
   - `public/shared/special-days.js` (UMD): ngày lễ dương/âm lịch + sinh nhật 27/10; `notifications/specialDayNotifier.js` báo lên chuông cho mọi tài khoản đang hoạt động có `hr.leave`, chống trùng bằng `special_day_notice_log`; cờ `SPECIAL_DAYS_NOTIFY_ENABLED`.
   - `createNotificationForUsers` ghi file đúng 1 lần cho cả lô.
   - `fireworks.js` thay sao băng vào ngày đặc biệt (`shooting-star.js` chọn hiệu ứng; `?fireworks=1` để xem thử); `?v=` của `shooting-star.js` nâng lên `20261009`.
   - Test mới: `test/frontend/special-days.test.js`, `test/frontend/fireworks.test.js`, `notifications/specialDayNotifier.test.js`, `db/specialDayNoticeLogMigration.test.js`, bổ sung `notificationRepository.test.js`.

3. **Nghỉ phép cho tài khoản nội bộ chưa gắn nhân sự (Migration `0042`):**
   - Cho phép mọi tài khoản nội bộ đang hoạt động (trừ Khách) tự gửi đơn xin nghỉ phép trên web ngay cả khi chưa gắn hồ sơ `hr_employee_id`.
   - Cơ sở lấy từ đơn, áp dụng giờ làm việc mặc định sáng 07:45 / chiều 12:30.
   - Bổ sung kiểm thử backend và frontend tương ứng.
3. **Quản lý trạng thái nhân sự (Migration `0041`):**
   - Phân biệt trạng thái làm việc `employment_status` (`active` / `resigned`) khỏi xóa mềm `is_active`.
   - Tự động khóa tài khoản liên kết với mã `lock_reason = 'hr_resigned'` khi nhân sự nghỉ việc; mở lại khi kích hoạt.
4. **Chuẩn hóa UI & Điều khiển bảng dùng chung (`table-controls` & `search-clear`):**
   - Áp dụng `table-controls.js` cho tất cả các bảng dữ liệu: ẩn/hiện cột, kéo chỉnh độ rộng cột, phân trang mượt mà.
   - Thêm tiện ích nút xóa nhanh `search-clear` cho các ô tìm kiếm.
   - Tắt điều khiển cột cho bảng quy định chế độ phúc lợi để bảo toàn bố cục tĩnh.
5. **Báo cáo Marketing (`/reports/#marketing`):**
   - Đọc dữ liệu từ 3 workbook Google Sheets (Trực page, SĐT, Ads).
   - Tích hợp cột Doanh số KiotViet đối chiếu theo tên khách hàng chuẩn hóa.
   - Hỗ trợ sửa trực tiếp ô Khách mới / Ghi chú đồng bộ ngược lại Google Sheets (`PUT /api/marketing-report/monthly/row`).
   - Bổ sung tính năng xuất báo cáo định dạng XLSX và HTML kèm hộp thoại chi tiết.
6. **Lịch sử chỉnh sửa tài khoản (Migration `0040`):**
   - Tạo bảng `account_audit_log` ghi nhận bất biến mọi thao tác tạo, sửa, đặt lại mật khẩu, xóa, phân quyền.
   - Xây dựng tab tra cứu `/account/#history` cho Quản trị viên.
7. **Quy định công ty — Tài liệu Chi tiêu & Phúc lợi (Migration `0039`):**
   - Bổ sung tài liệu dựng sẵn thứ 3 (`phuc-loi`) vào `hr_rule_documents`.
8. **Báo cáo kinh doanh (Migration `0036`, `0037`):**
   - Chốt cứng doanh số tháng vào `business_monthly_*` với job `businessMonthlyRefresh.js`.
   - Bổ sung cột Team của sale và bộ lọc Team (`sale_teams` nạp từ `chia team.xlsx`).
   - Gộp khách hàng theo tên chuẩn hóa và thêm modal chọn trường khi xuất file.
9. **Hạn đăng ký nghỉ phép & Lịch làm việc (Migration `0038`):**
   - Snapshot thời gian tại DB, giờ bắt đầu ca cố định 07:45 / 12:30, gán nhãn Đúng hạn / Xin muộn / Vi phạm.
10. **Sổ quỹ toàn công ty (Migration `0033`, `0034`, `0035`):**
   - Hiển thị số dư theo 5 nhóm tài khoản (`account_balance_groups`), phân tách cột ngân hàng riêng.
   - Cơ chế đối soát đánh dấu `source_missing_at` bảo toàn toàn vẹn lịch sử.
   - Kiểm tra revision tự động mỗi 15 giây khi tab hiển thị.

---

## 3. Hành động tiếp theo cần thực hiện (Next Steps & Operations)

- [ ] **Pancake Marketing — đang xác minh kết nối (09/10/2026):**
  - Kế hoạch và checklist ở `tasks/2026-10-09-pancake-marketing/`; chỉ mới thêm tài liệu, chưa thay đổi chức năng hoặc schema.
  - Cần Public API token phía máy chủ để đối chiếu với file Sao lưu thật trước khi triển khai các bước tiếp theo. Cấu hình local chưa có token; Hữu Nghị chưa tạo token.
  - Mục tiêu đã chốt: sáu Fanpage Facebook, loại Zalo, đồng bộ 23:55 mỗi ngày, KPI theo ngày ghi nhận và công thức Sheets, BC tháng chỉ Quản lý nhập/sửa; ADS tiếp tục đọc Sheets.

- [ ] **Staging / Production Deployment:**
  - Áp dụng các migration mới (`0036` đến `0044`) lên cơ sở dữ liệu Supabase Production ngoài giờ cao điểm: `npm run db:migrate`.
  - Khởi động lại server để nạp scheduler và cấu hình mới.
- [ ] **Khởi tạo dữ liệu Báo cáo kinh doanh trên Production:**
  - Chạy tay lệnh backfill tháng lần đầu trong thư mục `server/`:
    ```bash
    node kiotvietSync/businessMonthlyRefresh.js
    ```
  - Kiểm tra bảng `business_monthly_state` để xác nhận các tháng từ T3/2026 đã chốt đủ.
- [ ] **Nạp danh mục Team của sale:**
  - Nếu có thay đổi danh sách chia team, chạy lệnh:
    ```bash
    node scripts/importSaleTeams.js "path/to/chia team.xlsx"
    ```
- [ ] **Vận hành Telegram Bot quản lý nghỉ phép:**
  - Đăng ký webhook Telegram production: `npm run telegram-manager:set-webhook`.
  - Hướng dẫn các Quản lý có Telegram ID bấm `/start` với bot quản lý để nhận thông báo duyệt đơn.
