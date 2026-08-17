# Phase 1C — Web Desktop Điều phối (Kế toán) & Mobile Web (Kho/Lái xe)

**Dự án:** TOKOSI Dashboard — Module "Quản lý vận chuyển" (Giai đoạn 3)
**Vị trí trong roadmap:** `Phase 1: MVP Quản lý Vận chuyển Web-First` → hạng mục con **1C**, sau **1A** (đã xong: spreadsheet `VC_*` + Drive service) và **1B** (đã xong: state machine + 15 endpoint CRUD/transition, xem `server/shipment/`), trước **1D** (Đối soát cuối ngày).
**Tài liệu gốc bắt buộc đọc trước khi code:**
- [`Plan Process Automation.md`](file:///d:/Web%20TKS%20Dashboard/Plan%20Process%20Automation.md) — mục 5 (State Machine), mục 6.1/6.2 (đặc tả UI Desktop/Mobile)
- [`docs/04-planning/phase1b_backend_state_machine_api.md`](file:///d:/Web%20TKS%20Dashboard/docs/04-planning/phase1b_backend_state_machine_api.md) — hợp đồng API mà 1C tiêu thụ
- [`docs/04-planning/implementation_plan.md`](file:///d:/Web%20TKS%20Dashboard/docs/04-planning/implementation_plan.md) mục 6 — tổng quan trạng thái các phase

---

## 1. Mục tiêu

Xây dựng **giao diện web** cho quy trình vận chuyển đã có backend từ Phase 1B, gồm 2 trang:

1. **Web Desktop Điều phối** (`/shipment/dispatch/`) — dành cho **Kế toán/Quản lý**: tạo đơn 1-click từ hóa đơn KiotViet, theo dõi Kanban theo trạng thái, lọc/tìm kiếm, xử lý sự cố, quản lý danh mục xe.
2. **Mobile Web 1-chạm** (`/shipment/mobile/`) — dành cho **Thủ kho & Lái xe**: nút bấm lớn, chụp ảnh trực tiếp qua Camera API, nén ảnh client-side, thao tác tối thiểu để cập nhật trạng thái đơn ngoài hiện trường.

Không thuộc phạm vi: `/shipment/audit/` (đối soát cuối ngày — Phase 1D), Bot Telegram/OCR (Phase 2).

## 2. Quyết định đã chốt

- **Phạm vi 1C bao gồm cả tính năng "Tạo đơn 1-click từ KiotViet"** (mục 6.1) — vì đây là điểm khởi đầu quy trình, không có nó thì Kế toán không tạo được đơn mới trên UI.
- **Bổ sung role mới `Lái xe`** vào RBAC (thay vì dùng tạm role có sẵn) để phân quyền server-side rõ ràng, tách biệt khỏi Thủ kho.
- 1B đã hoàn thành đầy đủ và đang chạy — 1C chỉ cần xây UI tiêu thụ API có sẵn, cộng 1 endpoint nhỏ còn thiếu (mục 3).

## 3. Việc backend còn thiếu trước khi làm UI: danh sách hóa đơn KiotViet chưa tạo đơn

`POST /api/shipment/orders` ([`server/shipment/shipmentOrderRoutes.js:122`](file:///d:/Web%20TKS%20Dashboard/server/shipment/shipmentOrderRoutes.js)) chỉ nhận **một** `kiotviet_code` đã biết trước — không có API trả về *danh sách* hóa đơn mới để Kế toán tick chọn hàng loạt. Cần thêm:

- **`GET /api/shipment/invoices/pending`** (route mới, quyền `authDispatch` = Quản lý + Kế toán):
  - Đọc `sheetsClient.getValues(CONFIG.SHEET_INVOICES)` (sheet `Hóa đơn` gốc KiotViet).
  - Đọc toàn bộ đơn vận chuyển hiện có qua `repo.getOrders({})`.
  - Lọc ra các hóa đơn có `Mã hóa đơn` **chưa** xuất hiện trong `kiotviet_code` của bất kỳ đơn VC nào.
  - Trả về `{ invoices: [{ kiotviet_code, customer_name, customer_phone, address, ... }] }`.
  - Hỗ trợ query `dateFrom`/`dateTo` để giới hạn phạm vi quét, tránh tải toàn bộ sheet lớn.
  - Viết kèm unit test theo pattern `server/shipment/*.test.js` hiện có (fake req/res + stub `sheetsClient`/`repo`).

## 4. Phần 1 — Thêm role "Lái xe"

| File | Thay đổi |
|---|---|
| [`server/auth/userRepository.js`](file:///d:/Web%20TKS%20Dashboard/server/auth/userRepository.js) | Thêm `LAI_XE: 'Lái xe'` vào `ROLES`; thêm vào `INTERNAL_ROLES` để nhất quán với 4 role nội bộ hiện có (Quản lý, Kế toán, Trưởng kho, Trợ lý). |
| [`server/scripts/setupUsersSheet.js`](file:///d:/Web%20TKS%20Dashboard/server/scripts/setupUsersSheet.js) | Cập nhật danh sách role hợp lệ dùng khi tạo/sửa tài khoản qua CLI. |
| `server/auth/userRepository.test.js` | Thêm test cho role mới. |

Không cần middleware role-cứng mới cho các endpoint transition/upload — 1B đã cấp quyền cho toàn bộ `INTERNAL_ROLES` (bao gồm role mới sau khi thêm); UI tự ẩn/hiện nút theo `user.vaiTro`. `authDispatch` (tạo đơn/sửa metadata/quản lý xe) giữ nguyên giới hạn Quản lý + Kế toán — Lái xe/Thủ kho không có các quyền này, đúng nghiệp vụ.

## 5. Phần 2 — Trang Desktop Điều phối: `/shipment/dispatch/`

Theo đúng pattern trang hiện có [`server/public/shipment/index.html`](file:///d:/Web%20TKS%20Dashboard/server/public/shipment/index.html): HTML/CSS/JS thuần (không framework/bundler), dùng `shared.css` + `shared-nav.js`, gọi `TKSNav.authGuard()` và `TKSNav.renderTopSidebar(el, 'shipment')`.

**Cấu trúc:**

1. **Panel "Tạo đơn từ KiotViet"** — gọi `GET /api/shipment/invoices/pending`, render bảng checkbox → chọn nhiều hóa đơn → chọn Luồng (1-4) + Xe (`GET /api/shipment/vehicles`) + Lái xe → nút "Tạo đơn" gọi `POST /api/shipment/orders` cho từng hóa đơn đã tick, hiển thị kết quả thành công/lỗi theo dòng.
2. **Bảng Kanban** theo cột trạng thái: Mới tạo → Đã in → Đã nhặt hàng → (Đang chuyển kho, chỉ hiện khi có đơn flow 3) → Đang giao → Đã giao/Hoàn thành, cột riêng cho Sự cố. Dữ liệu từ `GET /api/shipment/orders`, cập nhật qua polling định kỳ (~30s) hoặc nút "Làm mới" (dự án chưa dùng WebSocket).
3. **Bộ lọc**: Ngày, Kho, Luồng, Lái xe, Trạng thái — map trực tiếp sang query params đã hỗ trợ sẵn ở `GET /api/shipment/orders`.
4. **Modal chi tiết đơn** (mở từ card Kanban): `GET /api/shipment/orders/:orderId`, ảnh chứng từ (`GET .../attachments`), lịch sử trạng thái, nút chuyển trạng thái hợp lệ tiếp theo (`POST .../transition`), nút "Báo sự cố" (`POST .../exceptions`), form sửa metadata (`PATCH /api/shipment/orders/:orderId`).
5. **Quản lý xe** — danh sách + thêm/sửa qua `GET/POST/PATCH /api/shipment/vehicles`.

## 6. Phần 3 — Trang Mobile Web: `/shipment/mobile/`

Thiết kế mobile-first (nút chạm ≥44px), tách 2 luồng theo `user.vaiTro`:

**Thủ kho (`Trưởng kho`):**
- Danh sách đơn trạng thái "Đã in" cần nhặt.
- **[📷 Chụp ảnh hàng nhặt]** (`<input type="file" accept="image/*" capture="environment">`) → nén ảnh client-side → **[Xác nhận đã nhặt]**: `POST .../attachments` (type `PICKUP_PHOTO`) rồi `POST .../transition` sang "Đã nhặt hàng".

**Lái xe (role mới):**
- Danh sách đơn của mình (`driverName` khớp `user.hoTen`), trạng thái "Đã nhặt hàng"/"Đang chuyển kho"/"Đang giao".
- **[Bắt đầu giao]** → transition sang "Đang giao".
- Chụp ảnh bill ký nhận/hàng (`SIGNED_BILL`/`DELIVERY_PHOTO`) → upload. Backend đã có quy tắc auto-complete (`shipmentOrderRoutes.js` mục 4.4): upload ảnh này tự chuyển đơn sang "Hoàn thành" — UI chỉ hiển thị `order` trả về từ response upload, không cần gọi transition thủ công thêm.
- **[Báo sự cố]** dùng chung cho cả 2 vai trò.

**Nén ảnh client-side:** dùng `<canvas>` (resize cạnh dài về ≤1280px, `canvas.toBlob(..., 'image/jpeg', 0.7)`) trước khi đưa vào `FormData` — không cần thư viện ngoài. Tách thành hàm dùng chung ở file mới `server/public/shared/image-compress.js`.

## 7. Phần 4 — Điều hướng

- Giữ nguyên sidebar 2 mục hiện có trong `shared-nav.js` (`renderTopSidebar`). Không thêm mục sidebar cấp cao mới.
- Thêm liên kết nội bộ (chỉ hiện với role nội bộ, ẩn với `Khách`) từ trang `/shipment/` hiện tại sang `/shipment/dispatch/` và `/shipment/mobile/`.
- `TKSNav.authGuard()` giữ nguyên logic redirect `Khách` → `/shipment/`; không ảnh hưởng 2 trang mới vì chỉ role nội bộ truy cập được.

## 8. Danh sách file dự kiến

**Tạo mới:**
- `server/public/shipment/dispatch/index.html` + `dispatch.js` (tách JS riêng ngay từ đầu để dễ bảo trì)
- `server/public/shipment/mobile/index.html` + `mobile.js`
- `server/public/shared/image-compress.js`
- Route mới `GET /api/shipment/invoices/pending` trong `server/shipment/shipmentOrderRoutes.js` + test tương ứng

**Sửa:**
- `server/auth/userRepository.js` — thêm `ROLES.LAI_XE`
- `server/scripts/setupUsersSheet.js` — cập nhật danh sách role hợp lệ
- `server/public/shipment/index.html` hoặc `shared-nav.js` — thêm liên kết vào Dispatch/Mobile
- `docs/04-planning/implementation_plan.md` — đánh dấu 1C hoàn thành sau khi triển khai xong (bước cuối)

## 9. Xác minh

1. `npm test` trong `server/` — toàn bộ test hiện có phải pass, cộng test mới cho route `invoices/pending` và role `Lái xe`.
2. Chạy server cục bộ, đăng nhập từng role (Kế toán, Quản lý, Trưởng kho, Lái xe — tạo qua `setupUsersSheet.js`), xác minh:
   - `/shipment/dispatch/`: tạo đơn từ hóa đơn KiotViet → xuất hiện đúng cột "Mới tạo"; bộ lọc Kho/Luồng/Trạng thái hoạt động đúng.
   - `/shipment/mobile/`: Thủ kho chụp/upload ảnh nhặt hàng → đơn chuyển "Đã nhặt hàng". Lái xe bấm "Bắt đầu giao" → upload ảnh bill → đơn tự chuyển "Hoàn thành".
   - Role `Khách` không truy cập được 2 trang mới (redirect về `/shipment/`).
3. Kiểm tra responsive (`mobile` cho `/shipment/mobile/`, `desktop` cho `/shipment/dispatch/`) và dark/light theme không vỡ layout.
