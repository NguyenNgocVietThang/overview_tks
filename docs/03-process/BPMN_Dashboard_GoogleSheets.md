# SƠ ĐỒ QUY TRÌNH NGHIỆP VỤ (BPMN)

**HỆ THỐNG DASHBOARD NỘI BỘ TOKOSI — GIAI ĐOẠN 1**

|                         |                                                                               |
|-------------------------|-------------------------------------------------------------------------------|
| **Tên tài liệu**        | Sơ đồ quy trình nghiệp vụ (BPMN) — Hệ thống Dashboard nội bộ TOKOSI          |
| **Phiên bản**           | 1.2                                                                           |
| **Ngày tạo**            | 27/07/2026                                                                    |
| **Ngày cập nhật**       | 29/07/2026                                                                    |
| **Tài liệu tham chiếu** | BRD v1.2 và SRS v1.2 — Hệ thống Dashboard nội bộ TOKOSI                      |
| **Phạm vi**             | Toàn bộ luồng nghiệp vụ Giai đoạn 1 (đã triển khai)                          |
| **Trạng thái**          | Cập nhật theo code thực tế — đang vận hành                                    |

> **Ghi chú phiên bản 1.2:** Bổ sung các nhánh vận hành mới đã triển khai: backend liệt kê và lọc tab trước `batchGet`, tiếp tục xử lý khi thiếu tab; frontend tự tải mỗi 10 phút và tải bù khi tab hiển thị trở lại; toàn bộ mốc ngày giờ dashboard dùng Asia/Ho_Chi_Minh; `/api/debug` trả thêm danh sách tab thực tế.

# 1. Giới thiệu

## 1.1. Mục đích tài liệu

Tài liệu này trình bày mô hình hóa quy trình nghiệp vụ (BPMN — Business Process Model and Notation) cho toàn bộ luồng vận hành của Hệ thống Dashboard nội bộ TOKOSI, cụ thể hóa các yêu cầu đã nêu trong BRD v1.2 và SRS v1.2 thành sơ đồ trực quan theo vai trò (swimlane).

## 1.2. Phạm vi mô hình hóa

Tài liệu mô hình hóa toàn bộ luồng end-to-end của Giai đoạn 1, được chia thành 3 luồng liên kết với nhau:

- **Luồng A — Đồng bộ KiotViet → Google Sheets (Apps Script):** chạy liên tục và tự động, độc lập với web dashboard.

- **Luồng B — Sử dụng Dashboard:** người dùng truy cập URL, xem KPI/biểu đồ, lọc thời gian; dữ liệu được làm mới thủ công, định kỳ 10 phút và khi quay lại tab trình duyệt.

- **Luồng C — Thiết lập hệ thống (một lần):** IT Admin cấu hình biến môi trường, Apps Script, triển khai Render.

Các nhánh xử lý lỗi quan trọng (API 500, biến môi trường thiếu, webhook lỗi) được thể hiện đầy đủ.

# 2. Vai trò tham gia quy trình (Swimlane)

Sơ đồ sử dụng 1 bể (Pool) "Hệ thống Dashboard TOKOSI" với 5 làn (Lane):

| **Vai trò (Lane)**         | **Mô tả trách nhiệm**                                                                                                           |
|----------------------------|---------------------------------------------------------------------------------------------------------------------------------|
| KiotViet POS               | Phần mềm quản lý bán hàng: phát sinh thay đổi dữ liệu, gửi webhook POST JSON đến Apps Script Web App URL.                       |
| Apps Script                | Các module trong `src/` chạy trong Google Workspace: nhận webhook từ KiotViet, chạy lịch polling 5 phút, đồng bộ vào Google Sheets. |
| Google Sheets              | Spreadsheet nguồn chứa 9 tab đồng bộ; cả 9 tab là đầu vào trực tiếp của dashboard.                                             |
| Backend (Node.js/Express)  | Server trên Render.com: liệt kê tab, lọc tab hiện có, gọi `batchGet`, tính KPI theo giờ Việt Nam và trả JSON.                  |
| Người dùng / Frontend      | Truy cập `tokosi.onrender.com`: xem Dashboard, lọc thời gian, làm mới thủ công/tự động và nhận tải bù khi quay lại tab.         |

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
     - spreadsheets.get(fields=sheets.properties.title) để liệt kê tab
     - lọc 9 tab dữ liệu kỳ vọng theo danh sách tab thực tế
     - values.batchGet cho các tab đang tồn tại
         |
[B3] ◇ Cổng quyết định: Google Sheets API có trả dữ liệu thành công?
     |
     ├─ Thất bại (403/500/timeout) →
     |   [B3-No] ▭ Backend log chi tiết lỗi (message, googleStatus, stack)
     |   [B3-No] ▭ Backend trả HTTP 500 JSON: {error, detail, googleStatus, googleMessage}
     |   [B3-No] ▭ Frontend hiển thị thông báo lỗi cho người dùng ●
     |
     └─ Thành công →
         [B3a] ▭ Tab kỳ vọng bị thiếu/đổi tên được ánh xạ thành mảng rỗng;
               các tab còn lại tiếp tục xử lý, không làm lỗi toàn dashboard
                   |
         [B4] ▭ dashboardData.getDashboardData() tính toán:
              - KPI (doanh thu hôm nay, tồn kho, công nợ, đặt hàng, trả hàng, nhập hàng)
              - revenueByDay (mảng ngày trong kỳ theo Asia/Ho_Chi_Minh)
              - Top sản phẩm bán chạy, hàng đã hết, công nợ top 8
              - Dữ liệu gần nhất: 8 HĐ, 8 đặt hàng, 8 trả hàng, 8 nhập hàng
                   |
         [B5] ▭ Backend trả HTTP 200 JSON toàn bộ dữ liệu
                   |
         [B6] ▭ Frontend render:
              - KPI cards (doanh thu, tồn kho, công nợ...)
              - Biểu đồ doanh thu theo ngày (Chart.js)
              - Bảng top sản phẩm, hàng đã hết, công nợ, đơn hàng gần nhất
              - Hiển thị updatedAt theo giờ Việt Nam
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

--- Làm mới tự động ---
[B13] ● Bộ hẹn giờ đạt 10 phút
          |
[B14] ▭ Frontend gọi lại API ở chế độ nền; chỉ render lại khi dữ liệu nghiệp vụ đổi
          → quay về B2

--- Quay lại tab trình duyệt ---
[B15] ● Sự kiện visibilitychange: tab trở lại trạng thái visible
          |
[B16] ◇ Đã qua ít nhất 10 phút từ lần fetch gần nhất?
      ├─ Chưa → giữ nguyên Dashboard
      └─ Rồi → gọi lại API ở chế độ nền → quay về B2

--- Kết thúc phiên ---
[B17] ● Người dùng đóng trình duyệt
```

| **Bước** | **Vai trò**    | **Mô tả**                                                                                           | **Tham chiếu**      |
|----------|----------------|-----------------------------------------------------------------------------------------------------|---------------------|
| B0       | Người dùng     | Sự kiện bắt đầu: mở URL `tokosi.onrender.com`.                                                      | —                   |
| B1       | Frontend       | Tự động gọi API khi page load xong, mặc định days=30.                                               | FR-04.1             |
| B2       | Backend        | Liệt kê tab, lọc 9 tab dữ liệu kỳ vọng rồi `batchGet` các tab đang tồn tại.                         | FR-01.1             |
| B3       | Backend        | Kiểm tra kết quả từ Google Sheets API.                                                              | FR-01.4             |
| B3-No    | Backend        | Trả 500 kèm chi tiết lỗi; frontend hiển thị thông báo.                                              | FR-01.4, FR-05.3    |
| B3a      | Backend        | Dùng mảng rỗng cho tab thiếu/đổi tên, giữ dữ liệu của các tab còn lại.                              | FR-01.5             |
| B4       | Backend        | Tính KPI, biểu đồ và bảng từ 9 tab dữ liệu; ngày giờ theo Asia/Ho_Chi_Minh.                         | FR-02.x, FR-03.x    |
| B5       | Backend        | Trả HTTP 200 JSON.                                                                                  | API spec mục 6.1    |
| B6       | Frontend       | Render giao diện: KPI cards, biểu đồ, bảng chi tiết, timestamp giờ Việt Nam.                        | FR-07.x             |
| B7       | —              | Dashboard sẵn sàng.                                                                                 | —                   |
| B8–B9    | Người dùng     | Đổi bộ lọc thời gian → gọi lại API với days mới.                                                    | FR-04.1, FR-04.3    |
| B10–B12  | Người dùng     | Nhấn "Làm mới" → gọi lại API với days hiện tại, hiển thị loading.                                   | FR-05.1, FR-05.3    |
| B13–B14  | Frontend       | Cứ 10 phút gọi API ở chế độ nền; tránh render lại nếu payload nghiệp vụ không đổi.                  | FR-05.4             |
| B15–B16  | Frontend       | Khi tab `visible`, tải bù nếu đã qua ít nhất một chu kỳ 10 phút từ lần fetch gần nhất.               | FR-05.5             |

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
     - sheetTabs: danh sách tab thực tế hoặc sheetTabsError
[C6] ◇ sheetsTest OK và sheetTabs đủ schema kỳ vọng?
     ├─ Không → kiểm tra quyền Service Account hoặc tên tab → quay lại C2/C5
     └─ Có →

--- Phần 2: Cấu hình Apps Script ---
[C7] ▭ Dùng clasp push các module trong `src/` lên dự án Apps Script
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
| C5–C6    | IT Admin     | Dùng `/api/debug` để xác nhận kết nối và đối chiếu danh sách tab Google Sheets thực tế.         | FR-07.5        |
| C7–C8    | IT Admin     | Triển khai Apps Script làm Web App để nhận webhook từ KiotViet.                                 | FR-06.4        |
| C9       | IT Admin     | Đồng bộ toàn bộ dữ liệu KiotViet lần đầu vào Spreadsheet.                                      | FR-06.1        |
| C10      | IT Admin     | Đăng ký 9 loại webhook KiotViet → Apps Script.                                                  | FR-06.4        |
| C11      | IT Admin     | Bật trigger polling 5 phút cho 3 bảng không có webhook.                                         | FR-06.3        |
| C12      | —            | Hệ thống sẵn sàng vận hành đầy đủ.                                                              | —              |

# 8. Truy vết yêu cầu

Mỗi bước trong 3 luồng đã được gắn mã yêu cầu chức năng/phi chức năng (FR-xx / NFR-xx) tương ứng với SRS v1.2 mục 3 và mục 4, giúp truy vết đầy đủ hai chiều giữa mô hình quy trình (BPMN) và đặc tả kỹ thuật (SRS).

| **Luồng** | **Yêu cầu SRS bao phủ**                      |
|-----------|----------------------------------------------|
| Luồng A   | FR-06.1 → FR-06.5, NFR-09                    |
| Luồng B   | FR-01.x, FR-02.x, FR-03.x, FR-04.x, FR-05.x, FR-07.x, NFR-01, NFR-03, NFR-10 |
| Luồng C   | FR-01.3, FR-06.4, FR-07.5, NFR-02, NFR-03    |

# 9. Ghi chú & khuyến nghị

- **Điểm mấu chốt:** Backend web (Luồng B) và Apps Script (Luồng A) hoạt động hoàn toàn độc lập — backend không nhận push từ Apps Script, chỉ pull từ Sheets khi có request. Đây là thiết kế đơn giản và phù hợp với quy mô hiện tại.

- **Khả năng suy giảm có kiểm soát:** Một tab nguồn bị thiếu/đổi tên chỉ làm rỗng section tương ứng; IT Admin dùng `sheetTabs` từ `/api/debug` để xác định sai lệch schema. Lỗi xác thực, quyền truy cập hoặc Google API vẫn đi theo nhánh B3-No.

- **Nhất quán thời gian:** Backend xử lý ngày và `updatedAt` theo Asia/Ho_Chi_Minh. Frontend tự tải mỗi 10 phút và tải bù khi tab được xem lại để tránh timestamp bị cũ do browser throttling.

- **Điểm yếu cần lưu ý:** Nếu KiotViet webhook bị gỡ và polling trigger cũng bị xóa → dữ liệu trong Sheets sẽ ngừng cập nhật tự động. Cần theo dõi định kỳ và dùng `syncAllInitialData()` để full refresh khi cần.

- **Nâng cấp tương lai (Giai đoạn 2+):** Khi thêm phân quyền, chỉ cần bổ sung middleware auth vào Express routes — không ảnh hưởng đến Luồng A và logic tính KPI. Khi thêm cache (Redis), thêm layer trước bước B2 — không thay đổi luồng tổng thể.

- Nếu đội phát triển cần chỉnh sửa sơ đồ bằng công cụ BPMN chuẩn (Camunda Modeler, bpmn.io, draw.io), các sơ đồ này có thể chuyển đổi sang định dạng .bpmn (XML chuẩn BPMN 2.0).

*— Hết tài liệu BPMN v1.2 —*
