# Spec: Tra cứu "Vòng đời đơn hàng" trên Web — Luồng HN (An Khánh) & SG (Tân Phú), đơn to/xe công ty

> Trạng thái: DỰ THẢO — đã được duyệt qua Plan Mode (2026-09-04), sẵn sàng chuyển sang Phase Tasks.
> Bối cảnh liên quan: `Plan Process Automation.md` (spec tổng "Quản lý vận chuyển" 5 luồng, mô tả hệ thống `VC_*` chưa từng được bot thật ghi dữ liệu vào), `docs/04-planning/implementation_plan.md` §6 (Giai đoạn 3 — Quản lý vận chuyển).

## 1. Mục tiêu

Luồng HN (An Khánh) và SG (Tân Phú) cho đơn to/xe công ty hiện đã được một hệ thống tự động (Bot Telegram + Apps Script, **xây bên ngoài repo này**) ghi trực tiếp trạng thái vào Google Sheet **"Vòng đời đơn hàng"** (spreadsheet `1YwG6jQNp5okPGjFfSdSHivq3P_nDFKgMoP1QTD9zOMc`, 2 tab `DonHang_HN` / `DonHang_SG`). Đây là dữ liệu vận hành **thật, đang chạy thực tế** — khác với hệ thống `VC_*` đã build sẵn trong repo (`vcOrderRepository.js`, `orderStateMachine.js`, trang `/shipment/dispatch/` + `/shipment/mobile/`), vốn đọc/ghi một spreadsheet VC riêng theo state machine 9-trạng-thái/5-luồng tự thiết kế nhưng **không phải nguồn dữ liệu bot thật đang ghi vào**.

Xây tính năng web đọc (read-only) sheet "Vòng đời đơn hàng" và ánh xạ thành:
1. **Tra cứu 1 đơn theo mã** → trạng thái tóm tắt (4 mức, dựa trên cột có timestamp muộn nhất) + xem chi tiết đầy đủ như 1 hàng trong Google Sheet.
2. **Xem tất cả đơn cùng lúc** (như nhìn cả bảng Google Sheet) — chỉ dành cho 5 vai trò nội bộ.

**Người dùng:** Khách tra cứu đơn của mình; Kế toán/Trưởng kho/Quản lý/Trợ lý/Sale theo dõi vận hành.

**Thành công =** người tra cứu thấy đúng trạng thái hiện tại (khớp cột đã điền muộn nhất trong sheet), 5 vai trò nội bộ xem được toàn bộ đơn của cả 2 chi nhánh cùng lúc như đang mở Google Sheet.

**Quyết định đã chốt với người dùng:** tính năng này **thay thế `VC_*` cho 2 luồng HN/SG xe công ty** về mặt nghiệp vụ, nhưng để giữ thay đổi nhỏ và kiểm chứng độc lập, phase này chỉ **xây tính năng đọc + hiển thị mới**, không đụng code/UI `VC_*` hiện có (xem mục 2 & 8).

## 2. Phạm vi

**Trong phạm vi:**
- Client đọc read-only spreadsheet "Vòng đời đơn hàng" (2 tab `DonHang_HN`/`DonHang_SG`).
- Logic suy ra trạng thái tóm tắt 4 mức + chi tiết đầy đủ 8 cột.
- 2 endpoint API mới: tra cứu 1 đơn (Khách + 5 vai trò nội bộ), xem tất cả đơn (chỉ 5 vai trò nội bộ).
- Trang web mới `/shipment/lifecycle/` (2 khu vực: tra cứu + danh sách toàn bộ, hiện/ẩn theo vai trò).
- 1 mục nav mới trỏ tới trang này.

**Ngoài phạm vi:**
- Sửa/xoá `vcOrderRepository.js`, `orderStateMachine.js`, `shipmentOrderRoutes.js`, hay UI `/shipment/dispatch/`/`/shipment/mobile/` hiện có.
- Đổi trang mặc định của `/shipment/` (route gốc) hay ẩn nav Điều phối/Mobile — quyết định thay thế `VC_*` thật sự, để sau khi tính năng mới chạy thử ổn (mục 10).
- Ghi/patch bất kỳ dữ liệu nào vào sheet "Vòng đời đơn hàng" (read-only thuần).
- 3 luồng còn lại (Tân Phú/An Khánh shipper, tàu hỏa) — sheet/tab tương ứng cho các luồng đó chưa xác nhận, sẽ làm ở phase sau.

## 3. Bối cảnh kỹ thuật (đã khảo sát trong repo)

- **Nguồn dữ liệu mới**: Google Sheet "Vòng đời đơn hàng" (`1YwG6jQNp5okPGjFfSdSHivq3P_nDFKgMoP1QTD9zOMc`), 2 tab `DonHang_HN`/`DonHang_SG` trong **cùng 1 spreadsheet** (khác pattern "1 spreadsheet/chi nhánh" của `SPREADSHEET_ID`/`SPREADSHEET_ID_SG` hiện có). 8 cột: A=Mã đơn hàng, B=Nhân viên bán hàng, C=Sale gửi đơn cho kế toán, D=Kế toán duyệt đơn, E=Lái xe, F=Tài xế gửi xác nhận giao hàng, G=Kế toán duyệt giao hàng, H=Xác nhận đã giao/khách ký nhận.
- **Client Sheets read-only để tái dùng đúng khuôn**: [`server/sheets/sheetsClient.js`](server/sheets/sheetsClient.js) — singleton `GoogleAuth` scope `spreadsheets.readonly`, không cần generation-guard/invalidation phức tạp như `vcSheetsClient.js` (đó là read-write).
- **Pattern parse-row để tái dùng**: [`server/hr/hrLeaveRepository.js`](server/hr/hrLeaveRepository.js) — `headers`/`fieldKeys` song song, `rowToObject`, `readAll` bỏ hàng trống, gắn `_rowIndex`.
- **Hệ thống `VC_*` hiện có** (KHÔNG đụng tới): `server/shipment/vcOrderRepository.js`, `server/shipment/orderStateMachine.js` (state machine 9-trạng-thái, 4 `FLOWS` hiện có: `HN_XE_CTY`, `SG_XE_CTY`, `HN_TAU_HOA`, `SG_SHIPPER`), `server/shipment/shipmentOrderRoutes.js` (15 endpoint `/api/shipment/*`), `server/public/shipment/dispatch/`, `server/public/shipment/mobile/`.
- **Route đặc biệt hiện có làm mẫu cho việc "Khách" cần vào 1 route riêng trước gate chung`**: `POST /api/shipment/invoice-status` (`server/routes.js:45`, dùng `resolveBranchOptional`, đọc sheet "Hóa đơn" KiotViet qua `invoiceStatusService.js` — **khác nguồn dữ liệu**, không sửa route này) được đăng ký **trước** `router.use('/api/shipment', requireAuth, resolveBranch)` (`server/routes.js:65`) để `Khách` không bị chặn ở gate chung.
- **Role model**: `server/auth/localUserStore.js:21-31` định nghĩa `ROLES` (`QUAN_LY, KE_TOAN, TRUONG_KHO, TRO_LY, LAI_XE, NHAN_VIEN_KHO, NHAN_VIEN_SALE, NHAN_VIEN_MUA_HANG, KHACH`), re-export qua `server/auth/userRepository.js:33`. Middleware `requireAuth`/`requireRole(...roles)` ở `server/auth/authMiddleware.js:20,37`. Mẫu role-list gần giống nhu cầu: `SHIPMENT_VIEW_ROLES` (`shipmentOrderRoutes.js:30-34`) — nhưng gồm 7 vai trò (thêm Lái xe, Nhân viên kho), rộng hơn 5 vai trò được yêu cầu ở đây, nên định nghĩa 2 hằng số role-list **mới, riêng** cho tính năng này thay vì tái dùng `SHIPMENT_VIEW_ROLES`.
- **Test runner**: `node --test` (khai báo ở `server/package.json`), theo khuôn `hrLeaveRepository.test.js`/`vcOrderRepository.test.js`/`vcSheetsClient.test.js`.

## 4. Logic suy ra trạng thái tóm tắt (4 mức)

Trạng thái hiện tại = mức cao nhất mà cột mốc tương ứng đã có giá trị, xét ưu tiên **H > F > C** — bỏ qua D và G, vì D chỉ theo sau C và G chỉ theo sau F trong luồng nghiệp vụ thật (đúng yêu cầu người dùng: "bình thường không có trạng thái kế toán xác nhận" riêng).

| # | Điều kiện (cột sheet) | Trạng thái hiển thị | Nội dung kèm theo |
|---|---|---|---|
| 1 | Không tìm thấy `Mã đơn hàng` trong cả 2 tab | **Đơn chưa gửi kế toán** | — |
| 2 | Cột **C** có giá trị, cột F trống | **Đơn đã gửi kế toán** | Tên sale (cột B) — thời gian (cột C) |
| 3 | Cột **F** có giá trị, cột H trống | **Đơn đang được giao** | Tên lái xe (cột E) — thời gian (cột F) |
| 4 | Cột **H** có giá trị | **Đơn đã giao thành công** | Thời gian (cột H) |

Chi tiết đơn (khi bấm vào) hiển thị đầy đủ cả 8 cột kể cả D/G, ô trống hiển thị "—" — y hệt 1 hàng trong Google Sheet.

**Edge case phòng thủ:** nếu D hoặc G có giá trị nhưng C/F tương ứng lại trống (không nên xảy ra theo quy trình thật nhưng dữ liệu bot có thể lỗi) — vẫn áp bảng trên theo đúng cột chính C/F/H, không tạo state riêng cho D/G.

## 5. Kiến trúc & file mới

Không sửa `vcOrderRepository.js`, `orderStateMachine.js`, `shipmentOrderRoutes.js`, hay UI dispatch/mobile hiện có.

- **`server/config.js`**: thêm `ORDER_LIFECYCLE_SPREADSHEET_ID` (optional, `null` mặc định — fail-soft như `VC_SPREADSHEET_ID`) + `ORDER_LIFECYCLE_SHEET_HN: 'DonHang_HN'`, `ORDER_LIFECYCLE_SHEET_SG: 'DonHang_SG'`. Ghi block chú thích + `.env.example` tương tự block `VC_*`.
- **`server/sheets/orderLifecycleSheetsClient.js`** (mới): client read-only theo khuôn `sheetsClient.js` — singleton `GoogleAuth`, scope `spreadsheets.readonly`, `getValues(sheetTabName)` với cache TTL 15s (ngắn hơn HR/VC vì dữ liệu bot ghi gần-realtime) + dedupe request đang chạy (khuôn `hrSheetsClient.js`/`invoiceStatusService.js`), không cần generation-guard vì không ghi.
- **`server/shipment/orderLifecycleRepository.js`** (mới): `SCHEMA` (headers tiếng Việt + fieldKeys `orderCode, saleName, saleSentAt, accountantApprovedOrderAt, driverName, driverConfirmedDeliveryAt, accountantApprovedDeliveryAt, deliveryConfirmedAt`), `rowToObject`/`readAll()` theo khuôn `hrLeaveRepository.js`. `readAll()` đọc **cả 2 tab**, gộp, gắn `_branch: 'HN'|'SG'` mỗi record (mỗi mã đơn chỉ tồn tại ở 1 tab nên không cần đoán chi nhánh theo cookie).
- **`server/shipment/orderLifecycleService.js`** (mới):
  - `computeStatus(record)` → áp bảng mục 4, trả `{ code, label, actor, at }`.
  - `findOrder(orderCode)` → `readAll()`, so khớp chính xác (trim, không phân biệt hoa/thường), trả `{ found: false }` hoặc `{ found: true, branch, summary, detail }`.
  - `listAllOrders(branchFilter?)` → map mỗi record thành `{ ...8 cột, branch, summary }`, giữ nguyên thứ tự hàng trong sheet.
- **`server/shipment/orderLifecycleRoutes.js`** (mới, Router riêng — không gộp vào `shipmentOrderRoutes.js`):
  - `GET /api/shipment/lifecycle/:orderCode` — `ORDER_LOOKUP_ROLES = [KHACH, KE_TOAN, TRUONG_KHO, QUAN_LY, TRO_LY, NHAN_VIEN_SALE]`.
  - `GET /api/shipment/lifecycle` (query `?branch=HN|SG` tùy chọn) — `ORDER_LIFECYCLE_BULK_ROLES = [KE_TOAN, TRUONG_KHO, QUAN_LY, TRO_LY, NHAN_VIEN_SALE]`.
- **`server/routes.js`**: mount router mới **trước** gate `/api/shipment` chung (giống cách `invoice-status` được đặc cách cho `Khách`):
  ```js
  router.use('/api/shipment/lifecycle', requireAuth, orderLifecycleRoutes);
  router.use('/api/shipment', requireAuth, resolveBranch);
  router.use(shipmentOrderRoutes);
  ```
- **`server/public/shipment/lifecycle/index.html` + `lifecycle.js`** (mới, cùng cấu trúc thư mục con như `dispatch/`/`mobile/`):
  - **Khu A — Tra cứu đơn** (mọi vai trò cho phép, gồm Khách): nhập mã đơn → `GET /api/shipment/lifecycle/:orderCode` → badge trạng thái tóm tắt (tái dùng style badge sẵn có ở `index.html`'s bảng tra cứu hóa đơn) + nút "Xem chi tiết" mở bảng đủ 8 cột.
  - **Khu B — Xem tất cả đơn** (hiện/gọi API chỉ khi `user.vaiTro` thuộc 5 vai trò nội bộ — kiểm tra client-side theo mẫu `index.html:239-246`, **thực thi quyền thật ở backend** qua `requireRole`): bảng liệt kê tất cả đơn từ cả 2 tab (toggle lọc HN/SG), mỗi hàng: Mã đơn, Sale, Trạng thái (badge), thời gian cập nhật gần nhất; bấm hàng mở cùng chi tiết như Khu A.
- **`server/public/shared/shared-nav.js`**: thêm mục nav "Vòng đời đơn hàng" trỏ `/shipment/lifecycle/` dưới nhóm "Quản lý vận chuyển" — giữ nguyên mục "Điều phối"/"Mobile" hiện có.

## 6. Testing Strategy

`node --test`, theo khuôn `hrLeaveRepository.test.js`/`vcOrderRepository.test.js`/`vcSheetsClient.test.js`:
- `orderLifecycleRepository.test.js`: `rowToObject`, `readAll` bỏ hàng trống, gắn đúng `_branch`.
- `orderLifecycleService.test.js`: `computeStatus` đủ 4 nhánh + edge case D/G có giá trị nhưng C/F trống + `findOrder` not-found.
- Route-level: `Khách` gọi được lookup nhưng 403 ở bulk-list; 5 vai trò nội bộ gọi được cả hai; vai trò ngoài danh sách (Lái xe, Nhân viên kho, Nhân viên mua hàng) bị 403 ở cả hai route.
- Không gọi Google Sheets thật trong test tự động — mock `orderLifecycleSheetsClient`.

## 7. Boundaries

- **Luôn làm:** chỉ đọc (read-only) sheet "Vòng đời đơn hàng"; giữ nguyên toàn bộ code/route/UI hệ thống `VC_*`; theo đúng pattern auth/role/sheets-client đã có; chạy `node --test` trước khi coi là xong.
- **Hỏi trước:** đổi trang mặc định `/shipment/` sang trang lifecycle mới; ẩn/xoá nav "Điều phối"/"Mobile"; mở rộng quyền tra cứu/xem-tất-cả cho vai trò ngoài danh sách đã chốt.
- **Không bao giờ:** ghi/patch vào sheet "Vòng đời đơn hàng"; sửa `vcOrderRepository.js`/`orderStateMachine.js`/`shipmentOrderRoutes.js`; xoá dữ liệu VC hiện có.

## 8. Success Criteria

- [ ] `GET /api/shipment/lifecycle/HD000005` (mã có thật trong sheet mẫu) trả đúng trạng thái tóm tắt khớp cột đã điền muộn nhất, và chi tiết đủ 8 cột.
- [ ] Mã đơn không tồn tại → trả "Đơn chưa gửi kế toán" (không lỗi 404 khó hiểu).
- [ ] `Khách` gọi được lookup nhưng 403 ở bulk-list; 5 vai trò nội bộ gọi được cả hai và thấy đúng toàn bộ đơn từ cả 2 tab.
- [ ] Trang `/shipment/lifecycle/` hiển thị đúng UI theo từng vai trò (kiểm tra thủ công qua browser preview với tài khoản mẫu mỗi vai trò).
- [ ] `node --test` pass cho test mới, không phá test hiện có.

## 9. Cấu hình mới (`server/config.js` / `.env.example`)

| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `ORDER_LIFECYCLE_SPREADSHEET_ID` | Không (optional, fail-soft) | ID spreadsheet "Vòng đời đơn hàng": `1YwG6jQNp5okPGjFfSdSHivq3P_nDFKgMoP1QTD9zOMc`. Thiếu biến này → tính năng trả lỗi rõ ràng (không crash server), giống `VC_SPREADSHEET_ID`. |

Không cần biến `_SG` riêng vì 2 tab nằm chung 1 spreadsheet.

## 10. Open Questions / Việc tiếp theo

1. Quyết định có đổi trang mặc định `/shipment/` sang trang lifecycle mới hay không, và có ẩn nav Điều phối/Mobile cho 2 luồng HN/SG-xe-công-ty hay không — để sau khi tính năng chạy thử.
2. Có cần mở rộng quyền tra cứu đơn lẻ cho `Lái xe`/`Nhân viên kho` không (hiện chưa nằm trong 5 vai trò được chỉ định) — giữ phạm vi hẹp theo đúng yêu cầu, mở rộng sau nếu cần.
3. Cache TTL 15s là đề xuất ban đầu — có thể chỉnh theo tần suất bot ghi thực tế sau khi quan sát.
4. **Cần xác nhận thủ công (ngoài phạm vi code):** Service Account (`GOOGLE_SERVICE_ACCOUNT_JSON` hiện có) đã được share quyền Viewer trên spreadsheet "Vòng đời đơn hàng" chưa — người dùng cần tự thực hiện trên Google Sheets UI trước khi test tính năng.
5. 3 luồng còn lại (Tân Phú/An Khánh shipper, tàu hỏa) dùng sheet/tab nào — cần người dùng cung cấp khi làm phase tiếp theo.
