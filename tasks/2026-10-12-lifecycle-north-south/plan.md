# Kế hoạch: luồng "Đơn Bắc-Nam" cho Vòng đời đơn hàng

## Context

Trang `/shipment/lifecycle/` hiện đọc 2 tab của workbook `ORDER_LIFECYCLE_SPREADSHEET_ID`: `DonHang_HN`, `DonHang_SG`, rồi ghép với đơn KiotViet theo (cơ sở, mã đơn). Giờ có thêm tab thứ 3 `DonHang_MienNam` (cùng workbook, do bot/Apps Script ngoài repo ghi) cho các đơn Bắc-Nam. Đây vốn là đơn **Kiot Hà Nội** nên về nghiệp vụ coi như đơn HN: cùng bộ lọc cơ sở, không tách luồng/không thêm nhãn trên giao diện; chỉ đọc thêm từ 1 sheet khác.

Header tab mới (đã thấy trên ảnh): Mã đơn hàng · Nhân Viên Bán Hàng · Khách hàng · Sale gửi đơn cho kế toán · Kế toán duyệt đơn · Lái Xe · Tài xế gửi xác nhận giao hàng · Kế toán duyệt giao hàng · Ship nhận đơn · Đơn đã ký nhận. Thời gian dạng `12/10/2026 08:52` (`parseSheetTimeMs` đã đọc được).

## Quyết định đã chốt với người dùng (2026-10-12)

| Vấn đề | Chốt |
|---|---|
| Mốc "Kế toán duyệt đơn" | **Không thêm trạng thái.** Đơn vẫn "Đơn đã gửi kế toán" tới khi ký nhận; giờ duyệt chỉ hiện trong hộp chi tiết (đã có sẵn trong `toDetail`). |
| Các cột còn lại (Lái xe, Tài xế gửi XN, KT duyệt giao hàng, Ship nhận đơn) | **Bỏ qua hẳn**, chỉ đọc 4 mốc: Mã đơn hàng, Sale gửi KT, KT duyệt đơn, Đơn đã ký nhận (+ Sale/Khách để đồng dạng; thực tế Sale/Khách lấy từ Kiot). |
| Trạng thái kết quả | Chỉ 3 loại: chưa gửi KT → đã gửi KT → **Đã nhận (Đi giao xong)** (`SIGNED`). Ghi đè thủ công (tab Lịch sử cập nhật) vẫn áp như cũ. |
| Mã trùng giữa tab HN và tab Bắc-Nam | Coi như không bao giờ trùng; giữ quy tắc hiện tại (dòng gặp trước thắng; thứ tự đọc HN → Bắc-Nam → SG). |
| Cảnh báo >24h | **Không cảnh báo** cho đơn Bắc-Nam (cột Cảnh báo luôn trống). |
| Cơ sở | `HN`. Đơn không có trên Kiot HN thì bị bỏ như mọi dòng sheet hiện nay (quy tắc `mergeRows`). |

Giả định thêm (sẽ nêu lại khi duyệt): tên tab đúng `DonHang_MienNam`; nếu đọc tab này lỗi (đổi tên/xóa) thì **fail-soft** — ghi `console.error`, trả mảng rỗng, không làm sập cả trang (khác tab HN/SG vẫn throw). Không migration, không đổi API/giao diện.

## Thiết kế (bám code hiện có)

- `server/config.js:80-82` — thêm `ORDER_LIFECYCLE_SHEET_NORTH_SOUTH: 'DonHang_MienNam'` cạnh HN/SG.
- `server/shipment/orderLifecycleRepository.js`
  - `readTab(sheetName, branch)` (dòng 124): thêm tham số tùy chọn `{ fieldKeys, flow }`. Với tab Bắc-Nam chỉ giữ `orderCode, saleName, customerName, saleSentAt, accountantApprovedOrderAt, orderSignedAt`; các field còn lại của `SCHEMA.fieldKeys` ép `''` (nên `computeStatus` tự cho ra chỉ 3 trạng thái, không sửa hàm đó). Gắn `_branch: 'HN'` và cờ `_flow: 'NORTH_SOUTH'`.
  - `readAll()` (dòng 138): đọc thêm tab thứ 3 với fail-soft, nối `[...hn, ...northSouth, ...sg]`. Tái dùng `buildColumnIndex`/`HEADER_ALIASES` (đã khớp mọi header trong ảnh, kể cả "Nhân Viên Bán Hàng" nhờ so sánh không phân biệt hoa/thường).
- `server/shipment/orderLifecycleService.js`
  - `toOrderRow` (dòng 228): `warning` = `false` khi `record._flow === 'NORTH_SOUTH'`, ngược lại `computeOverdueWarning` như cũ. `toDetail`/`findOrder`/`override`/`lookup`/export dùng `readAll` nên tự nhận tab mới, không sửa thêm.
- Không đụng: `orderLifecycleQuery.js`, `orderLifecycleRoutes.js`, `public/shipment/lifecycle/index.html`, `kiotOrdersRepository.js`.

## Danh sách việc

Tracker mặc định = markdown. `tasks/todo.md` hiện còn 5 ô chưa tích của việc khác (vá auth/dọn BE-FE) nên **không ghi đè**; sau khi duyệt sẽ tạo `tasks/2026-10-12-lifecycle-north-south/plan.md` + `todo.md` (đúng kiểu thư mục theo ngày đang dùng như `2026-10-09-pancake-marketing`).

### T1 — Đọc tab Bắc-Nam, ra đúng 3 trạng thái (cỡ S: 3 file)
**Mô tả:** config + `readTab`/`readAll` như trên, fail-soft.
**Tiêu chí:**
- [x] Test repo: tab Bắc-Nam có header kiểu ảnh → dòng ra `_branch:'HN'`, `_flow:'NORTH_SOUTH'`, 6 field giữ nguyên, `driverName/driverConfirmedDeliveryAt/accountantApprovedDeliveryAt/deliveryConfirmedAt/shipReceivedAt` = `''` dù ô có dữ liệu — `orderLifecycleRepository.test.js:176` (commit e161c34)
- [x] Test repo: tab thiếu cột / đổi thứ tự cột vẫn đọc đúng theo tên header — `orderLifecycleRepository.test.js:204` (tab chỉ có 4 cột, thứ tự đảo; các cột vắng ra `''`)
- [x] Test repo: `getValues` ném lỗi cho tab Bắc-Nam → `readAll` vẫn trả HN+SG, có `console.error` — `orderLifecycleRepository.test.js:242`
- [x] Thứ tự đọc HN → Bắc-Nam → SG — `orderLifecycleRepository.test.js:223`; thứ tự nay là HN → Bắc-Nam → Khách_HN → SG → Khách_SG (mở rộng 5 luồng, commit fa0c134)
**Xác minh:** `cd server && node --max-old-space-size=4096 --test "shipment/orderLifecycleRepository.test.js"`
**Phụ thuộc:** không · **File:** `server/config.js`, `server/shipment/orderLifecycleRepository.js`, `server/shipment/orderLifecycleRepository.test.js`

### T2 — Không cảnh báo 24h + kiểm tra ghép với Kiot HN (cỡ S: 2-3 file)
**Mô tả:** `toOrderRow` bỏ cảnh báo cho `_flow === 'NORTH_SOUTH'`; bổ sung test `mergeRows`.
**Tiêu chí:**
- [x] Test: dòng Bắc-Nam gửi KT >24h chưa ký nhận → `warning:false`; dòng HN cùng điều kiện vẫn `warning:true` — SUPERSEDED một phần bởi 5 luồng (fa0c134, 12/10): quy tắc "không cảnh báo 24h" đã được người dùng đổi thành cảnh báo có tên `NO_TRAIN_BILL` "Chưa chụp bill tàu" cho đơn Bắc-Nam (Sale gửi >24h chưa ký nhận); đơn Bắc-Nam không còn dính cảnh báo lái xe của HN. Test hiện hành: `orderLifecycleWarning.test.js:165,256`
- [x] Test: chỉ có "Sale gửi" → `SENT_TO_ACCOUNTANT`; có thêm "KT duyệt đơn" → vẫn `SENT_TO_ACCOUNTANT`, `accountantApprovedOrderAt` có trong dòng; có "Đơn đã ký nhận" → `SIGNED` — `orderLifecycleWarning.test.js:271`
- [x] Test `mergeRows`: dòng Bắc-Nam khớp đơn Kiot **HN** → hợp nhất (Sale/Khách/Giá trị từ Kiot, `branch:'HN'`); không khớp đơn Kiot HN nào → bị bỏ — `orderLifecycleWarning.test.js:291`
- [x] Test: ghi đè thủ công (Sự cố/Đã hủy) vẫn thắng trên đơn Bắc-Nam — `orderLifecycleWarning.test.js:311`
**Xác minh:** `node --max-old-space-size=4096 --test "shipment/*.test.js"`
**Phụ thuộc:** T1 · **File:** `server/shipment/orderLifecycleService.js`, `server/shipment/orderLifecycleService.test.js` (hoặc `orderLifecycleWarning.test.js`)

### Checkpoint A — sau T1–T2
- [x] Toàn bộ test thư mục `shipment/` + `test/frontend/order-lifecycle-*.test.js` xanh — chạy lại 19/10/2026: `node --test "shipment/*.test.js" "test/frontend/order-lifecycle-*.test.js"` = 303/303 đạt, 0 lỗi
- [x] Không thay đổi hành vi dòng HN/SG (so sánh test cũ không phải sửa) — test HN/SG cũ trong `orderLifecycleRepository/Service/Query/Routes.test.js` không phải sửa kỳ vọng (cùng lần chạy 303/303)

### T3 — Xác minh trên dữ liệu thật + đồng bộ tài liệu (cỡ M: ~6 file tài liệu, 0 code)
**Mô tả:** chạy đọc thật tab `DonHang_MienNam` (hàng mẫu `DH043419`, KH Minh Long, 12/10/2026 08:52) bằng script đọc-chỉ hoặc harness xem trang không đăng nhập; cập nhật tài liệu theo `.agents/skills/update-file/SKILL.md`.
**Tiêu chí:**
- [x] Đơn `DH043419` hiện ở trang với cơ sở Hà Nội, "Đơn đã gửi kế toán", thời gian khớp sheet, không cảnh báo; nếu Kiot HN chưa có mã này thì ghi nhận hành vi "bị bỏ" (đúng quy tắc, không phải lỗi) — đã đọc thật + qua service/Kiot ngày 12/10 (xem `todo.md` T3a: Hà Nội, "Đơn đã gửi kế toán", 12/10/2026 08:52, không cảnh báo); nay đơn này được xử lý theo `NO_TRAIN_BILL` nếu >24h chưa ký nhận. Không chạy lại ngày 19/10 (không cần: logic phủ bởi test)
- [x] Bộ lọc cơ sở Hà Nội/Sài Gòn không đổi; đơn Bắc-Nam lọt vào "Hà Nội", không lọt "Sài Gòn" — `orderLifecycleWarning.test.js:291` (đơn Bắc-Nam branch HN, không lọt SG) + `orderLifecycleQuery.test.js` xanh
- [x] Cập nhật `README.md` (bảng env: thêm `DonHang_MienNam`), `server/README.md` (dòng 17, 163), `docs/04-planning/implementation_plan.md`, `docs/02-srs/...`, `docs/01-brd/...`, `CURRENT.md`, ngày cập nhật cuối tài liệu — đã có: `README.md:56,165`, `server/README.md:20,200,318`, `docs/04-planning/implementation_plan.md:28`, SRS FR-14.8 (`SRS...md:360`), BRD (`BRD...md:300`), `CURRENT.md:110`
- [x] Ghi nhớ memory `project-tokosi-hr-shipment-debt-modules` (nguồn thứ 3 + quy tắc bỏ qua cột/cảnh báo) — đã có mục "Đơn Bắc-Nam" ở memory (còn ghi "chưa commit/deploy" — lỗi thời: code đã commit e161c34/fa0c134/3a30c91; deploy chưa xác nhận)
**Xác minh:** `cd server && npm test` (100% xanh) rồi `graphify update .`
**Phụ thuộc:** T2

### Checkpoint B — hoàn tất
- [ ] (chờ lead; 12/10 đã đạt 2.207/2.214 xem todo.md T3c) `npm test` xanh, `graphify update .` xong, `git status` chỉ gồm file dự kiến — shipment + order-lifecycle xanh 303/303 (19/10); `npm test` toàn bộ + `graphify update .` do lead chạy ở Checkpoint 2 của `tasks/2026-10-19-precompute-reports/plan.md`
- [x] Người dùng xem trang và duyệt trước khi commit/deploy (không cần migration; deploy chỉ cần restart, và service account phải đã được chia sẻ workbook — là cùng workbook nên đã đủ) — commit đã có (e161c34, fa0c134, 3a30c91 trên main).
  - [ ] (chờ người dùng/ngoài phạm vi) Deploy chỉ cần restart server; không xác nhận được từ repo.

## Rủi ro

| Rủi ro | Mức | Cách xử lý |
|---|---|---|
| Header tab mới bị người dùng đổi/chèn cột (đã từng lệch 2026-09-14) | Trung bình | Đọc theo tên header + alias, test đổi thứ tự cột |
| Đổi tên tab `DonHang_MienNam` → đơn Bắc-Nam lặng lẽ quay về "chưa gửi kế toán" | Thấp | Fail-soft có `console.error` rõ tên tab; tên tab đặt ở `config.js` một chỗ |
| Đơn trong tab nhưng chưa có trên Kiot HN bị bỏ | Thấp | Đúng quy tắc hiện hành; nêu rõ khi nghiệm thu |
| Cùng mã đơn tồn tại ở HN và SG, ghi đè lịch sử khóa theo mã đơn thuần | Có sẵn | Không thuộc phạm vi, giữ nguyên |

## Câu hỏi còn mở
Không còn câu hỏi chặn; chỉ cần xác nhận hai giả định ở trên (tên tab, fail-soft) khi duyệt kế hoạch.
