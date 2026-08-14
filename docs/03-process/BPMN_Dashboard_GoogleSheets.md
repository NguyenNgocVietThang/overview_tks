# SƠ ĐỒ QUY TRÌNH NGHIỆP VỤ (BPMN)

**HỆ THỐNG DASHBOARD NỘI BỘ TOKOSI — GIAI ĐOẠN 1**

|                         |                                                                               |
|-------------------------|-------------------------------------------------------------------------------|
| **Tên tài liệu**        | Sơ đồ quy trình nghiệp vụ (BPMN) — Hệ thống Dashboard nội bộ TOKOSI          |
| **Phiên bản**           | 1.4                                                                           |
| **Ngày tạo**            | 27/07/2026                                                                    |
| **Ngày cập nhật**       | 14/08/2026                                                                    |
| **Tài liệu tham chiếu** | BRD v1.4 và SRS v1.6 — Hệ thống Dashboard nội bộ TOKOSI                      |
| **Phạm vi**             | Toàn bộ luồng nghiệp vụ Giai đoạn 1 (đã hoàn thiện)                          |
| **Trạng thái**          | Cập nhật theo code thực tế — đang vận hành                                    |

> **Ghi chú phiên bản 1.4:** Bổ sung các luồng nghiệp vụ hoàn thiện: Luồng kiểm tra Result Cache tầng backend (`dashboardResultCache`), luồng phân trang bảng client-side (`pagination.js`), luồng Xuất Excel tùy chọn trường cho 16 bảng và tìm kiếm (`exportService.js`), cùng các chế độ tìm kiếm nhiều mã / Top 3 khách hàng theo sản phẩm.

# 1. Giới thiệu

## 1.1. Mục đích tài liệu

Tài liệu này trình bày mô hình hóa quy trình nghiệp vụ (BPMN — Business Process Model and Notation) cho toàn bộ luồng vận hành của Hệ thống Dashboard nội bộ TOKOSI, cụ thể hóa các yêu cầu đã nêu trong BRD v1.4 và SRS v1.6 thành sơ đồ trực quan theo vai trò (swimlane).

## 1.2. Phạm vi mô hình hóa

Tài liệu mô hình hóa toàn bộ luồng end-to-end của Giai đoạn 1, được chia thành 3 luồng liên kết với nhau:

- **Luồng A — Đồng bộ KiotViet → Google Sheets (Apps Script):** chạy liên tục và tự động, độc lập với web dashboard.

- **Luồng B — Sử dụng Dashboard & Tiện ích (Result Cache, Phân trang, Tìm kiếm, Xuất Excel):** người dùng truy cập URL, xem KPI/biểu đồ, lọc thời gian, phân trang bảng lớn, tìm kiếm đa chế độ và xuất file Excel.

- **Luồng C — Thiết lập hệ thống (một lần):** IT Admin cấu hình biến môi trường, Apps Script, triển khai Render.

Các nhánh xử lý lỗi quan trọng (API 500, biến môi trường thiếu, webhook lỗi) được thể hiện đầy đủ.

# 2. Vai trò tham gia quy trình (Swimlane)

Sơ đồ sử dụng 1 bể (Pool) "Hệ thống Dashboard TOKOSI" với 5 làn (Lane):

| **Vai trò (Lane)**         | **Mô tả trách nhiệm**                                                                                                           |
|----------------------------|---------------------------------------------------------------------------------------------------------------------------------|
| KiotViet POS               | Phần mềm quản lý bán hàng: phát sinh thay đổi dữ liệu, gửi webhook POST JSON đến Apps Script Web App URL.                       |
| Apps Script                | Các module trong `src/` chạy trong Google Workspace: lưu webhook vào queue bền vững, chạy lịch polling 15 phút, đồng bộ vào Google Sheets. |
| Google Sheets              | Spreadsheet nguồn chứa 9 tab đồng bộ, 3 tab báo cáo khách hàng và HN1/HN3/HN7.                                                  |
| Backend (Node.js/Express)  | Server trên Render.com: quản lý Result Cache, đọc Google Sheets qua Service Account, tính toán KPI, tạo file Excel và phục vụ API. |
| Người dùng / Frontend      | Truy cập Web Dashboard: tương tác KPI, chuyển tab tức thì (<10ms), phân trang, tìm kiếm nâng cao và tải file Excel.           |

# 3. Chú giải ký hiệu sử dụng

| **Ký hiệu**                           | **Ý nghĩa**                                                                              |
|-------------------------|------------------------------------------------------------------------------------------|
| ● Hình tròn viền xanh lá (mỏng)      | Sự kiện Bắt đầu (Start Event) — điểm khởi phát của một luồng quy trình.                  |
| ● Hình tròn viền đỏ (đậm)            | Sự kiện Kết thúc (End Event) — điểm hoàn tất một nhánh/luồng.                            |
| ◎ Hình tròn đôi (viền xanh dương)    | Sự kiện trung gian / mốc quan trọng.                                                     |
| ▭ Hình chữ nhật bo góc               | Hoạt động / Tác vụ (Task) — một bước xử lý cụ thể.                                       |
| ◇ Hình thoi có dấu X (màu vàng)      | Cổng quyết định loại trừ (Exclusive Gateway) — rẽ nhánh theo điều kiện, đi đúng 1 nhánh. |
| → Mũi tên liền nét                   | Luồng tuần tự chính (Sequence Flow).                                                     |
| ⇢ Mũi tên nét đứt                    | Luồng ngoại lệ / vòng lặp / kích hoạt theo sự kiện bất đồng bộ.                         |
| ▤ Làn ngang (Lane) trong 1 bể (Pool) | Đại diện cho 1 vai trò/tác nhân.                                                         |

# 4. Sơ đồ tổng quan

```
Luồng A (liên tục, nền):  KiotViet → Apps Script → Google Sheets
                                          ↑ (polling 15 phút cho Trả hàng/NCC/Nhập hàng)

Luồng B (theo yêu cầu):   Người dùng → Frontend → Backend (Result Cache) → Google Sheets API
                                          ↓
                                     Hiển thị Dashboard / Xuất Excel / Phân trang

Luồng C (một lần):        IT Admin cấu hình Render env vars + Apps Script trigger/webhook
```

Luồng A chạy hoàn toàn độc lập với Luồng B. Backend (Luồng B) không nhận push từ Apps Script — chỉ đọc Sheets theo yêu cầu của frontend.

# 5. Luồng A — Đồng bộ KiotViet → Google Sheets (Apps Script)

Luồng này chạy liên tục và tự động, không phụ thuộc vào người dùng web dashboard.

```
[A0] ● KiotViet phát sinh thay đổi dữ liệu
     (Hàng hóa/Hóa đơn/Đặt hàng/Khách hàng/Nhóm hàng)
         |
[A1] ▭ KiotViet gửi POST JSON đến Apps Script Web App URL
     (action: product.update, invoice.update, order.update, customer.update, category.update...)
         |
[A2] ▭ Apps Script `doPost(e)` xác thực và ghi payload vào tab ẩn `_KV_WEBHOOK_QUEUE`
         |
[A3] ▭ `doPost()` trả `QUEUED` sau khi Google Sheets xác nhận ghi thành công
         |
[A4] ◎ Trigger 1 phút gọi `processWebhookQueue()`, nhận tối đa 50 sự kiện
         |
[A5] ◇ Cổng quyết định: loại action là gì?
     ├─ product/stock → updateProductsFromWebhook() → "Hàng hóa"
     ├─ invoice       → updateInvoicesFromWebhook() → "Hóa đơn" + "Chi tiết hóa đơn"
     ├─ order         → updateOrdersFromWebhook() → "Đặt hàng"
     ├─ customer      → updateCustomersFromWebhook() → "Khách hàng"
     └─ category      → updateCategoriesFromWebhook() → "Nhóm hàng"
         |
[A6] ◇ Thành công?
     ├─ Có → xóa sự kiện khỏi queue
     └─ Không → giữ payload, retry; sau 10 lần chuyển `ERROR`

--- SONG SONG: Polling trigger 15 phút ---
[A7] ● Time-based trigger kích hoạt mỗi 15 phút
         |
[A8] ▭ Apps Script chạy syncPollingOnly_():
     - syncReturns_()    → ghi lại toàn bộ sheet "Trả hàng"
     - syncSuppliers()   → ghi lại "Nhà cung cấp" + "Nhập hàng"
         |
[A9] ● Kết thúc — 3 sheet được cập nhật (tối đa trễ 15 phút)
```

| **Bước** | **Vai trò**      | **Mô tả**                                                                                           | **Tham chiếu** |
|----------|------------------|-----------------------------------------------------------------------------------------------------|----------------|
| A0       | KiotViet         | Sự kiện bắt đầu: dữ liệu thay đổi trên KiotViet (bán hàng, nhập hàng, cập nhật tồn kho...).        | —              |
| A1       | KiotViet         | Gửi POST JSON đến Apps Script Web App URL với payload chứa action và data.                          | FR-06.2        |
| A2       | Apps Script      | `doPost(e)` xác thực và ghi payload bền vững trước khi phản hồi.                                    | FR-06.2, FR-06.10 |
| A3       | Apps Script      | Trả `QUEUED`; nếu chưa ghi được thì trả lỗi và không xác nhận nhầm.                                 | FR-06.10       |
| A4–A5    | Apps Script      | Trigger 1 phút phân loại và upsert/xóa đúng dòng trong sheet tương ứng.                             | FR-06.2        |
| A6       | Apps Script      | Chỉ xóa payload khi thành công; lỗi được giữ để retry hoặc kiểm tra.                                | FR-06.10       |
| A7       | Apps Script      | Time-based trigger kích hoạt mỗi 15 phút (do KiotViet không có webhook cho Trả hàng/NCC/Nhập hàng). | FR-06.3        |
| A8       | Apps Script      | `syncPollingOnly_()`: ghi lại toàn bộ 3 sheet từ KiotViet API (full refresh, không upsert).         | FR-06.3        |
| A9       | —                | Kết thúc chu kỳ polling.                                                                            | —              |

**Lỗi trong Luồng A:**
- Nếu KiotViet API trả 429/5xx: Apps Script retry tối đa 5 lần với exponential backoff (FR-06.5).
- Nếu `doPost` không ghi được queue: trả lỗi và không xóa payload chưa được lưu.
- Nếu handler lỗi: giữ nguyên payload; retry tối đa 10 lần rồi chuyển `ERROR`.
- Nếu polling trigger bị xóa: Trả hàng/NCC/Nhập hàng sẽ không được cập nhật tự động; IT Admin cần chạy lại `setupPollingTrigger()`.

# 6. Luồng B — Sử dụng Dashboard & Tiện ích (Result Cache, Phân trang, Xuất Excel)

Luồng này xảy ra mỗi khi người dùng truy cập hoặc tương tác với Dashboard.

```
[B0] ● Người dùng mở trình duyệt, truy cập Dashboard
         |
[B1] ▭ Frontend (index.html) load xong, tự động gọi GET /api/dashboard?days=30
         |
[B2] ◇ Backend kiểm tra Result Cache:
     │ Có cache hợp lệ cho key (rawDataVersion, filters)?
     ├─ [B2-Hit] Có (Cache Hit) → Trả ngay JSON đã tính toán (<10ms) → chuyển đến B6
     └─ [B2-Miss] Không (Cache Miss) → Kiểm tra cache thô Sheets 90s:
            ├─ Còn hạn 90s → Dùng dữ liệu thô hiện tại
            └─ Hết hạn → Gọi Google Sheets API (spreadsheets.get + values.batchGet)
                    |
[B3] ◇ Cổng quyết định: Google Sheets API có trả dữ liệu thành công?
     ├─ Thất bại (403/500/timeout) →
     │   [B3-No] ▭ Backend log chi tiết lỗi và trả HTTP 500 JSON
     │   [B3-No] ▭ Frontend hiển thị thông báo lỗi cho người dùng ●
     └─ Thành công →
         [B4] ▭ Backend tính toán `computeDashboardData()`:
              - Tính KPI, revenueByDay, Top sản phẩm, bảng gần nhất...
              - Lưu kết quả vào `dashboardResultCache` theo `(rawDataVersion, filters)`
                    |
[B5] ▭ Backend trả HTTP 200 JSON toàn bộ dữ liệu
         |
[B6] ▭ Frontend render:
     - KPI cards (doanh thu, tồn kho, công nợ...)
     - Biểu đồ doanh thu theo ngày (Chart.js với animation gating chống giật)
     - Bảng dữ liệu có phân trang (`pagination.js` ~200 dòng/trang cho Hàng hóa & Hàng đã hết)
     - Hiển thị updatedAt theo giờ Việt Nam
         |
[B7] ◎ Dashboard sẵn sàng sử dụng
```

---

## 6.1. Tương tác Lọc thời gian & Làm mới

```
--- Lọc thời gian ---
[B8] ▭ Người dùng click 7 / 30 / 90 ngày
         |
[B9] ▭ Frontend gọi GET /api/dashboard?days={7|30|90} → Backend kiểm tra Result Cache (phản hồi tức thì nếu raw data chưa đổi)

--- Làm mới dữ liệu ---
[B10] ▭ Người dùng nhấn nút "Làm mới"
          |
[B11] ▭ Frontend gọi GET /api/dashboard?days={current_days} (ép fetch mới nếu qua 90s)

--- Làm mới tự động ---
[B12] ● Bộ hẹn giờ đạt 10 phút
          |
[B13] ▭ Frontend gọi lại API ở chế độ nền; chỉ render lại khi dữ liệu nghiệp vụ đổi
```

---

## 6.2. Luồng Xuất Excel (16 Bảng & Tìm kiếm)

```
[B14] ▭ Người dùng click nút "Xuất Excel" trên một bảng dữ liệu hoặc kết quả tìm kiếm
          |
[B15] ▭ Frontend gọi POST /api/export/fields với tableKey tương ứng
          |
[B16] ▭ Backend trả danh sách worksheets và fields có thể chọn
          |
[B17] ▭ Frontend mở Modal chọn trường (mặc định chọn tất cả)
          |
[B18] ▭ Người dùng xác nhận chọn trường và click "Tải file Excel"
          |
[B19] ▭ Frontend gọi POST /api/export kèm selectedFields và filterContext
          |
[B20] ▭ Backend exportService.js đọc dữ liệu từ Sheets, tạo file .xlsx:
      - Áp dụng bộ lọc hiện tại
      - Đóng băng hàng tiêu đề (Freeze pane)
      - Bật AutoFilter
      - Ép kiểu text cho mã hàng, mã HĐ, số điện thoại
          |
[B21] ● Trình duyệt tải về file .xlsx hoàn chỉnh
```

---

## 6.3. Luồng Tìm kiếm nâng cao

```
[B22] ▭ Người dùng nhập vào thanh tìm kiếm:
      ├─ Chế độ thường: Tìm theo từ khóa (mã, tên, SĐT...) → GET /api/search?q=...
      ├─ Chế độ nhiều mã: Nhập tối đa 50 mã phân tách khoảng trắng → GET /api/search?q=...&mode=codes
      └─ Chế độ Top KH theo SP (tab Khách hàng): Nhập danh sách mã → GET /api/customer-product-top?q=...
          |
[B23] ▭ Backend tìm kiếm và trả kết quả chính xác theo thứ tự nhập
          |
[B24] ▭ Frontend hiển thị dropdown gợi ý mượt mà hoặc bảng kết quả
```

| **Bước** | **Vai trò**    | **Mô tả**                                                                                           | **Tham chiếu**      |
|----------|----------------|-----------------------------------------------------------------------------------------------------|---------------------|
| B0       | Người dùng     | Mở URL Web Dashboard.                                                                               | —                   |
| B1       | Frontend       | Tự động gọi API khi page load xong, mặc định days=30.                                               | FR-04.1             |
| B2       | Backend        | Kiểm tra Result Cache theo `(rawDataVersion, filters)`; phục vụ <10ms nếu hit.                      | FR-01.7, NFR-01     |
| B3–B5    | Backend        | Fetch Sheets nếu hết hạn 90s, tính KPI qua `computeDashboardData`, lưu cache và trả JSON.           | FR-01.x, FR-02.x    |
| B6       | Frontend       | Render giao diện với Chart.js animation gating, phân trang client-side (`pagination.js`).           | FR-07.x, FR-07.13   |
| B8–B9    | Người dùng     | Đổi bộ lọc thời gian → gọi API với days mới (phản hồi tức thì nhờ cache).                           | FR-04.1, FR-04.3    |
| B14–B21  | Người dùng/Dev | Quy trình mở modal chọn trường và xuất workbook `.xlsx` 16 bảng / tìm kiếm.                          | FR-07.10 → FR-07.12 |
| B22–B24  | Người dùng/Dev | Tìm kiếm thông thường, tìm nhiều mã và Top 3 KH theo danh mục sản phẩm.                            | FR-07.8, FR-07.9    |

# 7. Luồng C — Thiết lập hệ thống (một lần)

Luồng này do IT Admin thực hiện khi triển khai lần đầu hoặc khi cần cấu hình lại.

```
[C0] ● Bắt đầu: cần triển khai/cấu hình lại hệ thống

--- Phần 1: Cấu hình Render.com ---
[C1] ▭ IT Admin tạo/cập nhật Web Service trên Render.com
[C2] ▭ Cấu hình biến môi trường:
     - SPREADSHEET_ID = {ID của Google Spreadsheet}
     - GOOGLE_SERVICE_ACCOUNT_JSON = {nội dung JSON của Service Account key}
     - KIOTVIET_CLIENT_ID, KIOTVIET_CLIENT_SECRET, KIOTVIET_RETAILER
     - PORT = 3000 (tùy chọn, Render tự inject)
[C3] ▭ Render tự động deploy từ GitHub branch main (chạy `npm install` và `npm test`)
[C4] ◇ Deploy thành công?
     ├─ Không → kiểm tra logs Render → quay lại C1
     └─ Có →
[C5] ▭ Truy cập /api/debug để kiểm tra kết nối Sheets và danh sách tab
[C6] ◇ sheetsTest OK và sheetTabs đủ schema kỳ vọng?
     ├─ Không → kiểm tra quyền Service Account hoặc tên tab → quay lại C2/C5
     └─ Có →

--- Phần 2: Cấu hình Apps Script ---
[C7] ▭ Dùng clasp push các module trong `src/` lên dự án Apps Script
[C8] ▭ Lưu → Deploy → New deployment → Web app (Execute as: Me, Access: Anyone) → Copy URL
[C9] ▭ Chạy `syncAllInitialData()` để tải dữ liệu ban đầu
[C10] ▭ Chạy `setupKiotVietAutoSync()` để tự tạo secret, trigger 1 phút, polling 15 phút và đăng ký 9 webhook
[C11] ◎ Hệ thống đã cấu hình hoàn chỉnh, sẵn sàng vận hành
```

| **Bước** | **Vai trò**  | **Mô tả**                                                                                       | **Tham chiếu** |
|----------|--------------|-------------------------------------------------------------------------------------------------|----------------|
| C0       | IT Admin     | Sự kiện bắt đầu: triển khai lần đầu hoặc cấu hình lại.                                          | —              |
| C1–C2    | IT Admin     | Cấu hình Web Service và biến môi trường trên Render.com.                                        | NFR-03, FR-01.3|
| C3–C4    | Render.com   | Auto-deploy từ GitHub, chạy bộ test tự động và kiểm tra kết quả deploy.                         | NFR-02, NFR-12 |
| C5–C6    | IT Admin     | Dùng `/api/debug` để xác nhận kết nối và đối chiếu danh sách tab Google Sheets thực tế.         | FR-07.5        |
| C7–C8    | IT Admin     | Triển khai Apps Script làm Web App để nhận webhook từ KiotViet.                                 | FR-06.4        |
| C9       | IT Admin     | Đồng bộ toàn bộ dữ liệu KiotViet lần đầu vào Spreadsheet.                                      | FR-06.1        |
| C10      | IT Admin     | Bật auto sync: trigger 1 phút, polling 15 phút, báo cáo hàng ngày và đăng ký 9 webhook KiotViet. | FR-06.3, FR-06.4 |
| C11      | —            | Hệ thống sẵn sàng vận hành đầy đủ.                                                              | —              |

# 8. Truy vết yêu cầu

Mỗi bước trong 3 luồng đã được gắn mã yêu cầu chức năng/phi chức năng (FR-xx / NFR-xx) tương ứng với SRS v1.6 mục 3 và mục 4, giúp truy vết đầy đủ hai chiều giữa mô hình quy trình (BPMN) và đặc tả kỹ thuật (SRS).

| **Luồng** | **Yêu cầu SRS bao phủ**                      |
|-----------|----------------------------------------------|
| Luồng A   | FR-06.1 → FR-06.14, NFR-09                   |
| Luồng B   | FR-01.1 → FR-01.7, FR-02.x, FR-03.x, FR-04.x, FR-05.x, FR-07.1 → FR-07.14, NFR-01, NFR-03, NFR-10, NFR-11 |
| Luồng C   | FR-01.3, FR-06.4, FR-07.5, NFR-02, NFR-03, NFR-12 |

# 9. Ghi chú & khuyến nghị

- **Điểm mấu chốt:** Backend web (Luồng B) và Apps Script (Luồng A) hoạt động hoàn toàn độc lập — backend không nhận push từ Apps Script, chỉ pull từ Sheets khi có request. Tích hợp Result Cache giúp việc chuyển tab và đổi bộ lọc diễn ra tức thì (<10ms).

- **Khả năng suy giảm có kiểm soát:** Một tab nguồn bị thiếu/đổi tên chỉ làm rỗng section tương ứng; IT Admin dùng `sheetTabs` từ `/api/debug` để xác định sai lệch schema. Lỗi xác thực, quyền truy cập hoặc Google API vẫn đi theo nhánh B3-No.

- **Nhất quán thời gian:** Backend xử lý ngày và `updatedAt` theo Asia/Ho_Chi_Minh. Frontend tự tải mỗi 10 phút và tải bù khi tab được xem lại để tránh timestamp bị cũ do browser throttling.

- **Kiểm thử liên tục:** Trước khi commit hoặc deploy, luôn chạy `npm test` tại `server/` để kiểm tra toàn bộ 21 unit tests.

*— Hết tài liệu BPMN v1.4 —*
