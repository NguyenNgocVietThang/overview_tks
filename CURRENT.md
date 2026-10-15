# CURRENT: BẢNG TRẠNG THÁI THỜI GIAN THỰC (REALTIME DASHBOARD)

> **Cập nhật gần nhất:** 15/10/2026 (Asia/Ho_Chi_Minh), điều chỉnh chốt phạt 14:59 theo ngày và chỉ tính thưởng khi chốt tháng.
> **Trạng thái Git:** làm việc trực tiếp trên `main` theo yêu cầu; thay đổi thưởng/phạt sale hoàn tất và qua kiểm thử; chưa push/deploy phiên này.
> **Quy tắc:** Cập nhật liên tục vào đầu và cuối mỗi phiên làm việc để không bị đứt đoạn ngữ cảnh dự án.

---

## 1. Tổng quan trạng thái hiện tại (Current Status)

| Hạng mục | Trạng thái | Chi tiết |
|---|---|---|
| **Mã nguồn Backend** | Hoàn thành | Node.js Express, hỗ trợ 7 tab báo cáo, sổ quỹ, nhân sự, tài khoản, bot Telegram |
| **Cơ sở dữ liệu** | 0001 → 0048 | `0047_debt_schedule_report` đã áp lên DB dùng chung 13/10; đã import lịch TT SG 1.228 + HN 3.072 (nhật ký 4.300 dòng import). | Migration `0044_pancake_marketing`, `0045_pancake_current_input`, `0046_pancake_history_identity` và `0044_purchases_raw_hash` đã áp lên DB dùng chung (kiểm `schema_migrations` ngày 12/10). `0043` đã áp. Hai file cùng tiền tố 0044 là chủ ý, runner chạy theo tên đầy đủ |
| **Kiểm thử tự động** | 2.296/2.299 xanh (13/10) | Sau thay đổi công nợ: 2.296 đạt, 3 skipped, 0 lỗi. Trước đó: | Chạy trên `main` đã gộp: 2.295 đạt, 3 skipped (theo cấu hình), 0 lỗi. 4 test tồn kho cũ đã đổi kỳ vọng theo giao diện hiện hành, logic không đổi |
| **Knowledge Graph** | Đã cập nhật | Graphify updated ngày 12/10/2026 (thư mục cache `graphify-out/cache/ast/v0.9.55-s2/` cũ còn chưa theo dõi, xóa tay được) |
| **Tài liệu hệ thống** | Đồng bộ 100% | `README.md`, `server/README.md`, `SCHEMA.md`, `implementation_plan.md`, SRS, BRD, MEMORY.md |

---

## 2. Các đầu việc vừa hoàn thành (Recently Completed — Tháng 10/2026)

0. **Điều chỉnh ngày/tháng thưởng phạt (15/10/2026, main):** Điều chỉnh 15/10/2026: trong tháng chỉ hiển thị điểm/hạng và tổng phạt từ các ngày ĐÃ CHỐT, không cộng chu kỳ đang mở. Lúc 14:59 giờ Việt Nam lưu bản cuối của chu kỳ 15:00 hôm trước–14:59 hôm sau, mỗi chu kỳ đúng một lần và không ghi đè; 15:00 mới reset. Nhiều lần Tính lại trong chu kỳ chỉ cập nhật bản đang mở, không cộng thành nhiều ngày. Chỉ tính/phân bổ/hiển thị tiền thưởng khi chốt tháng; trước đó Tiền thưởng là — (API null, file xuất để trống). Đã có kiểm thử cutoff, hai lần sửa trong ngày, bất biến chạy lại và nguồn chỉ từ sổ ngày; Kiểm thử tổng: 2.370 đạt, 3 skipped, 0 lỗi; kiểm thử SQL bổ sung 23/23 đạt. Chưa push/deploy.

0. **Bảng thưởng/phạt sale tab Công nợ (14/10/2026, trên main; migration 0051 + 0052 đã áp DB, hoàn tất trên main; chưa push/deploy):** Điểm theo từng khách (cơ sở + mã): số hóa đơn Hoàn thành và doanh số sau trừ trả hàng trong tháng; >=30 điểm mới xếp hạng chung HN + SG theo phạt gốc/điểm tăng dần, điểm giảm dần, tên A–Z. Top 1–20 miễn phạt; Top 10 nhận quỹ max(80% phạt phải nộp, 3 triệu), 50% theo trọng số hạng 19–17–15–13–11–9–7–5–3–1 và 50% theo tỷ trọng điểm; thiếu 10 người chuẩn hóa trọng số, chia hết quỹ đến đồng. Sửa phạt chỉ thay phạt gốc từng khách; miễn phạt áp ở mức sale. GET /api/debt-management/penalty-board?month=YYYY-MM trả bảng từ backend (mặc định tháng chu kỳ đang mở), lọc cơ sở sau khi tính hạng/quỹ toàn công ty. Giao diện, hộp chi tiết và xuất Excel/HTML dùng cùng kết quả; context.debtRewardMonth chọn tháng xuất. Kết quả tháng cũ lưu bất biến trong debt_reward_months sau bản chốt 15:00 đầu tháng mới, khi đã chốt hết sổ phạt và doanh số tháng. Lỗi chốt thử lại mỗi phút; thiếu lịch sử phạt có cảnh báo rõ, không bù thành 0. Kiểm thử SQL PGlite: nguồn điểm, sale đổi nhóm, thứ hạng/quỹ toàn công ty, chốt bất biến, retry 40001; jsdom + xuất Excel/HTML đã kiểm tra. Kiểm thử tổng ngoài sandbox: 2.366 đạt, 3 skipped, 0 lỗi (2.369 tổng). Đối chiếu DB thật: 62 sale, 43 đủ điều kiện, tổng thưởng đúng 3 triệu; lịch sử phạt hiện từ 13/10. Chưa push/deploy.
0. **Sửa xuất Excel đứt hàng ở một cơ sở (14/10/2026):** 3 nút "Xuất Excel" (Hàng đứt gần đây, đứt 90 ngày, đứt 30 ngày) trong `server/public/index.html` luôn gửi cột `branch`, trong khi `exportService` chỉ chấp nhận cột này khi kết quả quét là "Cả hai" (`EXPORT_FIELD_NOT_ALLOWED`) nên chọn Hà Nội/Sài Gòn không xuất được. Nay chỉ gửi `branch` khi `isMergedStockoutResult(result)`. Thêm 9 test hồi quy trong `test/frontend/export-ui.test.js` (3 bảng × 3 cơ sở; 6 ca một cơ sở fail khi chưa sửa). `npm test`: 2318 pass, 0 fail. Chưa commit/deploy.
0. **Thu gọn cột Sale/Team theo ảnh (14/10/2026):** bảng Doanh số theo sale đặt Sale 125 px, Team 133 px; bảng Doanh số theo khách đặt Sale 117 px. Hai bảng dùng `data-table-fit="off"` để tránh tự giãn cột khi tải dữ liệu, vẫn hỗ trợ kéo chỉnh thủ công. 38 kiểm thử frontend liên quan đạt; kiểm tra khung 1.814 px giữ đúng độ rộng 125/133 px. Graphify đã cập nhật. Bộ test tổng trong sandbox có lỗi quyền `EACCES` khi kết nối HTTP localhost.

0. **Báo cáo hàng hóa — chỉ mã đang kinh doanh (14/10/2026, chưa commit/push/deploy):** `productReportRepository.getProductReport` lọc snapshot theo `products.is_active IS NOT FALSE` tại ít nhất một cơ sở HN/SG. Bảng, KPI và xuất XLSX/HTML dùng cùng nguồn; mã ngừng cả hai cơ sở hoặc không còn trong danh mục bị loại, mã đang kinh doanh hết tồn/chưa bán vẫn giữ. Trạng thái được kiểm tra khi đọc, không cần chốt lại báo cáo. Kiểm thử SQL thực bằng PGlite: 9/9 đạt (bao gồm thay đổi trạng thái sau bản chốt). Toàn bộ test ngoài sandbox: 2.309 đạt, 3 skipped, 0 lỗi (2.312 tổng); sandbox chặn ghi file tạm/kết nối HTTP nội bộ nên lần chạy sandbox có lỗi môi trường. Graphify đã cập nhật.

0. **Vòng đời đơn hàng — bỏ đơn trước 10/10/2026 (13/10, chưa commit/deploy):** `kiotOrdersRepository.ALL_ORDERS_SQL` chỉ lấy đơn có ngày đặt ≥ 10/10/2026 (giờ VN) hoặc không có ngày; **đơn Phiếu tạm giữ mọi ngày**. Vì danh sách chỉ gồm đơn có trên Kiot nên dòng Sheet của đơn cũ cũng biến mất (mất cả KPI/cảnh báo/xuất Excel của chúng). Hằng số `LIFECYCLE_ORDER_FROM`; sửa ngày ở đó. Test shipment + frontend: 247 đạt.
0. **Tiền phạt công nợ (13/10/2026, migration 0048 đã áp DB dùng chung, đã backfill phiên cho bản chốt hôm nay: 369 khách, 202 nợ chậm):** cột Số phiên liên tiếp (ẩn) + Tiền phạt phiên này, quyền `reports.debt.penalty`, bỏ trạng thái Đang xử lý. Test 2305 xanh.
0. **Công nợ theo lịch thanh toán (13/10/2026, migration 0047 đã áp, lịch TT đã import — CHƯA push/deploy):**
   - **Tinh chỉnh bảng Công nợ (13/10, chưa push):** cột Cơ sở lên đầu; mặc định ẩn Cảnh báo; bỏ hàng chờ "Cần xử lý" (mặc định "Còn nợ"); bỏ Nợ đầu kỳ; thêm "DS trong kỳ" (`inScheduleDebt`) giữa Nợ hiện tại và Nợ quá hạn. Xuất Excel/HTML đồng bộ (bỏ Nợ đầu kỳ, thêm "Doanh số trong kỳ", đổi `DEBT_SORT_FIELDS`). Test: 2.298 (2.295 đạt, 3 skipped, 0 lỗi).
   - Bỏ workbook Google Sheets + quy tắc 1-3-7-Hàng tuần + ngưỡng 400k + cảnh báo "Chưa thu". Khóa dòng = khách + cơ sở (HN/SG). Lịch TT (1–90 ngày, mặc định 1) lưu `debt_payment_schedules`, Quản lý sửa trên web (`reports.debt.schedule`), nhật ký vĩnh viễn.
   - Lý do không dùng trường facebook KiotViet: API public KiotViet KHÔNG trả trường này (đã gọi thử list + detail với `includeCustomerSocial` cho KH000601 HN / KH003622 SG).
   - Chốt 15:00 VN mỗi ngày (`debtSchedule/debtCycleSnapshot.js`, scheduler; chỉ hóa đơn `Hoàn thành`, nợ quá hạn = nợ hiện tại − hóa đơn trong lịch (không tính trả hàng), "Đã xử lý" → tiền phạt 0, hàng chờ mặc định "Tất cả" — 13/10); nợ quá hạn = nợ hiện tại − (hóa đơn − trả hàng trong N ngày), tính lại khi đọc nên đổi lịch TT có hiệu lực ngay. DS = TB 4 tháng của Báo cáo kinh doanh (theo cơ sở + mã KH).
   - Cột Sale phản hồi / QL phản hồi / Trạng thái + Lịch sử chỉnh sửa (mọi thay đổi trên giao diện: 2 phản hồi, trạng thái, lịch TT) reset theo bản chốt 15:00 hôm sau. Quyền: `reports.debt.saleFeedback` (Sale), `reports.debt.managerFeedback` + `reports.debt.edit` + `reports.debt.schedule` (Quản lý). `reports.debt.saleFeedback` miễn kiểm tra leo thang (`isEscalationExempt`) để Trợ lý ủy quyền vẫn tạo/đặt lại mật khẩu tài khoản Sale.
   - File cũ không xóa được trong phiên (bị chặn quyền), nên xóa tay: `server/sheets/debtManagementSheetsClient(.test).js`, `server/dashboard/debtCollectionStatusRepository(.test).js`; `dashboard/debtManagement.js` còn dùng `parseNullableNumber` cho supplierReturnImportService.
   - Đã xong 13/10: migrate 0047; import SG 1.228/1.228, HN 3.072 (42 trống/"Khác" → mặc định 1); commit.
   - **Việc tiếp theo:** push + deploy → sau 15:00 chạy tay `node debtSchedule/debtCycleSnapshot.js` (hoặc chờ job 15:00) → đối chiếu 3–5 khách với KiotViet.

1. **Thiết kế lại các hộp "xem chi tiết" + sửa cảnh báo Kế toán sót đơn (12/10/2026, không migration):**
   - File mới `public/shared/detail-panel.css` (khung `.dp-*`), nối vào `index.html`, `shipment/lifecycle/index.html`, `humanresources/index.html`. Hộp: Chi tiết giao dịch, Doanh số theo khách (Báo cáo hàng hóa), Báo cáo kinh doanh (Sale/Khách/Mã hàng), Chi tiết đơn Vòng đời, Chi tiết nghỉ phép, Chi tiết Marketing — đều có hàng chỉ số tổng quan, không còn nút "Cột hiển thị" (`data-table-controls="off"`), 1 khung cuộn, responsive điện thoại, Sáng/Tối.
   - `orderLifecycleService.computeWarnings`: "Kế toán sót đơn" chỉ khi trạng thái hiệu lực = Đơn đã gửi kế toán (sang Đang giao / Đã nhận / Đã ký nhận hoặc ghi đè thì bỏ). Test mới trong `orderLifecycleWarning.test.js`.
   - Test mới/sửa: `document-detail-panel`, `product-report-detail`, `business-report`, `order-lifecycle-kiot`, `hr-leave-realtime-status`, `marketing-report` (đều xanh).

2. **Phân trang bảng nhân sự & quản trị tài khoản (12/10/2026, không migration):**
   - Áp dụng phân trang chuẩn (`table-controls.js`) cho bảng danh sách nhân sự, bảng chấm công, bảng nghỉ phép tại `/humanresources/` và bảng quản trị người dùng tại `/account/`.
   - Bổ sung test frontend `server/test/frontend/hr-account-pagination.test.js` (xanh).

3. **Vòng đời đơn hàng — chỉ số tổng quát đầu trang (12/10/2026, branch `main`, không migration):**
   - Dải thẻ trên bảng "Toàn bộ đơn hàng": Chưa gửi kế toán (**chỉ đơn Phiếu tạm**), Đã gửi kế toán, Đang được giao; và Tổng đơn vi phạm + 6 thẻ theo từng loại cảnh báo. Bấm thẻ = lọc nhanh bảng (bấm lại để bỏ).
   - API `GET /api/shipment/lifecycle` thêm `kpis: { status, warnings }` (`orderLifecycleQuery.countSummary`): đếm theo bộ lọc hiện tại, thẻ trạng thái bỏ lọc `status`, thẻ cảnh báo bỏ lọc `warning`. Tính trong RAM, 0 truy vấn mới. `warningCounts` (theo cơ sở) giữ nguyên.
   - Test: `orderLifecycleQuery.test.js`, `orderLifecycleWarning.test.js`, `test/frontend/order-lifecycle-kpis.test.js` (mới), `lifecycleFakeServer.js` trả `kpis`.

4. **Vòng đời đơn hàng — 5 luồng + 6 cảnh báo có tên (12/10/2026, branch `main`, không migration):**
   - Đọc thêm tab `Khách_HN`/`Khách_SG` (khách/ship lấy tại kho; chỉ Mã đơn / Sale gửi KT / KT duyệt / Ship nhận đơn; fail-soft). `DonHang_HN/SG` bỏ qua cột Ship nhận đơn.
   - Cờ cảnh báo 24h cũ thay bằng `warnings` (mã) + `warning` (boolean): Kế toán sót đơn (mọi tab: Sale gửi KT, KT chưa duyệt, đủ 30 phút tính trong giờ 6h–18h), Lái xe chưa chụp đơn (DonHang_HN/SG: Sale gửi >24h, chưa Tài xế gửi xác nhận, chưa ký nhận), Lái xe quên chụp (DonHang_HN/SG: đã ký nhận mà chưa Tài xế gửi xác nhận), Chưa nhận đơn quá 6 giờ (DonHang_HN/SG: Tài xế gửi xác nhận >6h chưa ký nhận), Khách/Ship chưa lấy (Khách_HN/SG: Sale gửi >2 ngày chưa Ship nhận đơn), Chưa chụp bill tàu (DonHang_MienNam: Sale gửi >24h chưa ký nhận). Tự mất khi bước tương ứng đã làm; đơn hủy/sự cố không cảnh báo.
   - Tính trong RAM từ dữ liệu sheet + đồng hồ (0 truy vấn Supabase mới). Thêm bộ lọc "Cảnh báo" (`?warning=any|<mã>`), `warningCounts` trong API, xuất Excel ghi tên cảnh báo.

5. **Vòng đời đơn hàng — luồng Đơn Bắc-Nam (12/10/2026, branch `main`, không migration):**
   - Đọc thêm tab `DonHang_MienNam` (cùng workbook `ORDER_LIFECYCLE_SPREADSHEET_ID`); tính như đơn Hà Nội, chỉ 4 mốc (Mã đơn / Sale gửi KT / KT duyệt đơn / Đã ký nhận), bỏ qua cột lái xe/ship, không cảnh báo 24h, fail-soft có log.
   - Code: `config.js`, `shipment/orderLifecycleRepository.js`, `shipment/orderLifecycleService.js`; 8 test mới (`orderLifecycleRepository.test.js`, `orderLifecycleWarning.test.js`). Đã kiểm tra thật: `DH043419` hiện Hà Nội, "Đơn đã gửi kế toán".
   - Kế hoạch/danh sách việc: `tasks/2026-10-12-lifecycle-north-south/`. Deploy chỉ cần restart server.

5b. **Vòng đời đơn hàng — hộp chi tiết theo luồng + nút "Bỏ sắp xếp" (13/10/2026, không migration, chưa commit):**
   - Server trả thêm `flow` (`DELIVERY`/`NORTH_SOUTH`/`PICKUP`) trên mỗi dòng bảng và kết quả tra cứu; tab Khách_HN/SG đọc thêm cột `Lái xe` (bước Kho).
   - Hộp chi tiết chỉ hiện node đúng luồng: DonHang_HN/SG (và đơn chưa có trong sheet) 6 node, bỏ "Ship nhận đơn"; DonHang_MienNam 3 node (Sale gửi → KT duyệt đơn → Đã ký nhận); Khách_HN/SG 4 node (Sale gửi → KT duyệt đơn → Kho → Ship/Khách nhận đơn). Chỉ số Tiến trình tính theo mốc của luồng (5/3/3).
   - Hai bảng (Toàn bộ đơn hàng, Lịch sử cập nhật) có nút "Bỏ sắp xếp" hiện khi đang sắp theo cột; lần bấm tiêu đề thứ ba của bảng Lịch sử cũng về mặc định (mới nhất trước).
   - Test: `order-lifecycle-kiot.test.js` (sửa 2 + 3 test mới), `orderLifecycleService.test.js`, `orderLifecycleRepository.test.js`; toàn bộ 2.305 test xanh. Deploy chỉ cần restart server.

6. **Giảm egress Supabase (Migration `0044`, nhánh `perf/egress-reduction`, chưa deploy):**
   - `purchases.raw_hash`: đối soát phiếu nhập so băm thay vì tải `raw`.
   - Cache Hóa đơn/Chi tiết hóa đơn hết hạn theo `invoicesChanged` (dự phòng 15 phút, guard thế hệ); CLI backfill hiện sau ≤15 phút.
   - Bot Telegram quản lý: cache danh sách quản lý 5 phút, nạp lazy; realtime nghỉ phép chỉ poll `getLeaveVersions`.
   - **Lưu ý deploy:** phải áp `0044` TRƯỚC khi chạy code mới; lượt quét phiếu nhập đầu tiên sẽ ghi lại toàn bộ một lần.

7. **Ngày đặc biệt — thông báo chuông + pháo hoa (Migration `0043`):**
   - `public/shared/special-days.js` (UMD): ngày lễ dương/âm lịch + sinh nhật 27/10; `notifications/specialDayNotifier.js` báo lên chuông cho mọi tài khoản đang hoạt động có `hr.leave`, chống trùng bằng `special_day_notice_log`; cờ `SPECIAL_DAYS_NOTIFY_ENABLED`.
   - `createNotificationForUsers` ghi file đúng 1 lần cho cả lô.
   - `fireworks.js` thay sao băng vào ngày đặc biệt (`shooting-star.js` chọn hiệu ứng; `?fireworks=1` để xem thử); `?v=` của `shooting-star.js` nâng lên `20261009`.
   - Test mới: `test/frontend/special-days.test.js`, `test/frontend/fireworks.test.js`, `notifications/specialDayNotifier.test.js`, `db/specialDayNoticeLogMigration.test.js`, bổ sung `notificationRepository.test.js`.

8. **Nghỉ phép cho tài khoản nội bộ chưa gắn nhân sự (Migration `0042`):**
   - Cho phép mọi tài khoản nội bộ đang hoạt động (trừ Khách) tự gửi đơn xin nghỉ phép trên web ngay cả khi chưa gắn hồ sơ `hr_employee_id`.
   - Cơ sở lấy từ đơn, áp dụng giờ làm việc mặc định sáng 07:45 / chiều 12:30.
   - Bổ sung kiểm thử backend và frontend tương ứng.

9. **Quản lý trạng thái nhân sự (Migration `0041`):**
   - Phân biệt trạng thái làm việc `employment_status` (`active` / `resigned`) khỏi xóa mềm `is_active`.
   - Tự động khóa tài khoản liên kết với mã `lock_reason = 'hr_resigned'` khi nhân sự nghỉ việc; mở lại khi kích hoạt.

10. **Chuẩn hóa UI & Điều khiển bảng dùng chung (`table-controls` & `search-clear`):**
    - Áp dụng `table-controls.js` cho tất cả các bảng dữ liệu: ẩn/hiện cột, kéo chỉnh độ rộng cột, phân trang mượt mà.
    - Thêm tiện ích nút xóa nhanh `search-clear` cho các ô tìm kiếm.
    - Tắt điều khiển cột cho bảng quy định chế độ phúc lợi để bảo toàn bố cục tĩnh.

11. **Báo cáo Marketing (`/reports/#marketing`):**
    - Đọc dữ liệu từ 3 workbook Google Sheets (Trực page, SĐT, Ads).
    - Tích hợp cột Doanh số KiotViet đối chiếu theo tên khách hàng chuẩn hóa.
    - Hỗ trợ sửa trực tiếp ô Khách mới / Ghi chú đồng bộ ngược lại Google Sheets (`PUT /api/marketing-report/monthly/row`).
    - Bổ sung tính năng xuất báo cáo định dạng XLSX và HTML kèm hộp thoại chi tiết.

12. **Lịch sử chỉnh sửa tài khoản (Migration `0040`):**
    - Tạo bảng `account_audit_log` ghi nhận bất biến mọi thao tác tạo, sửa, đặt lại mật khẩu, xóa, phân quyền.
    - Xây dựng tab tra cứu `/account/#history` cho Quản trị viên.

13. **Quy định công ty — Tài liệu Chi tiêu & Phúc lợi (Migration `0039`):**
    - Bổ sung tài liệu dựng sẵn thứ 3 (`phuc-loi`) vào `hr_rule_documents`.
    - 13/10/2026: thêm tài liệu dựng sẵn thứ 4 `treo-hang` "Quy định treo hàng" (Migration `0049`; chưa áp DB/deploy).
    - 14/10/2026 — Công nợ: sửa nợ quá hạn dư đúng bằng các đơn lập từ 15:00 tới lúc chốt khi job chốt trễ (13/10 chốt 16:53 → dư HD027936 28.980.000đ); tiền theo ngày giờ cắt tại lúc chốt thật. Thêm nút "Tính lại công nợ" (Quản lý, `reports.debt.refresh`, Migration `0050` đã áp DB 14/10; chưa commit/deploy).

14. **Báo cáo kinh doanh (Migration `0036`, `0037`):**
    - Chốt cứng doanh số tháng vào `business_monthly_*` với job `businessMonthlyRefresh.js`.
    - Bổ sung cột Team của sale và bộ lọc Team (`sale_teams` nạp từ `chia team.xlsx`).
    - Gộp khách hàng theo tên chuẩn hóa và thêm modal chọn trường khi xuất file.

15. **Hạn đăng ký nghỉ phép & Lịch làm việc (Migration `0038`):**
    - Snapshot thời gian tại DB, giờ bắt đầu ca cố định 07:45 / 12:30, gán nhãn Đúng hạn / Xin muộn / Vi phạm.

16. **Sổ quỹ toàn công ty (Migration `0033`, `0034`, `0035`):**
    - Hiển thị số dư theo 5 nhóm tài khoản (`account_balance_groups`), phân tách cột ngân hàng riêng.
    - Cơ chế đối soát đánh dấu `source_missing_at` bảo toàn toàn vẹn lịch sử.
    - Kiểm tra revision tự động mỗi 15 giây khi tab hiển thị.

---

## 3. Hành động tiếp theo cần thực hiện (Next Steps & Operations)

- [ ] **Pancake Marketing — đã khôi phục ID và đồng bộ thật, chưa bật job (12/10/2026):**
  - Chi tiết, số liệu và lưu ý nghiệm thu ở mục "Marketing Pancake" cuối file; kế hoạch/checklist ở `tasks/2026-10-09-pancake-marketing/`.
  - Người dùng thêm 6 biến `PANCAKE_PAGE_TOKEN_<pageId>` trên Render, dịch vụ `tokosi` (giá trị lấy từ `server/.env`; AI không được nhập token). Giữ `PANCAKE_MARKETING_SYNC_ENABLED=false` và `MARKETING_REPORT_SOURCE=sheets` (mặc định).
  - Quản lý chốt cách tính "chào lại": lần đồng bộ đầu dồn thay đổi nhân viên cũ vào 12/10 (tháng 10: 179 → 1.660). Và quyết định có tính 3.148 tin trong kỳ mà Sheets chưa từng tính hay không.
  - Sau đó bật job, chạy đủ ít nhất ba đêm (không thay bằng ba lần cùng ngày) và đối soát đủ sáu page rồi mới đặt `MARKETING_REPORT_SOURCE=postgres`. Sáu page đọc song song, Hữu Nghị ~65 phút.

- [ ] **Staging / Production Deployment:**
  - Migration `0036` đến `0046` đã áp lên DB dùng chung. Khi có migration mới: `npm run db:migrate` ngoài giờ cao điểm.
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

## Marketing Pancake — cập nhật phiên 12/10/2026

### Trạng thái vận hành kiểm tra trực tiếp ngày 13/10/2026

- Render `tokosi` đang dùng `MARKETING_REPORT_SOURCE=postgres` và `PANCAKE_MARKETING_SYNC_ENABLED=true` (đã có trước phiên kiểm tra, khác ghi chú ngày 12/10).
- Theo yêu cầu đồng bộ và sáu token người dùng cung cấp trong phiên 13/10, đã thêm đủ sáu biến `PANCAKE_PAGE_TOKEN_<pageId>` vào Render. Không lưu giá trị token trong tài liệu hoặc Git.
- Deploy cập nhật môi trường `dep-db6nte59fdbs73dkt680` thành công, Live lúc 07:43:58 giờ Việt Nam, mã `89d8828`. Lịch trong mã: 23:55 Asia/Ho_Chi_Minh.
- Kiểm tra trong Web Shell của instance Render `zvcrq`: công tắc `true`, nguồn `postgres`, đủ 6 token; GET danh sách INBOX của cả 6 page đều HTTP 200, `success=true` và có mảng conversations. Đây là kiểm tra kết nối, không thay thế kết quả đồng bộ đầy đủ.
- Đang chạy đồng bộ thủ công vào DB dùng chung: `pancake:2026-10-13`, run ID `8`, bắt đầu 07:41:22 giờ Việt Nam. Chưa xác nhận hoàn tất; báo cáo khi kết thúc: `tasks/2026-10-09-pancake-marketing/sync-2026-10-13.json`.
- Web `/reports/#marketing` truy cập được bằng trình duyệt nhưng chuyển sang trang đăng nhập; chưa xác minh bảng Marketing bằng phiên đăng nhập web.
- Chưa xác nhận ba đêm đối soát và quyết định nghiệp vụ về “chào lại”/tin ngoài nền Sheets; các lưu ý nghiệm thu ngày 12/10 vẫn còn.

### Ghi nhận phiên 12/10 (lịch sử)

Mã T3–T6 đã triển khai và qua kiểm thử; nguồn chính thức vẫn là Sheets. Ngày 12/10/2026 đã khôi phục ID tin nhắn từ sáu bản xuất đầy đủ (migration 0046): 18.304 dòng lịch sử thật đều có liên kết (18.294 duy nhất, 7 chỉ khác cách viết số +84/0 thừa đã kiểm cùng giây-cùng nhân viên, 3 dòng thuộc cặp tin tương đương = 6 liên kết); chỉ còn dòng tiêu đề lặp BL THÔ!1950 (không phải quan sát). 3.148 tin trong kỳ nằm ngoài nền Sheets được ghi sổ riêng, không tính. Đồng bộ thật đủ sáu page đạt (slot 12/10): 11.797 fact, 2.478 quan sát cùng ngày ghi nhận 12/10 (thay đổi nhân viên tích lũy từ lúc dán Sheets và 861 tin mới), 0 mục chưa giải quyết, 0 dòng lịch sử chưa liên kết; nền lịch sử khớp CHUẨN (11.942 nhóm SĐT); tổng khớp chi tiết 100/100 (T10) và 80/80 (T9). Công tắc job vẫn TẮT và nguồn vẫn Sheets: chưa có ba đợt hằng đêm đối soát, chưa cấu hình token trên Render. Lưu ý nghiệm thu: lần đồng bộ đầu dồn các thay đổi nhân viên cũ vào ngày 12/10 nên "chào lại" tháng 10 tăng mạnh (179 → 1.660); cần Quản lý xác nhận cách tính trước khi chuyển nguồn.

Đã gộp vào `main` (fast-forward) và push `tks_web/main` + `origin/main` ở `89d8828`; nhánh `codex/pancake-marketing` đã xóa. Kiểm thử bản gộp: 2.298 test, 2.295 đạt, 3 bỏ qua cấu hình, 0 lỗi. Job chưa bật, nguồn chưa chuyển. Việc đã đổi ngoài Marketing: quyền `reports.marketing.edit` chỉ Quản lý (không cấp qua ghi đè được).
