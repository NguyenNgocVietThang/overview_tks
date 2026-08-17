# Phase 1B — Backend State Machine & API CRUD đơn vận chuyển

**Dự án:** TOKOSI Dashboard — Module "Quản lý vận chuyển" (Giai đoạn 3)
**Vị trí trong roadmap:** `Phase 1: MVP Quản lý Vận chuyển Web-First` → hạng mục con **1B**, sau **1A** (đã xong: spreadsheet `VC_*` tiếng Việt + Drive service), trước **1C** (Web UI Điều phối/Mobile) và **1D** (Đối soát cuối ngày).
**Tài liệu gốc bắt buộc đọc trước khi code:**
- [`Plan Process Automation.md`](file:///d:/Web%20TKS%20Dashboard/Plan%20Process%20Automation.md) — đặc biệt mục 4 (Data Model 6 tab tiếng Việt), mục 5 (State Machine), mục 6 (UI dự kiến 1C — để hiểu API sẽ phục vụ ai)
- [`docs/04-planning/implementation_plan.md`](file:///d:/Web%20TKS%20Dashboard/docs/04-planning/implementation_plan.md) mục 6 — tổng quan trạng thái các phase

---

## 1. Mục tiêu

Xây dựng **lớp nghiệp vụ backend thuần túy** (state machine + API CRUD) cho đơn vận chuyển, đọc/ghi 6 tab tiếng Việt trong Spreadsheet vận chuyển độc lập (`VC_SPREADSHEET_ID`) đã có sẵn từ Phase 1A. Phase này **không làm UI** (đó là 1C) — chỉ API JSON + logic nghiệp vụ + unit test. API phải "forward-compatible": khi Bot Telegram (Phase 2) sẵn sàng, bot chỉ gọi đúng các endpoint này, không cần đổi gì ở backend.

## 2. Đã có sẵn từ Phase 1A (không được sửa lại trừ khi phát hiện lỗi)

| File | Vai trò |
|---|---|
| [`server/scripts/setupVcSheet.js`](file:///d:/Web%20TKS%20Dashboard/server/scripts/setupVcSheet.js) | Khởi tạo 6 tab tiếng Việt + header tiếng Việt, định nghĩa `VC_SCHEMAS` — **đây là nguồn sự thật cho tên tab và tên cột**, đọc kỹ trước khi viết repository. |
| [`server/sheets/vcSheetsClient.js`](file:///d:/Web%20TKS%20Dashboard/server/sheets/vcSheetsClient.js) | Client đọc/ghi spreadsheet vận chuyển riêng (`VC_SPREADSHEET_ID`). Export: `vcGetValues`, `vcGetMultipleSheetValues`, `vcAppendRow`, `vcUpdateRow`, `vcBatchUpdate`, `vcListSheetTitles`. Dùng `USER_ENTERED` khi ghi (cho phép Sheets tự parse ngày/số). |
| [`server/shipment/driveService.js`](file:///d:/Web%20TKS%20Dashboard/server/shipment/driveService.js) | `uploadAttachment({orderId, date, type, fileBuffer, mimeType, originalName})` upload ảnh lên Drive theo cây `<VC_DRIVE_FOLDER_ID>/<YYYYMMDD>/<order_id>/`, trả về `{drive_file_id, drive_view_url, drive_thumbnail_url}`. `ATTACHMENT_TYPES` = `PICKUP_PHOTO`, `DELIVERY_PHOTO`, `SIGNED_BILL`, `EXCEPTION_PHOTO`. |
| [`server/config.js`](file:///d:/Web%20TKS%20Dashboard/server/config.js) | Có sẵn `VC_SPREADSHEET_ID`, `VC_DRIVE_FOLDER_ID`, và hằng tên 6 tab tiếng Việt: `VC_SHEET_ORDERS` (`Đơn vận chuyển`), `VC_SHEET_ORDER_ITEMS` (`Chi tiết vận chuyển`), `VC_SHEET_STATUS_HISTORY` (`Lịch sử trạng thái`), `VC_SHEET_ATTACHMENTS` (`Ảnh chứng từ`), `VC_SHEET_EXCEPTIONS` (`Sự cố vận chuyển`), `VC_SHEET_VEHICLES` (`Danh mục xe`). |
| [`server/sheets/sheetsClient.js`](file:///d:/Web%20TKS%20Dashboard/server/sheets/sheetsClient.js) | Client đọc-only spreadsheet KiotViet **gốc** (khác spreadsheet vận chuyển) — dùng để tra sheet `Hóa đơn` khi tạo đơn từ mã KiotViet. |
| [`server/auth/authMiddleware.js`](file:///d:/Web%20TKS%20Dashboard/server/auth/authMiddleware.js) | `requireAuth`, `requireRole(...roles)` — ranh giới bảo mật thật sự, bắt buộc dùng cho mọi route mới. |
| [`server/auth/userRepository.js`](file:///d:/Web%20TKS%20Dashboard/server/auth/userRepository.js) | `ROLES` = `Quản lý`, `Kế toán`, `Trưởng kho`, `Trợ lý`, `Khách`. `INTERNAL_ROLES` = 4 vai trò nội bộ (không có `Khách`). |

**Schema 6 tab tiếng Việt trong Spreadsheet Vận chuyển** (đúng thứ tự cột & ánh xạ `fieldKeys` từ `VC_SCHEMAS`):

1. **`Đơn vận chuyển`** (`CONFIG.VC_SHEET_ORDERS`):
   - **Headers:** `Mã vận đơn` | `Mã hóa đơn KiotViet` | `Kho xuất` | `Luồng giao hàng` | `Mã xe` | `Tên tài xế` | `Tên khách hàng` | `Số điện thoại` | `Địa chỉ nhận hàng` | `Trạng thái hiện tại` | `Giữ hàng tàu hỏa` | `Tiền cước` | `Ghi chú cước` | `Thời gian tạo` | `Cập nhật lần cuối`
   - **FieldKeys:** `order_id`, `kiotviet_code`, `warehouse`, `flow`, `vehicle_id`, `driver_name`, `customer_name`, `customer_phone`, `address`, `current_status`, `is_transit_held`, `freight_amount`, `freight_note`, `created_at`, `updated_at`

2. **`Chi tiết vận chuyển`** (`CONFIG.VC_SHEET_ORDER_ITEMS`):
   - **Headers:** `Mã vận đơn` | `Mã hàng` | `Tên hàng hóa` | `Số lượng đặt` | `Số lượng đã nhặt` | `Đơn vị tính` | `Ghi chú`
   - **FieldKeys:** `order_id`, `product_code`, `product_name`, `quantity_ordered`, `quantity_picked`, `unit`, `notes`

3. **`Lịch sử trạng thái`** (`CONFIG.VC_SHEET_STATUS_HISTORY`):
   - **Headers:** `Mã lịch sử` | `Mã vận đơn` | `Trạng thái trước` | `Trạng thái mới` | `Người thực hiện` | `Thời gian cập nhật` | `Ghi chú`
   - **FieldKeys:** `history_id`, `order_id`, `from_status`, `to_status`, `changed_by`, `changed_at`, `note`

4. **`Ảnh chứng từ`** (`CONFIG.VC_SHEET_ATTACHMENTS`):
   - **Headers:** `Mã chứng từ` | `Mã vận đơn` | `Loại chứng từ` | `Google Drive File ID` | `Link xem ảnh` | `Link thumbnail` | `Người tải lên` | `Thời gian tải lên` | `Nội dung OCR`
   - **FieldKeys:** `attachment_id`, `order_id`, `type`, `drive_file_id`, `drive_view_url`, `drive_thumbnail_url`, `uploaded_by`, `uploaded_at`, `ocr_text`

5. **`Sự cố vận chuyển`** (`CONFIG.VC_SHEET_EXCEPTIONS`):
   - **Headers:** `Mã sự cố` | `Mã vận đơn` | `Khâu phát sinh` | `Loại sự cố` | `Mô tả chi tiết` | `Người xử lý` | `Trạng thái xử lý` | `Thời gian báo cáo` | `Thời gian xử lý xong`
   - **FieldKeys:** `exception_id`, `order_id`, `stage`, `type`, `description`, `resolver`, `status`, `created_at`, `resolved_at`

6. **`Danh mục xe`** (`CONFIG.VC_SHEET_VEHICLES`):
   - **Headers:** `Mã xe` | `Biển số xe` | `Loại xe` | `Tài xế mặc định` | `Tải trọng tối đa (kg)` | `Ghi chú`
   - **FieldKeys:** `vehicle_id`, `plate_number`, `vehicle_type`, `default_driver`, `max_weight`, `notes`

---

## 3. Ngoài phạm vi (Non-goals của 1B)

- Không viết HTML/CSS/JS giao diện (`/shipment/dispatch`, `/shipment/mobile`) — đó là 1C.
- Không viết trang Đối soát cuối ngày — đó là 1D.
- Không tích hợp Bot Telegram / OCR — đó là Phase 2.
- Không cần route upload file multipart hoàn chỉnh nếu thời gian hạn hẹp, nhưng **phải** có sẵn hàm service gọi được `driveService.uploadAttachment` + ghi `Ảnh chứng từ` (route HTTP wrapper có thể để 1C hoàn thiện phần chọn ảnh, nhưng logic nghiệp vụ backend phải xong ở 1B).

---

## 4. State Machine — đặc tả chính xác

### 4.1. Danh sách trạng thái (`current_status` trong `Đơn vận chuyển`)

Dùng đúng chuỗi tiếng Việt sau làm giá trị lưu trong sheet (khớp văn phong toàn hệ thống, dễ đọc thủ công khi mở Sheets):

| Hằng số (code) | Giá trị lưu trong sheet | Ý nghĩa |
|---|---|---|
| `MOI_TAO` | `Mới tạo` | Đơn vừa tạo từ hóa đơn KiotViet, chưa in |
| `DA_IN` | `Đã in` | Kế toán đã in đơn cho lái xe/kho |
| `DA_NHAT_HANG` | `Đã nhặt hàng` | Kho đã nhặt xong, có thể kèm ảnh `PICKUP_PHOTO` |
| `DANG_CHUYEN_KHO` | `Đang chuyển kho` | **Chỉ luồng 3** (tàu hỏa) — hàng đang trung chuyển trước khi giao tay lái xe/shipper đầu Nam |
| `DANG_GIAO` | `Đang giao` | Lái xe/shipper đã nhận và đang trên đường giao |
| `DA_GIAO` | `Đã giao` | Đã giao tới nơi, chờ xác nhận/đối soát |
| `HOAN_THANH` | `Hoàn thành` | Trạng thái cuối cùng thành công |
| `SU_CO` | `Sự cố` | Nhánh ngoại lệ — xem 4.3 |
| `DA_HUY` | `Đã hủy` | Trạng thái cuối do sự cố không giải quyết được (trả hàng hẳn, hủy đơn) |

### 4.2. Bảng chuyển trạng thái hợp lệ (transition table)

```
MOI_TAO          -> DA_IN
DA_IN            -> DA_NHAT_HANG
DA_NHAT_HANG     -> DANG_CHUYEN_KHO      (chỉ khi flow === 3)
DA_NHAT_HANG     -> DANG_GIAO            (chỉ khi flow !== 3)
DANG_CHUYEN_KHO  -> DANG_GIAO            (chỉ khi flow === 3)
DANG_GIAO        -> DA_GIAO
DA_GIAO          -> HOAN_THANH
```

Guard bắt buộc kiểm tra ở tầng service (không chỉ ở transition table tĩnh):
- `DA_NHAT_HANG -> DANG_CHUYEN_KHO` và `DA_NHAT_HANG -> DANG_GIAO`: nếu sai `flow` so với điều kiện → lỗi `400 INVALID_TRANSITION_FOR_FLOW`.
- Không bắt buộc phải có ảnh để chuyển trạng thái (ảnh thiếu sẽ được **phát hiện** ở trang Đối soát 1D, không **chặn** thao tác ở 1B — tránh khóa cứng luồng vận hành thực tế khi mạng yếu).

### 4.3. Nhánh ngoại lệ "Sự cố" (Exception branch)

- Cho phép chuyển sang `SU_CO` từ **bất kỳ trạng thái nào trong tập** `{DA_NHAT_HANG, DANG_CHUYEN_KHO, DANG_GIAO, DA_GIAO}` (không cho phép từ `MOI_TAO`/`DA_IN` vì chưa phát sinh vận chuyển thực tế; không cho phép từ `HOAN_THANH`/`DA_HUY` vì đã là trạng thái cuối).
- Khi chuyển sang `SU_CO`: **bắt buộc** ghi thêm 1 dòng vào `Sự cố vận chuyển` (`VC_SHEET_EXCEPTIONS`) (không chỉ đổi `current_status`), lưu `stage` = trạng thái trước đó (dùng để biết sự cố phát sinh ở khâu nào), và **lưu trạng thái trước khi vào `SU_CO`** — dùng cột `Ghi chú` (`note`) của `Lịch sử trạng thái` (`VC_SHEET_STATUS_HISTORY`) dòng chuyển tiếp (định dạng note: `"prev_status:<TRANG_THAI_TRUOC>"`) để khôi phục khi resolve. Không thêm cột mới vào các tab ngoài schema 1A đã cố định — dùng quy ước ghi trong `note` như trên.
- **Resolve sự cố** (`PATCH /api/shipment/exceptions/:exceptionId`):
  - `resolution: "RESUME"` → đơn quay lại `prev_status` đã lưu (tiếp tục luồng bình thường).
  - `resolution: "CANCEL"` → đơn chuyển `DA_HUY` (trạng thái cuối).
  - Cả hai đều cập nhật `Sự cố vận chuyển.status = 'RESOLVED'`, `resolved_at`, `resolver` = `req.user.hoTen` hoặc `username`.

### 4.4. Quy tắc tự động "Coi như đã ký"

Khi có 1 ảnh loại `DELIVERY_PHOTO` hoặc `SIGNED_BILL` được upload thành công (qua `POST /api/shipment/orders/:orderId/attachments`) **và** đơn đang ở trạng thái `DANG_GIAO` hoặc `DA_GIAO` → tự động gọi transition sang `HOAN_THANH` (không cần lái xe bấm thêm nút). Ghi `changed_by = 'system:auto-complete'` trong `Lịch sử trạng thái`. Cài đặt logic này trong service upload attachment, gọi lại hàm transition dùng chung (không viết lại logic chuyển trạng thái riêng).

### 4.5. File cần tạo

`server/shipment/orderStateMachine.js` — module thuần logic (không gọi Sheets API), export:
- `ORDER_STATUS` (object hằng số như bảng 4.1, freeze).
- `FLOWS` = `{ HN_XE_CTY: 1, SG_XE_CTY: 2, HN_TAU_HOA: 3, SG_SHIPPER: 4 }` (freeze).
- `WAREHOUSES` = `{ AN_KHANH: 'An Khánh', TAN_PHU: 'Tân Phú' }` (freeze).
- `EXCEPTION_ELIGIBLE_STATUSES` (Set/array các trạng thái được phép rơi vào `SU_CO`).
- `canTransition(fromStatus, toStatus, { flow }) -> boolean`.
- `assertValidFlowWarehouse(flow, warehouse)` — flow 1, 3 bắt buộc `warehouse === AN_KHANH`; flow 2, 4 bắt buộc `warehouse === TAN_PHU`; sai thì throw lỗi `{statusCode: 400, code: 'INVALID_FLOW_WAREHOUSE'}` (dùng pattern lỗi ở mục 6).
- Unit test thuần cho từng nhánh transition hợp lệ/không hợp lệ (không cần mock Sheets vì module này không gọi mạng).

---

## 5. Data access layer

Tạo `server/shipment/vcOrderRepository.js` — bọc `vcSheetsClient` thành các hàm nghiệp vụ theo tên cột (tránh rải index cột trong route handler). Đề xuất chữ ký hàm (được điều chỉnh miễn giữ đúng ngữ nghĩa):

```js
getOrders({ warehouse, flow, status, driverName, dateFrom, dateTo }) -> Promise<Order[]>
getOrderById(orderId) -> Promise<Order|null>          // kèm join items/history/attachments/exceptions
createOrder({ kiotviet_code, warehouse, flow, vehicle_id, driver_name,
              customer_name, customer_phone, address, items[] }) -> Promise<Order>
updateOrderMeta(orderId, patch)                         // chỉ field không phải current_status
transitionOrderStatus(orderId, toStatus, { changedBy, note }) -> Promise<Order>
updateOrderItems(orderId, items[])                       // ghi quantity_picked...
appendAttachment(orderId, { type, drive_file_id, ..., uploadedBy }) -> Promise<Attachment>
listAttachments(orderId)
createException(orderId, { stage, type, description })   // side-effect: transition -> SU_CO
resolveException(exceptionId, { resolution, resolver, note })
listExceptions(filter)
getVehicles() / createVehicle(...) / updateVehicle(...)
```

**Vấn đề kỹ thuật quan trọng cần xử lý rõ ràng (Google Sheets không phải DB thật):**

1. **Không có transaction/lock.** Mọi hàm ghi phải: (a) đọc toàn bộ tab liên quan để tìm `rowIndex` theo `order_id`/`*_id`, (b) `vcUpdateRow`/`vcAppendRow`. Chấp nhận rủi ro race condition ở quy mô ~200 đơn/ngày (tương tự cách `WebhookQueue.gs` đã chấp nhận); không cần cài optimistic locking phức tạp cho 1B, nhưng **phải viết comment giải thích rủi ro này tại đầu file** (giữ đúng văn phong dự án — xem cách `SheetSchemas.gs`/`vcSheetsClient.js` đã comment).
2. **Sinh ID:** `order_id` = `VC-YYYYMMDD-XXXX` (4 chữ số). Thuật toán: đọc toàn bộ cột `Mã vận đơn` hiện có trong tab `Đơn vận chuyển`, lọc các mã có tiền tố `VC-YYYYMMDD-` của ngày hiện tại (giờ Việt Nam — dùng cùng cách xử lý timezone `Asia/Ho_Chi_Minh` như `dashboardData.js`), lấy số lớn nhất + 1, pad 4 chữ số. `history_id`/`attachment_id`/`exception_id` dùng định dạng `<PREFIX>-<timestamp>-<random 4 hex>` (không cần đẹp, chỉ cần duy nhất — không phải khóa hiển thị cho người dùng).
3. **`vcGetValues` trả `any[][]` thô** — viết hàm tiện ích `rowsToObjects(headers, rows, fieldKeys)` / `objectToRow(headers, obj, fieldKeys)` dùng chung, ánh xạ linh hoạt giữa header tiếng Việt trong sheet và object key tiếng Anh trong code JS (tương tự cách `dashboardData.js` build index cột theo tên header, không hard-code số cột).
4. **Đọc theo lô:** khi `getOrderById` cần dữ liệu từ các tab (`Đơn vận chuyển`, `Chi tiết vận chuyển`, `Lịch sử trạng thái`, `Ảnh chứng từ`, `Sự cố vận chuyển`), dùng `vcGetMultipleSheetValues` (1 lần gọi API) thay vì gọi `vcGetValues` riêng lẻ từng tab.

---

## 6. Quy ước lỗi & response (bắt buộc theo đúng pattern đã dùng trong `invoiceStatusService.js` / `routes.js`)

- Lỗi nghiệp vụ throw `Error` gắn thêm `err.statusCode` (400/403/404/409) và `err.code` (SCREAMING_SNAKE_CASE), route handler bắt và trả:
  ```js
  res.status(err.statusCode || 500).json({
    error: err.statusCode && err.statusCode < 500 ? err.message : 'Thông báo lỗi chung chung (không lộ chi tiết Sheets API).',
    code: err.code
  });
  ```
- Mã lỗi tối thiểu cần định nghĩa: `ORDER_NOT_FOUND` (404), `INVALID_TRANSITION` (400), `INVALID_TRANSITION_FOR_FLOW` (400), `INVALID_FLOW_WAREHOUSE` (400), `KIOTVIET_CODE_NOT_FOUND` (404 — khi tạo đơn từ mã hóa đơn không tồn tại trong sheet `Hóa đơn`), `DUPLICATE_ORDER` (409 — 1 mã KiotViet chỉ tạo được 1 đơn vận chuyển, kiểm tra trước khi `createOrder`), `EXCEPTION_NOT_FOUND` (404), `EXCEPTION_ALREADY_RESOLVED` (409), `VEHICLE_NOT_FOUND` (404).
- Log lỗi 500 ra console theo đúng khối `console.error('=== ... ===')` như `routes.js` đã làm cho `/api/shipment/invoice-status`.

---

## 7. API Endpoints cần thêm vào `server/routes.js`

Toàn bộ mount dưới `/api/shipment/...`, đứng **sau** dòng `POST /api/shipment/invoice-status` hiện có (route đó dành riêng cho `Khách`, không đổi). Tạo file router riêng `server/shipment/shipmentOrderRoutes.js` rồi `router.use(shipmentOrderRoutes)` trong `routes.js` cho gọn (theo đúng cách `authRoutes.js` đã tách).

**Phân quyền:** dùng `requireAuth` + `requireRole(...INTERNAL_ROLES)` cho toàn bộ endpoint dưới đây (không có vai trò `Lái xe` riêng trong hệ thống hiện tại — xem mục 9 "Vấn đề mở"). Không dùng `require('../auth/userRepository').INTERNAL_ROLES` trực tiếp nếu cần custom subset thì định nghĩa hằng riêng trong file router, ví dụ `DISPATCH_ROLES = [ROLES.QUAN_LY, ROLES.KE_TOAN]` cho hành động tạo đơn.

| Method | Path | Vai trò | Mô tả |
|---|---|---|---|
| `GET` | `/api/shipment/orders` | INTERNAL_ROLES | Danh sách đơn, query filter: `warehouse`, `flow`, `status`, `driverName`, `dateFrom`, `dateTo` (tất cả optional, AND với nhau). Trả mảng object đơn (không kèm items/history — để nhẹ cho bảng Kanban 1C). |
| `GET` | `/api/shipment/orders/:orderId` | INTERNAL_ROLES | Chi tiết 1 đơn: order + items + status history (sort theo `changed_at` tăng dần) + attachments + exceptions liên quan. 404 nếu không tồn tại. |
| `POST` | `/api/shipment/orders` | `Quản lý`, `Kế toán` | Tạo đơn mới từ hóa đơn KiotViet. Body: `{ kiotviet_code, warehouse, flow, vehicle_id?, driver_name?, items: [{product_code, product_name, quantity_ordered, unit}] }`. Luồng xử lý: (1) validate `flow`/`warehouse` khớp nhau qua `assertValidFlowWarehouse`; (2) tra `kiotviet_code` có tồn tại trong sheet `Hóa đơn` (dùng `sheetsClient` hiện có, lấy kèm `customer_name`/`customer_phone`/`address` nếu cột đó có sẵn — nếu sheet `Hóa đơn` không có đủ field khách hàng thì cho phép client tự truyền `customer_name`/`customer_phone`/`address` trong body làm fallback); (3) kiểm tra chưa từng tạo đơn cho mã này (`DUPLICATE_ORDER` nếu đã có, trừ khi đơn cũ đang ở `DA_HUY` thì cho tạo lại); (4) sinh `order_id`; (5) ghi tab `Đơn vận chuyển` với `current_status = DA_IN` **trực tiếp** (khớp nút gộp "Tạo đơn / Đã in" trong UI 1C dự kiến — không dừng ở `MOI_TAO`); (6) ghi 1 dòng tab `Lịch sử trạng thái` với `from_status=''`, `to_status='Đã in'`; (7) ghi các dòng tab `Chi tiết vận chuyển`. Trả `201` + order vừa tạo (kèm items). |
| `PATCH` | `/api/shipment/orders/:orderId` | `Quản lý`, `Kế toán` | Cập nhật metadata không đổi trạng thái: `vehicle_id`, `driver_name`, `customer_name`, `customer_phone`, `address`, `freight_amount`, `freight_note`. Không cho sửa `current_status` qua endpoint này (dùng `/transition`). |
| `POST` | `/api/shipment/orders/:orderId/transition` | INTERNAL_ROLES | Body: `{ to_status, note? }`. Gọi `orderStateMachine.canTransition` + `vcOrderRepository.transitionOrderStatus`. `changed_by` lấy từ `req.user.hoTen || req.user.username`. Trả order đã cập nhật. 400 `INVALID_TRANSITION` nếu không hợp lệ. |
| `PATCH` | `/api/shipment/orders/:orderId/items` | INTERNAL_ROLES | Body: `{ items: [{product_code, quantity_picked, notes?}] }` — dùng khi Kho cập nhật số lượng đã nhặt. Không tạo/xóa dòng item mới ở đây (item cố định từ lúc tạo đơn theo hóa đơn KiotViet). |
| `POST` | `/api/shipment/orders/:orderId/attachments` | INTERNAL_ROLES | Multipart upload (dùng `multer` memory storage — kiểm tra `package.json` xem đã có `multer` chưa, nếu chưa thì thêm dependency). Field: `type` (bắt buộc, 1 trong 4 giá trị `ATTACHMENT_TYPES`), `file`. Giới hạn kích thước ảnh hợp lý (đề xuất 8MB) và giới hạn mimetype `image/*`. Luồng: gọi `driveService.uploadAttachment` → `vcOrderRepository.appendAttachment` → nếu `type` ∈ `{DELIVERY_PHOTO, SIGNED_BILL}` và order đang `DANG_GIAO`/`DA_GIAO` → tự động gọi transition sang `HOAN_THANH` (mục 4.4). Trả `201` + attachment + `order` (để client biết nếu vừa auto-complete). |
| `GET` | `/api/shipment/orders/:orderId/attachments` | INTERNAL_ROLES | Danh sách ảnh của 1 đơn từ tab `Ảnh chứng từ`. |
| `POST` | `/api/shipment/orders/:orderId/exceptions` | INTERNAL_ROLES | Body: `{ stage?, type, description }`. `stage` mặc định = `current_status` hiện tại của đơn nếu không truyền. Side-effect: transition đơn sang `SU_CO`, lưu `prev_status` (mục 4.3), ghi dòng vào tab `Sự cố vận chuyển`. Trả exception vừa tạo + order. |
| `GET` | `/api/shipment/exceptions` | INTERNAL_ROLES | Danh sách sự cố từ tab `Sự cố vận chuyển`, filter `status` (`OPEN`/`RESOLVED`), dùng nền cho 1D. |
| `PATCH` | `/api/shipment/exceptions/:exceptionId` | INTERNAL_ROLES | Body: `{ resolution: 'RESUME'|'CANCEL', note? }`. Resolve theo mục 4.3. 409 `EXCEPTION_ALREADY_RESOLVED` nếu đã `RESOLVED`. |
| `GET` | `/api/shipment/vehicles` | INTERNAL_ROLES | Danh mục xe từ tab `Danh mục xe`. |
| `POST` | `/api/shipment/vehicles` | `Quản lý`, `Kế toán` | Thêm xe mới vào tab `Danh mục xe`. |
| `PATCH` | `/api/shipment/vehicles/:vehicleId` | `Quản lý`, `Kế toán` | Sửa thông tin xe trong tab `Danh mục xe`. |

---

## 8. Testing (bắt buộc — dự án đang giữ chuẩn 74 unit test `node:test`)

Viết test theo đúng style `server/auth/authMiddleware.test.js` / `server/shipment/invoiceStatusService.test.js` — dùng `node:test` + `node:assert/strict`, set biến môi trường test ở đầu file, không cần supertest (repo hiện dùng fake req/res thủ công cho middleware, và test trực tiếp hàm service cho business logic — **ưu tiên test service/repository/state-machine thuần, không nhất thiết phải test qua HTTP layer** trừ khi muốn thêm test tích hợp route).

Tối thiểu cần có:
- `server/shipment/orderStateMachine.test.js`: mọi cặp transition hợp lệ trong bảng 4.2 trả `true`; vài cặp không hợp lệ (vd `MOI_TAO -> DA_GIAO`, `DA_NHAT_HANG -> DANG_CHUYEN_KHO` với `flow=1`) trả `false`; `assertValidFlowWarehouse` throw đúng `code` khi sai cặp flow/warehouse.
- `server/shipment/vcOrderRepository.test.js`: mock `vcSheetsClient` (theo cách repo hiện mock `sheetsClient` trong `dashboardData.test.js` — kiểm tra file đó để copy pattern mock), test sinh `order_id` tăng dần trong cùng ngày, test `createOrder` chặn trùng `kiotviet_code`, test `transitionOrderStatus` throw `INVALID_TRANSITION` khi sai.
- `server/shipment/shipmentOrderRoutes.test.js` (nếu style dự án cho phép test route nhẹ nhàng bằng cách gọi handler trực tiếp như `authRoutes.test.js`): test `requireRole` chặn đúng vai trò cho từng endpoint nhạy cảm (`POST /orders`, `POST /vehicles`).

Chạy `npm test` (kiểm tra script trong `server/package.json`) trước khi coi là hoàn thành, đảm bảo **không làm hỏng bất kỳ test nào trong 74 test hiện có**.

---

## 9. Vấn đề mở cần người dùng/PM quyết định trước hoặc trong khi code (đừng tự ý đoán rồi ẩn đi — nêu rõ trong PR/báo cáo)

1. **Không có vai trò "Lái xe" trong `ROLES`.** Hệ thống hiện chỉ có `Quản lý/Kế toán/Trưởng kho/Trợ lý/Khách`. Theo kế hoạch UI 1C, lái xe/shipper cần thao tác Mobile Web riêng. Đề xuất mặc định cho 1B: dùng chung 4 vai trò nội bộ hiện có cho mọi endpoint (không phân quyền chi tiết theo "ai được bấm nút nào" ở tầng API — việc ẩn/hiện nút theo vai trò xử lý ở UI 1C); nếu PM muốn phân quyền cứng ngay ở API (vd chỉ `Trưởng kho` mới được `POST /attachments type=PICKUP_PHOTO`), cần bổ sung vai trò `Lái xe` vào `userRepository.js` trước — đây là thay đổi ngoài phạm vi 1B, cần xác nhận riêng.
2. **Cột thông tin khách hàng trong sheet `Hóa đơn` (KiotViet gốc)** có thể không có `customer_phone`/`address` đầy đủ — cần kiểm tra thực tế tên cột trong sheet trước khi code phần tra cứu tạo đơn (đọc header thật bằng `sheetsClient.getValues(CONFIG.SHEET_INVOICES)` trong lúc phát triển, đừng đoán tên cột).
3. **`multer` chưa chắc đã có trong `server/package.json`** — kiểm tra và thêm dependency nếu thiếu, ghi rõ trong PR.
4. **Giới hạn kích thước ảnh & rate limit upload** chưa có tiền lệ trong repo — đề xuất 8MB/ảnh là hợp lý cho ảnh chụp điện thoại nén sẵn (nén client-side sẽ làm ở 1C), có thể điều chỉnh.

---

## 10. Definition of Done

- [ ] `server/shipment/orderStateMachine.js` + test, cover toàn bộ bảng 4.2 và guard flow/warehouse.
- [ ] `server/shipment/vcOrderRepository.js` + test, cover CRUD + sinh ID + transition + exception resolve trên 6 tab tiếng Việt.
- [ ] `server/shipment/shipmentOrderRoutes.js` mount vào `server/routes.js`, đầy đủ 13 endpoint ở mục 7, đúng `requireAuth`/`requireRole`.
- [ ] Toàn bộ lỗi nghiệp vụ theo đúng pattern `{statusCode, code}` ở mục 6.
- [ ] `npm test` xanh toàn bộ (test cũ + test mới).
- [ ] Không đụng vào `server/public/shipment/index.html` hay bất kỳ file UI nào (thuộc 1C).
- [ ] Cập nhật dòng trạng thái Phase 1B trong `Plan Process Automation.md` mục 7 (đổi từ chưa đánh dấu sang đã xong) sau khi hoàn tất — theo đúng quy ước các phase trước đã tick.
