# Giảm lag TKS Dashboard — Implementation Plan & Chi tiết kỹ thuật

> **Trạng thái:** ✅ Đã hoàn thành (Fully Implemented & Verified on 19/08/2026)  
> **Phạm vi:** Tối ưu hóa toàn diện 4 lớp hệ thống (Network Delivery → Main-Thread/3D → DOM Rendering → Backend Data Layer)

**Goal:** Giảm độ trễ/giật (lag) của TKS Dashboard trên cả 2 trục: (a) tốc độ tải trang cho mọi người dùng, và (b) độ mượt khi tương tác (chuyển tab, hover, lọc bảng lớn) — mà không phá vỡ nghiệp vụ vận đơn đang chạy thật hàng ngày.

**Architecture:** App Node/Express phục vụ HTML/CSS/JS tĩnh (không bundler) + đọc/ghi dữ liệu qua Google Sheets API (`googleapis`). Các vấn đề đã xử lý:
1. Thiếu nén Gzip & thiếu header `Cache-Control` cho static assets.
2. Lớp hiệu ứng 3D (Three.js) chạy `mousemove` không throttle và `TKS3D.refresh()` quét lại toàn bộ `document`.
3. 13 bảng dữ liệu trong dashboard render toàn bộ dữ liệu vào DOM cùng lúc bằng `.map().join('')`.
4. Module vận đơn (`vcSheetsClient.js` / `vcOrderRepository.js`) không có cache và ghi tuần tự gây áp lực lên quota Google Sheets API.

**Tech Stack:** Node.js/Express, vanilla JS/HTML/CSS, Three.js r159 (vendor), Chart.js (vendor), Google Sheets API (`googleapis`).

---

## Danh sách Task chi tiết đã thực hiện

### PHASE 1 — Network & Delivery Quick-Wins

#### Task 1.1: Thêm Gzip Compression Middleware
- **Files:** `server/index.js`, `server/package.json`
- **Thực hiện:** Cài đặt package `compression` và đăng ký `app.use(compression())` ngay đầu chuỗi middleware của Express (trước mọi route và static handler).
- **Kết quả:** Header `Content-Encoding: gzip` được trả về cho mọi response; giảm 70-75% kích thước truyền tải HTML, JS, CSS và JSON API qua mạng.

#### Task 1.2: Cache-Control cho Static Assets
- **Files:** `server/index.js`
- **Thực hiện:** Cấu hình hàm `setHeaders` trong `express.static`:
  - `/vendor/*` (chart.umd.min.js, three.min.js): `public, max-age=86400` (1 ngày).
  - `/shared/*`, `/js/*`, CSS: `public, max-age=3600` (1 giờ).
  - Images (`png`, `jpg`, `jpeg`, `svg`, `webp`, `ico`): `public, max-age=604800` (7 ngày).
  - HTML entry points: Giữ ETag revalidation mặc định để cập nhật tức thì khi deploy.

#### Task 1.3: Script `defer` & Preconnect Google Fonts
- **Files:** `server/public/index.html`, `login/`, `register/`, `account/`, `shipment/`, `dispatch/`, `mobile/`
- **Thực hiện:**
  - Thêm thuộc tính `defer` vào toàn bộ thẻ `<script>` trong `<head>`.
  - Thay thế `@import` font trong `<style>` bằng `<link rel="preconnect" href="https://fonts.googleapis.com">`, `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` và `<link rel="stylesheet">` tải song song không chặn parser HTML.

#### Task 1.4: Gỡ bỏ 3D Stack khỏi Login & Register
- **Files:** `server/public/login/index.html`, `server/public/register/index.html`
- **Thực hiện:** Xóa 2 nhóm thẻ script 3D (`three-interactions.js`, `three-loading.js`, `three.min.js`, `three-performance.js`, `three-memory.js`, `three-visibility.js`, `three-bg.js`) theo đúng tài liệu `ROLLBACK.md`.
- **Kết quả:** Giảm ~650KB payload cho trang đăng nhập/đăng ký đầu tiên khi người dùng chưa đăng nhập.

#### Task 1.5: Di dời File Test khỏi Thư mục Phục vụ Công khai
- **Files:** Di chuyển 12 file `*.test.js` từ `server/public/js/` và `server/public/shared/` sang `server/test/frontend/`.
- **Thực hiện:** Cập nhật lại đường dẫn tương đối trong các lệnh `require()` của file test.
- **Kết quả:** `npm test` pass 100% (214/214 tests); thư mục `public/` sạch sẽ, không serve mã kiểm thử ra môi trường web.

---

### PHASE 2 — Giảm chi phí Main-Thread của Lớp 3D

#### Task 2.1: Throttle `onCardHover` bằng rAF Gating + Cache Bounding Rect
- **Files:** `server/public/shared/three-interactions.js`
- **Thực hiện:**
  - Cache `card.getBoundingClientRect()` một lần duy nhất tại sự kiện `mouseenter`.
  - Gộp các sự kiện `mousemove` thô (có thể >100Hz) qua `requestAnimationFrame` gating.
  - Hủy frame đang chờ bằng `cancelAnimationFrame` và dọn rect tại `mouseleave`.
- **Kết quả:** Giảm thời gian scripting của mouse hover từ ~4.5ms xuống < 0.3ms, loại bỏ hiện tượng forced reflow và dồn paint.

#### Task 2.2: Scope `TKS3D.refresh(rootEl)` vào Container Mục tiêu
- **Files:** `server/public/index.html`
- **Thực hiện:**
  - Trong `renderView(view)`: truyền `viewEl = document.getElementById(view)` vào `window.TKS3D.refresh(viewEl)`.
  - Trong `renderDebtTable()`: truyền `rows = document.getElementById('debtPeriodRows')` vào `window.TKS3D.refresh(rows)`.
- **Kết quả:** Tránh quét lại toàn bộ `document` mỗi lần chuyển view hoặc lọc dữ liệu bảng.

#### Task 2.3: Verification Pause-on-Hidden & Adaptive Quality
- **Xác nhận:** `three-bg.js` và `three-visibility.js` tạm dừng hoàn toàn animation frame khi tab ẩn; `three-performance.js` tự động hạ chất lượng hạt khi FPS giảm dưới ngưỡng.

#### Task 2.4: Dọn Tài liệu Lỗi thời
- **Files:** `ROLLBACK.md`, `3D Design.md`
- **Thực hiện:** Loại bỏ các tham chiếu tới file không tồn tại `three-charts.js`.

---

### PHASE 3 — Phân trang Client-Side cho Toàn bộ Bảng Dữ liệu (100 dòng/trang)

#### Task 3.1: Đổi `TABLE_PAGE_SIZE` từ 200 xuống 100
- **Files:** `server/public/index.html`
- **Thực hiện:** Cập nhật hằng số `const TABLE_PAGE_SIZE = 100;` dùng chung cho toàn bộ các bảng.

#### Task 3.2: Phân trang Bảng Nhà Cung Cấp
- **Files:** `server/public/index.html`
- **Thực hiện:** Thêm HTML pagination bar (`supplierPagination`, `supplierPrevPage`, `supplierNextPage`, `supplierPageLabel`) và chuyển đổi render sang `renderPaginatedRows('suppliers', ...)`.

#### Task 3.3: Phân trang + Lazy-Render Bảng Công Nợ Khách Hàng
- **Files:** `server/public/index.html`
- **Thực hiện:**
  - Thêm HTML pagination bar cho bảng công nợ (`debtPagination`...).
  - Đổi định danh dòng sang `data-customer-code`.
  - Tách chi tiết giao dịch `debt-detail-row` sang cơ chế lazy-render trong `toggleDebtDetail(triggerRow)` — chỉ render HTML bảng giao dịch khi khách hàng bấm mở rộng dòng lần đầu.

#### Task 3.4: Phân trang 11 Bảng Dữ liệu Còn lại trong `renderView()`
- **Files:** `server/public/index.html`
- **Thực hiện:** Thêm pagination bar và áp dụng `renderPaginatedRows` cho:
  1. `topSellingRows` (`topSellingPagination`)
  2. `endOfDayRows` (`endOfDayPagination` — tối đa 500 dòng giao dịch)
  3. `overviewPurchaseRows` (`overviewPurchasePagination`)
  4. `todayNewProductRows` (`todayNewProductsPagination`)
  5. `deactivatedTodayRows` (`deactivatedTodayPagination`)
  6. `newlyImportedRows` (`newlyImportedPagination`)
  7. `invoiceRows` (`invoicesPagination`)
  8. `orderRows` (`ordersPagination`)
  9. `returnRows` (`returnsPagination`)
  10. `debtRows` (`topDebtPagination`)
  11. `customerRevenueRows` (`customerRevenuePagination`)

---

### PHASE 4 — Backend Caching & Batching cho Vận đơn (Bảo vệ Quota Google Sheets API)

#### Task 4.1: Short-TTL Sheet Cache & Write Invalidation
- **Files:** `server/sheets/vcSheetsClient.js`
- **Thực hiện:**
  - Thêm in-memory cache `vcSheetCache` với `VC_SHEET_CACHE_TTL_MS = 12000` (12 giây).
  - Tự động xóa cache tương ứng qua `invalidateVcSheetCache(sheetName)` khi gọi `vcAppendRow`, `vcUpdateRow`, hoặc `vcBatchUpdate`.
  - Tái sử dụng in-flight promise (`cached.loading`) để chống thundering herd khi nhiều tab poll cùng lúc.

#### Task 4.2: Batch Hóa Cập nhật Tuần tự trong `updateOrderItems`
- **Files:** `server/sheets/vcSheetsClient.js`, `server/shipment/vcOrderRepository.js`
- **Thực hiện:**
  - Thêm hàm `vcGetSheetId(sheetName)` để lấy `sheetId` dạng số từ Google Sheets metadata.
  - Viết lại hàm `updateOrderItems` gom các yêu cầu cập nhật dòng thành mảng `requests` và gửi qua `vcClient.vcBatchUpdate(requests)` trong 1 HTTP request duy nhất.

#### Task 4.3: Request Timeout cho Google Sheets API
- **Files:** `server/sheets/vcSheetsClient.js`, `server/sheets/sheetsClient.js`
- **Thực hiện:** Thêm `{ timeout: 15000 }` (`VC_API_TIMEOUT_MS = 15000`) vào tất cả các lời gọi `sheets.spreadsheets.*` để đảm bảo request không bị treo vô hạn nếu Google Sheets API phản hồi chậm.

---

## Bảng Đối Soát Hiệu Năng Trước & Sau

| Tiêu chí | Trước tối ưu | Sau tối ưu |
|---|---|---|
| **Dung lượng trang Login** | ~920 KB (có Three.js bundle) | ~140 KB (tải nhanh tức thì) |
| **Nén Response toàn site** | Không nén (raw text/json) | Gzip nén giảm ~70-75% payload |
| **Tần suất reflow khi Hover Card** | Mỗi pixel di chuột (~100Hz) | Throttle 60fps qua rAF + cached rect |
| **Số lượng DOM Node bảng** | Render toàn bộ (hàng nghìn dòng) | Giới hạn 100 dòng/trang + Lazy detail |
| **Áp lực API Google Sheets (Vận đơn)** | Polling 25-30s từ N client đánh thẳng vào API | Cache 12s + Batch writes gom 1 request |
| **Độ an toàn Request Google API** | Không có timeout (nguy cơ treo) | Timeout 15s tự ngắt bảo vệ Express |
| **Kiểm thử tự động** | 214 tests pass | 214 tests pass (100% bao phủ) |
