# SƠ ĐỒ QUY TRÌNH NGHIỆP VỤ (BPMN)

**HỆ THỐNG DASHBOARD NỘI BỘ TOKOSI — GIAI ĐOẠN 1**

|                         |                                                                               |
|-------------------------|-------------------------------------------------------------------------------|
| **Tên tài liệu**        | Sơ đồ quy trình nghiệp vụ (BPMN) — Hệ thống Dashboard nội bộ TOKOSI          |
| **Phiên bản**           | 1.1                                                                           |
| **Ngày tạo**            | 27/07/2026                                                                    |
| **Ngày cập nhật**       | 28/07/2026                                                                    |
| **Tài liệu tham chiếu** | BRD v1.1 và SRS v1.1 — Hệ thống Dashboard nội bộ TOKOSI                      |
| **Phạm vi**             | Toàn bộ luồng nghiệp vụ Giai đoạn 1 (đã triển khai)                          |
| **Trạng thái**          | Cập nhật theo code thực tế — đang vận hành                                    |

> **Ghi chú phiên bản 1.1:** Cập nhật để phản ánh đúng luồng thực tế đã triển khai. Thay đổi chính so với v1.0: (1) không có OAuth/đăng nhập người dùng; (2) webhook từ KiotViet đến Apps Script (không phải từ Apps Script đến backend); (3) backend chỉ đọc Sheets theo yêu cầu, không nhận push; (4) bộ lọc 7/30/90 ngày (không phải 1/7/30/90); (5) không có Redis/cache, không có phân quyền.

# 1. Giới thiệu

## 1.1. Mục đích tài liệu

Tài liệu này trình bày mô hình hóa quy trình nghiệp vụ (BPMN — Business Process Model and Notation) cho toàn bộ luồng vận hành của Hệ thống Dashboard nội bộ TOKOSI, cụ thể hóa các yêu cầu đã nêu trong BRD v1.1 và SRS v1.1 thành sơ đồ trực quan theo vai trò (swimlane).

## 1.2. Phạm vi mô hình hóa

Tài liệu mô hình hóa toàn bộ luồng end-to-end của Giai đoạn 1, được chia thành 3 luồng liên kết với nhau:

- **Luồng A — Đồng bộ KiotViet → Google Sheets (Apps Script):** chạy liên tục và tự động, độc lập với web dashboard.

- **Luồng B — Sử dụng Dashboard:** người dùng truy cập URL, xem KPI/biểu đồ, lọc thời gian, làm mới dữ liệu.

- **Luồng C — Thiết lập hệ thống (một lần):** IT Admin cấu hình biến môi trường, Apps Script, triển khai Render.

Các nhánh xử lý lỗi quan trọng (API 500, biến môi trường thiếu, webhook lỗi) được thể hiện đầy đủ.

# 2. Vai trò tham gia quy trình (Swimlane)

Sơ đồ sử dụng 1 bể (Pool) "Hệ thống Dashboard TOKOSI" với 5 làn (Lane):

| **Vai trò (Lane)**         | **Mô tả trách nhiệm**                                                                                                           |
|----------------------------|---------------------------------------------------------------------------------------------------------------------------------|
| KiotViet POS               | Phần mềm quản lý bán hàng: phát sinh thay đổi dữ liệu, gửi webhook POST JSON đến Apps Script Web App URL.                       |
| Apps Script                | `KiotVietExport.gs` chạy trong Google Workspace: nhận webhook từ KiotViet, chạy lịch polling 5 phút, đồng bộ vào Google Sheets. |
| Google Sheets              | Spreadsheet nguồn chứa 8 sheet cố định: nơi lưu trữ dữ liệu được đồng bộ từ KiotViet qua Apps Script.                          |
| Backend (Node.js/Express)  | Server trên Render.com: nhận request từ frontend, gọi Google Sheets API (batchGet), tính KPI, trả JSON.                         |
| Người dùng / Frontend      | Người dùng nội bộ truy cập `tokosi.onrender.com`: xem Dashboard, lọc thời gian, nhấn Làm mới.                                  |

# 3. Chú giải ký hiệu sử dụng

| **Ký hiệu**                           | **Ý nghĩa**                                                                              |
|---------------------------------------|------------------------------------------------------------------------------------------|
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
                                          ↑ (polling 5 phút cho Trả hàng/NCC/Nhập hàng)

Luồng B (theo yêu cầu):   Người dùng → Frontend → Backend → Google Sheets API
                                          ↓
                                     Hiển thị Dashboard

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
[A2] ▭ Apps Script `doPost(e)` nhận webhook payload
         |
[A3] ◇ Cổng quyết định: loại action là gì?
     ├─ product/stock → [A4a] upsertProductFromWebhook_ → cập nhật dòng trong "Hàng hóa"
     ├─ invoice       → [A4b] upsertInvoiceFromWebhook_ → cập nhật "Hóa đơn" + replaceInvoiceDetailRows_ → "Chi tiết hóa đơn"
     ├─ order         → [A4c] upsertOrderFromWebhook_  → cập nhật dòng trong "Đặt hàng"
     ├─ customer      → [A4d] upsertCustomerFromWebhook_ → cập nhật dòng trong "Khách hàng"
     └─ category      → [A4e] upsertCategoryFromWebhook_ → cập nhật dòng trong "Nhóm hàng"
         |
[A5] ▭ Apps Script trả HTTP 200 {"ok":true} về KiotViet (tránh KiotViet retry vô hạn)
         |
[A6] ● Kết thúc — dữ liệu đã cập nhật trong Google Sheets

--- SONG SONG: Polling trigger 5 phút ---
[A7] ● Time-based trigger kích hoạt mỗi 5 phút
         |
[A8] ▭ Apps Script chạy syncPollingOnly_():
     - syncReturns_()    → ghi lại toàn bộ sheet "Trả hàng"
     - syncSuppliers()   → ghi lại "Nhà cung cấp" + "Nhập hàng"
         |
[A9] ● Kết thúc — 3 sheet được cập nhật (tối đa trễ 5 phút)
```

| **Bước** | **Vai trò**      | **Mô tả**                                                                                           | **Tham chiếu** |
|----------|------------------|-----------------------------------------------------------------------------------------------------|----------------|
| A0       | KiotViet         | Sự kiện bắt đầu: dữ liệu thay đổi trên KiotViet (bán hàng, nhập hàng, cập nhật tồn kho...).        | —              |
| A1       | KiotViet         | Gửi POST JSON đến Apps Script Web App URL với payload chứa action và data.                          | FR-06.2        |
| A2       | Apps Script      | `doPost(e)` nhận và parse payload; xác định loại action.                                            | FR-06.2        |
| A3       | Apps Script      | Cổng quyết định theo loại action.                                                                   | FR-06.2        |
| A4a–A4e  | Apps Script      | Cập nhật đúng dòng trong sheet tương ứng (upsert theo mã — không xóa toàn sheet).                  | FR-06.2        |
| A5       | Apps Script      | Trả 200 OK về KiotViet để ngừng retry.                                                              | FR-06.2        |
| A6       | —                | Kết thúc chu kỳ webhook.                                                                            | —              |
| A7       | Apps Script      | Time-based trigger kích hoạt mỗi 5 phút (do KiotViet không có webhook cho Trả hàng/NCC/Nhập hàng). | FR-06.3        |
| A8       | Apps Script      | `syncPollingOnly_()`: ghi lại toàn bộ 3 sheet từ KiotViet API (full refresh, không upsert).         | FR-06.3        |
| A9       | —                | Kết thúc chu kỳ polling.                                                                            | —              |

**Lỗi trong Luồng A:**
- Nếu KiotViet API trả 429/5xx: Apps Script retry tối đa 5 lần với exponential backoff (FR-06.5).
- Nếu `doPost` throw exception: trả 200 OK để KiotViet không retry, log lỗi vào console.
- Nếu polling trigger bị xóa: Trả hàng/NCC/Nhập hàng sẽ không được cập nhật tự động; IT Admin cần chạy lại `setupPollingTrigger()`.

# 6. Luồng B — Sử dụng Dashboard (theo yêu cầu người dùng)

Luồng này xảy ra mỗi khi người dùng truy cập hoặc tương tác với Dashboard.

```
[B0] ● Người dùng mở trình duyệt, truy cập tokosi.onrender.com
         |
[B1] ▭ Frontend (index.html) load xong, tự động gọi GET /api/dashboard?days=30
         |
[B2] ▭ Backend nhận request, gọi Google Sheets API:
     sheetsClient.getMultipleSheetValues([8 sheet names]) — 1 lần batchGet
         |
[B3] ◇ Cổng quyết định: Google Sheets API có trả dữ liệu thành công?
     |
     ├─ Thất bại (403/500/timeout) →
     |   [B3-No] ▭ Backend log chi tiết lỗi (message, googleStatus, stack)
     |   [B3-No] ▭ Backend trả HTTP 500 JSON: {error, detail, googleStatus, googleMessage}
     |   [B3-No] ▭ Frontend hiển thị thông báo lỗi cho người dùng ●
     |
     └─ Thành công →
         [B4] ▭ dashboardData.getDashboardData() tính toán:
              - KPI (doanh thu hôm nay, tồn kho, công nợ, đặt hàng, trả hàng, nhập hàng)
              - revenueByDay (mảng ngày trong kỳ)
              - Top sản phẩm bán chạy, hàng tồn thấp, công nợ top 8
              - Dữ liệu gần nhất: 8 HĐ, 8 đặt hàng, 8 trả hàng, 8 nhập hàng
                   |
         [B5] ▭ Backend trả HTTP 200 JSON toàn bộ dữ liệu
                   |
         [B6] ▭ Frontend render:
              - KPI cards (doanh thu, tồn kho, công nợ...)
              - Biểu đồ doanh thu theo ngày (Chart.js)
              - Bảng top sản phẩm, hàng tồn thấp, công nợ, đơn hàng gần nhất
              - Hiển thị updatedAt timestamp
                   |
         [B7] ◎ Dashboard sẵn sàng sử dụng
```

**Tương tác người dùng sau khi Dashboard đã load:**

```
--- Lọc thời gian ---
[B8] ▭ Người dùng click 7 / 30 / 90 ngày
         |
[B9] ▭ Frontend gọi lại GET /api/dashboard?days={7|30|90}
         → quay về B2

--- Làm mới dữ liệu ---
[B10] ▭ Người dùng nhấn nút "Làm mới"
          |
[B11] ▭ Frontend hiển thị trạng thái loading
          |
[B12] ▭ Frontend gọi GET /api/dashboard?days={current_days}
          → quay về B2

--- Kết thúc phiên ---
[B13] ● Người dùng đóng trình duyệt
```

| **Bước** | **Vai trò**    | **Mô tả**                                                                               | **Tham chiếu**      |
|----------|----------------|-----------------------------------------------------------------------------------------|---------------------|
| B0       | Người dùng     | Sự kiện bắt đầu: mở URL `tokosi.onrender.com`.                                          | —                   |
| B1       | Frontend       | Tự động gọi API khi page load xong, mặc định days=30.                                   | FR-04.1             |
| B2       | Backend        | Gọi Google Sheets API `batchGet` đọc 8 sheet trong 1 request.                           | FR-01.1             |
| B3       | Backend        | Kiểm tra kết quả từ Sheets API.                                                         | FR-01.4             |
| B3-No    | Backend        | Trả 500 kèm chi tiết lỗi; frontend hiển thị thông báo.                                  | FR-01.4, FR-05.3    |
| B4       | Backend        | Tính toán toàn bộ KPI, biểu đồ, bảng từ dữ liệu 8 sheet.                               | FR-02.x, FR-03.x    |
| B5       | Backend        | Trả HTTP 200 JSON.                                                                      | API spec mục 6.1    |
| B6       | Frontend       | Render giao diện: KPI cards, biểu đồ, bảng chi tiết, timestamp.                         | FR-07.x             |
| B7       | —              | Dashboard sẵn sàng.                                                                     | —                   |
| B8–B9    | Người dùng     | Đổi bộ lọc thời gian → gọi lại API với days mới.                                        | FR-04.1, FR-04.3    |
| B10–B12  | Người dùng     | Nhấn "Làm mới" → gọi lại API với days hiện tại, hiển thị loading.                       | FR-05.1, FR-05.3    |

# 7. Luồng C — Thiết lập hệ thống (một lần)

Luồng này do IT Admin thực hiện khi triển khai lần đầu hoặc khi cần cấu hình lại.

```
[C0] ● Bắt đầu: cần triển khai/cấu hình lại hệ thống

--- Phần 1: Cấu hình Render.com ---
[C1] ▭ IT Admin tạo/cập nhật Web Service trên Render.com
[C2] ▭ Cấu hình biến môi trường:
     - SPREADSHEET_ID = {ID của Google Spreadsheet}
     - GOOGLE_SERVICE_ACCOUNT_JSON = {nội dung JSON của Service Account key}
     - PORT = 3000 (tùy chọn, Render tự inject)
[C3] ▭ Render tự động deploy từ GitHub branch main
[C4] ◇ Deploy thành công?
     ├─ Không → kiểm tra logs Render → quay lại C1
     └─ Có →
[C5] ▭ Truy cập /api/debug để kiểm tra:
     - SPREADSHEET_ID: true/false
     - GOOGLE_SERVICE_ACCOUNT_JSON: true/false
     - sheetsTest: "OK — N rows..." hoặc sheetsError
[C6] ◇ sheetsTest OK?
     ├─ Không → kiểm tra Service Account có được share Spreadsheet chưa → quay lại C2
     └─ Có →

--- Phần 2: Cấu hình Apps Script ---
[C7] ▭ Mở Google Spreadsheet → Extensions → Apps Script → dán KiotVietExport.gs
[C8] ▭ Lưu → Deploy → New deployment → Web app
     - Execute as: Me
     - Who has access: Anyone
     - Copy Web App URL
[C9] ▭ Menu KiotViet → "Đồng bộ tất cả" (sync toàn bộ lần đầu)
[C10] ▭ Menu KiotViet → "Bật cập nhật real-time" → dán Web App URL
      → Apps Script đăng ký 9 loại webhook với KiotViet API
[C11] ▭ Menu KiotViet → "Bật lịch tự động 5 phút"
      → Apps Script tạo time-based trigger cho Trả hàng/NCC/Nhập hàng
[C12] ◎ Hệ thống đã cấu hình hoàn chỉnh, sẵn sàng vận hành
      → Chuyển sang Luồng A (tự động) và Luồng B (theo yêu cầu)
```

| **Bước** | **Vai trò**  | **Mô tả**                                                                                       | **Tham chiếu** |
|----------|--------------|-------------------------------------------------------------------------------------------------|----------------|
| C0       | IT Admin     | Sự kiện bắt đầu: triển khai lần đầu hoặc cấu hình lại.                                          | —              |
| C1–C2    | IT Admin     | Cấu hình Web Service và biến môi trường trên Render.com.                                        | NFR-03, FR-01.3|
| C3–C4    | Render.com   | Auto-deploy từ GitHub, kiểm tra kết quả deploy.                                                 | NFR-02         |
| C5–C6    | IT Admin     | Dùng `/api/debug` để xác nhận kết nối Google Sheets API thành công.                             | FR-07.5        |
| C7–C8    | IT Admin     | Triển khai Apps Script làm Web App để nhận webhook từ KiotViet.                                 | FR-06.4        |
| C9       | IT Admin     | Đồng bộ toàn bộ dữ liệu KiotViet lần đầu vào Spreadsheet.                                      | FR-06.1        |
| C10      | IT Admin     | Đăng ký 9 loại webhook KiotViet → Apps Script.                                                  | FR-06.4        |
| C11      | IT Admin     | Bật trigger polling 5 phút cho 3 bảng không có webhook.                                         | FR-06.3        |
| C12      | —            | Hệ thống sẵn sàng vận hành đầy đủ.                                                              | —              |

# 8. Truy vết yêu cầu

Mỗi bước trong 3 luồng đã được gắn mã yêu cầu chức năng/phi chức năng (FR-xx / NFR-xx) tương ứng với SRS v1.1 mục 3 và mục 4, giúp truy vết đầy đủ hai chiều giữa mô hình quy trình (BPMN) và đặc tả kỹ thuật (SRS).

| **Luồng** | **Yêu cầu SRS bao phủ**                      |
|-----------|----------------------------------------------|
| Luồng A   | FR-06.1 → FR-06.5, NFR-09                    |
| Luồng B   | FR-01.x, FR-02.x, FR-03.x, FR-04.x, FR-05.x, FR-07.x, NFR-01, NFR-03 |
| Luồng C   | FR-01.3, FR-06.4, FR-07.5, NFR-02, NFR-03    |

# 9. Ghi chú & khuyến nghị

- **Điểm mấu chốt:** Backend web (Luồng B) và Apps Script (Luồng A) hoạt động hoàn toàn độc lập — backend không nhận push từ Apps Script, chỉ pull từ Sheets khi có request. Đây là thiết kế đơn giản và phù hợp với quy mô hiện tại.

- **Điểm yếu cần lưu ý:** Nếu KiotViet webhook bị gỡ và polling trigger cũng bị xóa → dữ liệu trong Sheets sẽ ngừng cập nhật tự động. Cần theo dõi định kỳ và dùng `syncAll()` để recover khi cần.

- **Nâng cấp tương lai (Giai đoạn 2+):** Khi thêm phân quyền, chỉ cần bổ sung middleware auth vào Express routes — không ảnh hưởng đến Luồng A và logic tính KPI. Khi thêm cache (Redis), thêm layer trước bước B2 — không thay đổi luồng tổng thể.

- Nếu đội phát triển cần chỉnh sửa sơ đồ bằng công cụ BPMN chuẩn (Camunda Modeler, bpmn.io, draw.io), các sơ đồ này có thể chuyển đổi sang định dạng .bpmn (XML chuẩn BPMN 2.0).

*— Hết tài liệu BPMN v1.1 —*
