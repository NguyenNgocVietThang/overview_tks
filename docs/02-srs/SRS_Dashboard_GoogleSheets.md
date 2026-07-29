# TÀI LIỆU ĐẶC TẢ YÊU CẦU PHẦN MỀM

*(Software Requirements Specification – SRS)*

**HỆ THỐNG DASHBOARD NỘI BỘ — TOKOSI**

| **Thông tin**      | **Nội dung**                                               |
|--------------------|------------------------------------------------------------|
| Tên dự án          | Hệ thống Dashboard nội bộ TOKOSI                          |
| Phiên bản          | 1.2                                                        |
| Ngày tạo           | 27/07/2026                                                 |
| Ngày cập nhật      | 29/07/2026                                                 |
| Tài liệu liên quan | BRD v1.2 — Hệ thống Dashboard nội bộ TOKOSI               |
| Trạng thái         | Đang vận hành (Giai đoạn 1 đã triển khai)                 |

> **Ghi chú phiên bản 1.2:** Đồng bộ đặc tả với các thay đổi đang vận hành: đọc an toàn khi thiếu/đổi tên tab Google Sheets, mở rộng `/api/debug` để liệt kê tab thực tế, tự làm mới frontend mỗi 10 phút và khi tab trình duyệt hiển thị trở lại, chuẩn hóa ngày giờ theo Asia/Ho_Chi_Minh, đồng thời đọc tab Nhóm hàng để gom tồn kho theo nhóm cha.

# 1. Giới thiệu

## 1.1. Mục đích

Tài liệu này đặc tả chi tiết các yêu cầu chức năng và phi chức năng của hệ thống Website Dashboard TOKOSI, làm cơ sở cho đội phát triển thiết kế, xây dựng, kiểm thử phần mềm. Tài liệu cụ thể hóa các yêu cầu nghiệp vụ đã nêu trong BRD v1.2 thành các đặc tả kỹ thuật có thể triển khai được.

## 1.2. Phạm vi hệ thống

Hệ thống là một Web Application nội bộ gồm 2 thành phần chính:

1. **Apps Script (`KiotVietExport.gs`):** chạy trong Google Workspace, đồng bộ dữ liệu từ KiotViet Public API vào 9 tab của một Google Spreadsheet (qua webhook KiotViet real-time + polling 5 phút).

2. **Web Server (Node.js/Express + HTML frontend):** đọc đủ 9 tab dữ liệu từ Google Spreadsheet qua Google Sheets API (Service Account), tính toán KPI và dữ liệu biểu đồ, trả về cho frontend qua REST API. Frontend hiển thị Dashboard tương tác trên trình duyệt.

## 1.3. Định nghĩa & thuật ngữ

| **Thuật ngữ**           | **Giải thích**                                                                        |
|-------------------------|---------------------------------------------------------------------------------------|
| Dashboard               | Trang tổng hợp hiển thị số liệu và biểu đồ từ dữ liệu nguồn.                          |
| KPI Card                | Thẻ hiển thị 1 chỉ số tổng hợp (vd: Doanh thu hôm nay, Tổng tồn kho).               |
| Spreadsheet nguồn       | Google Spreadsheet được Apps Script duy trì, chứa 9 tab KiotViet export.              |
| Service Account         | Tài khoản dịch vụ Google dùng để backend đọc Spreadsheet mà không cần OAuth user.    |
| Apps Script             | `KiotVietExport.gs` chạy trong Google Workspace, đồng bộ dữ liệu từ KiotViet.       |
| batchGet                | Gọi Google Sheets API đọc nhiều tab đang tồn tại cùng lúc trong 1 request HTTP.      |
| KiotViet webhook        | KiotViet Public API gửi POST JSON về Web App URL của Apps Script khi có thay đổi.    |
| Polling trigger         | Apps Script time-based trigger chạy mỗi 5 phút cho 3 bảng không có KiotViet webhook. |

## 1.4. Tài liệu tham khảo

- BRD v1.2 — Hệ thống Dashboard nội bộ TOKOSI.
- Google Sheets API v4 Documentation.
- KiotViet Public API Documentation.
- Google Apps Script Documentation.

# 2. Mô tả tổng quan hệ thống

## 2.1. Kiến trúc tổng quan — Giai đoạn 1 (đã triển khai)

```
KiotViet POS
    |
    | (webhook POST JSON — 9 loại event: product/invoice/order/customer/category)
    v
Apps Script (KiotVietExport.gs) — Web App URL
    |                                   |
    | upsertRow / replaceRows           | time-based trigger (5 phút)
    | (real-time cho 6 nhóm)            | (Trả hàng + NCC + Nhập hàng)
    v                                   v
Google Spreadsheet (9 tab đồng bộ và được dashboard sử dụng)
    |
    | Google Sheets API v4 — list tab → lọc tab hiện có → batchGet (Service Account)
    v
Backend: Node.js + Express
    - server/index.js           : khởi động server Express
    - server/config.js          : đọc biến môi trường
    - server/routes.js          : định nghĩa endpoints
    - server/sheets/sheetsClient.js   : gọi Google Sheets API
    - server/dashboard/dashboardData.js : tính toán KPI & biểu đồ
    |
    | REST API chính: GET /api/dashboard?days=30
    v
Frontend: HTML/CSS/JS tĩnh (server/public/index.html)
    - Chart.js (biểu đồ)
    - Vanilla JS (fetch API, DOM manipulation, auto-refresh 10 phút)
    |
    v
Người dùng (trình duyệt) — tokosi.onrender.com
```

## 2.2. Stack công nghệ thực tế

### Backend
- **Runtime:** Node.js
- **Framework:** Express.js v4
- **Dependencies:** `googleapis` (Google Sheets API client), `dotenv` (dev only)
- **Entry point:** `server/index.js`
- **API:** REST; endpoint chính `GET /api/dashboard?days={7|30|90}`, kèm `/health` và `/api/debug`

### Frontend
- **Công nghệ:** HTML5, CSS3 (Vanilla), JavaScript (ES6+)
- **Thư viện biểu đồ:** Chart.js (vendor local tại `server/public/vendor/chart.umd.min.js`)
- **File:** `server/public/index.html` (single-page, tất cả trong 1 file)
- **Không dùng:** React, Next.js, TailwindCSS, TypeScript

### Dữ liệu
- **Nguồn:** Google Spreadsheet (ID cấu hình qua env var `SPREADSHEET_ID`)
- **Xác thực:** Google Service Account JSON (env var `GOOGLE_SERVICE_ACCOUNT_JSON`)
- **Không có:** PostgreSQL, Redis, session/token management trong Giai đoạn 1

### Hạ tầng & triển khai
- **Hosting:** Render.com (Web Service)
- **Domain:** `tokosi.onrender.com`
- **CI/CD:** tự động deploy khi push lên branch `main` của GitHub repo
- **Biến môi trường:** cấu hình trực tiếp trên Render dashboard

### Apps Script
- **File:** `appsscript/KiotVietExport.gs`
- **Nơi chạy:** Google Apps Script (gắn với Google Spreadsheet)
- **Chức năng:** sync full, webhook receiver (doPost), upsert real-time, polling trigger 5 phút

## 2.3. Đối tượng người dùng (Giai đoạn 1)

| **Vai trò**  | **Mô tả**                                                              |
|--------------|------------------------------------------------------------------------|
| Người xem    | Mọi người dùng nội bộ có URL — xem KPI, lọc thời gian, làm mới dữ liệu. |
| IT Admin     | Cấu hình biến môi trường Render, quản lý Apps Script trigger/webhook.   |

## 2.4. Giả định & phụ thuộc

- Apps Script `KiotVietExport.gs` duy trì schema cố định (tên tab, thứ tự cột) cho 9 tab; backend dùng tab Nhóm hàng để ánh xạ nhóm con về nhóm cha.
- Service Account đã được share quyền Viewer trên Spreadsheet nguồn.
- KiotViet webhook đang active và trỏ đúng Web App URL của Apps Script.
- Render.com có biến môi trường `SPREADSHEET_ID` và `GOOGLE_SERVICE_ACCOUNT_JSON` đúng.
- Hệ thống phụ thuộc vào tính khả dụng của Google Sheets API (rate limit, quota).

## 2.5. Định hướng kiến trúc mở rộng dài hạn

Mục này mô tả các nguyên tắc kiến trúc cần tuân thủ khi nâng cấp lên các giai đoạn sau:

- Tách backend thành các module nghiệp vụ độc lập (dashboard, auth, sales, inventory...) khi bổ sung chức năng.
- Khi thêm phân quyền (Giai đoạn 2): bổ sung middleware auth vào Express, không cần thay đổi logic tính toán KPI.
- Khi bổ sung CSDL (Giai đoạn 3+): thêm PostgreSQL để lưu lịch sử, không phá vỡ luồng đọc Sheets hiện tại.
- API versioning (`/api/v1/...`) khi bổ sung endpoint cho module mới.
- Frontend có thể nâng cấp sang React/Next.js khi giao diện phức tạp hơn, tái sử dụng cùng REST API.

# 3. Yêu cầu chức năng (Functional Requirements)

## 3.1. FR-01: Đọc dữ liệu từ Google Sheets

| **Mã**  | **Mô tả**                                                                                                                        | **Ưu tiên** | **Trạng thái** |
|---------|----------------------------------------------------------------------------------------------------------------------------------|-------------|----------------|
| FR-01.1 | Backend gọi `spreadsheets.get` để lấy tên tab, lọc 9 tab dữ liệu kỳ vọng rồi đọc các tab đang tồn tại bằng một `batchGet`.        | Cao         | Hoàn thành     |
| FR-01.2 | Xác thực với Google bằng Service Account JSON (không yêu cầu OAuth người dùng).                                                   | Cao         | Hoàn thành     |
| FR-01.3 | `SPREADSHEET_ID` và `GOOGLE_SERVICE_ACCOUNT_JSON` đọc từ biến môi trường, không hard-code trong code.                            | Cao         | Hoàn thành     |
| FR-01.4 | Nếu gọi API thất bại (timeout, 403, 500...), hệ thống trả HTTP 500 kèm thông tin lỗi chi tiết (message, Google API status).      | Cao         | Hoàn thành     |
| FR-01.5 | Nếu một tab dữ liệu không tồn tại/đã đổi tên, tab đó được ánh xạ thành mảng rỗng; các phần dữ liệu còn lại vẫn được trả về.      | Cao         | Hoàn thành     |

## 3.2. FR-02: Tính toán KPI

| **Mã**  | **Mô tả**                                                                                                                              | **Ưu tiên** | **Trạng thái** |
|---------|----------------------------------------------------------------------------------------------------------------------------------------|-------------|----------------|
| FR-02.1 | Tính doanh thu hôm nay: tổng `Tổng tiền hàng` các hóa đơn trạng thái "Hoàn thành" có ngày bán = hôm nay theo Asia/Ho_Chi_Minh.       | Cao         | Hoàn thành     |
| FR-02.2 | Tính số hóa đơn hoàn thành hôm nay và số hóa đơn đã hủy hôm nay.                                                                     | Cao         | Hoàn thành     |
| FR-02.3 | Tính doanh thu và số hóa đơn hoàn thành trong kỳ lọc (7/30/90 ngày gần nhất), với ranh giới ngày theo Asia/Ho_Chi_Minh.              | Cao         | Hoàn thành     |
| FR-02.4 | Tính KPI hàng hóa: tổng mã hàng, tổng tồn kho, số mã có hàng (tồn > 0), số mã đang/ngừng kinh doanh, số mã đã hết hàng (tồn = 0).      | Cao         | Hoàn thành     |
| FR-02.5 | Tính KPI khách hàng: tổng khách, số khách có nợ (nợ > 0), tổng công nợ.                                                               | Cao         | Hoàn thành     |
| FR-02.6 | Tính KPI nhà cung cấp: tổng NCC, số NCC có nợ (nợ > 0), tổng nợ cần trả.                                                             | Cao         | Hoàn thành     |
| FR-02.7 | Tính KPI đặt hàng: số đơn đang chờ xử lý (trạng thái "Phiếu tạm", "Đang xử lý", "Đã xác nhận"), tổng giá trị đang chờ.              | Cao         | Hoàn thành     |
| FR-02.8 | Tính KPI trả hàng: tổng số lần trả, tổng giá trị trả.                                                                                 | Cao         | Hoàn thành     |
| FR-02.9 | Tính KPI nhập hàng: tổng số phiếu nhập, tổng giá trị nhập.                                                                            | Cao         | Hoàn thành     |

## 3.3. FR-03: Dữ liệu biểu đồ & bảng chi tiết

| **Mã**  | **Mô tả**                                                                                                                                          | **Ưu tiên** | **Trạng thái** |
|---------|----------------------------------------------------------------------------------------------------------------------------------------------------|-------------|----------------|
| FR-03.1 | Tạo mảng `revenueByDay`: mỗi phần tử là 1 ngày trong kỳ lọc với tổng doanh thu và số hóa đơn hoàn thành của ngày đó.                              | Cao         | Hoàn thành     |
| FR-03.2 | Tạo danh sách `topSellingProducts` (top 10 sản phẩm bán chạy nhất theo doanh thu từ Chi tiết hóa đơn, loại trừ hóa đơn đã hủy).                   | Cao         | Hoàn thành     |
| FR-03.3 | Tạo danh sách `lowStock`: sản phẩm có tồn kho = 0.                                                                                           | Cao         | Hoàn thành     |
| FR-03.4 | Tạo `stockByCategory`: tổng số lượng tồn kho theo nhóm cha, ánh xạ cây cha–con từ tab Nhóm hàng; dòng trống `Mã nhóm cha` là nhóm cha gốc.            | Cao         | Hoàn thành     |
| FR-03.5 | Tạo `stockValueByCategory`: tổng `Giá vốn × max(Tồn kho, 0)` theo nhóm cha; tối đa 30 phần tử (29 nhóm lớn nhất và `Khác` nếu vượt giới hạn).          | Cao         | Hoàn thành     |
| FR-03.6 | Tạo `allProducts`: toàn bộ danh sách sản phẩm kèm tỉ lệ % tồn kho.                                                                                | Trung bình  | Hoàn thành     |
| FR-03.7 | Tạo `topDebt`: top 8 khách hàng có công nợ cao nhất.                                                                                               | Cao         | Hoàn thành     |
| FR-03.8 | Tạo `recentInvoices`, `recentOrders`, `recentReturns`, `recentPurchaseOrders`: 8 bản ghi gần nhất (sort theo thời gian giảm dần).                  | Cao         | Hoàn thành     |
| FR-03.9 | Tạo `suppliers`: danh sách tất cả nhà cung cấp, sắp xếp giảm dần theo nợ.                                                                         | Trung bình  | Hoàn thành     |

## 3.4. FR-04: Bộ lọc thời gian

| **Mã**  | **Mô tả**                                                                                                     | **Ưu tiên** | **Trạng thái** |
|---------|---------------------------------------------------------------------------------------------------------------|-------------|----------------|
| FR-04.1 | Frontend chỉ gửi `days` = 7, 30 hoặc 90; backend chuyển sang số và mặc định 30 nếu tham số bị thiếu/không hợp lệ. | Cao         | Hoàn thành     |
| FR-04.2 | `revenueByDay` tạo đúng số ngày theo `days`, điền 0 cho ngày không có doanh thu.                              | Cao         | Hoàn thành     |
| FR-04.3 | Frontend cập nhật biểu đồ và KPI kỳ ngay khi người dùng đổi bộ lọc, không cần tải lại trang.                 | Cao         | Hoàn thành     |

## 3.5. FR-05: Cập nhật dữ liệu dashboard

| **Mã**  | **Mô tả**                                                                                                              | **Ưu tiên** | **Trạng thái** |
|---------|------------------------------------------------------------------------------------------------------------------------|-------------|----------------|
| FR-05.1 | Có nút "Làm mới" trên giao diện, khi nhấn sẽ gọi lại `GET /api/dashboard?days={current}`.                             | Cao         | Hoàn thành     |
| FR-05.2 | Hiển thị `updatedAt` theo Asia/Ho_Chi_Minh — thời điểm tính dữ liệu gần nhất ở định dạng `dd/MM/yyyy HH:mm:ss`.       | Trung bình  | Hoàn thành     |
| FR-05.3 | Hiển thị trạng thái loading khi đang gọi API, thông báo lỗi nếu gọi thất bại (alert + thông điệp rõ ràng cho user).  | Cao         | Hoàn thành     |
| FR-05.4 | Frontend tự gọi lại API mỗi 10 phút; nếu payload nghiệp vụ không đổi thì chỉ cập nhật timestamp, không render lại toàn bộ view. | Trung bình | Hoàn thành     |
| FR-05.5 | Khi tab trở lại trạng thái `visible` sau ít nhất 10 phút kể từ lần fetch gần nhất, frontend phải gọi API ngay để bù chu kỳ bị trình duyệt trì hoãn. | Trung bình | Hoàn thành |

## 3.6. FR-06: Apps Script — Đồng bộ KiotViet tự động

| **Mã**  | **Mô tả**                                                                                                                                                                     | **Ưu tiên** | **Trạng thái** |
|---------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------|----------------|
| FR-06.1 | `syncAll()`: đồng bộ toàn bộ dữ liệu KiotViet vào 8 sheet (xóa và ghi lại toàn bộ).                                                                                         | Cao         | Hoàn thành     |
| FR-06.2 | `doPost(e)`: nhận webhook POST từ KiotViet, xử lý đúng loại event (product/invoice/order/customer/category), cập nhật đúng dòng bằng `upsertRow_` / `replaceInvoiceDetailRows_`. | Cao         | Hoàn thành     |
| FR-06.3 | `setupPollingTrigger()`: bật trigger 5 phút để sync Trả hàng + Nhà cung cấp + Nhập hàng (KiotViet không có webhook cho 3 loại này).                                           | Cao         | Hoàn thành     |
| FR-06.4 | `setupRealtimeWebhook()`: đăng ký 9 loại event webhook với KiotViet API, xóa webhook cũ trước khi đăng ký mới.                                                               | Cao         | Hoàn thành     |
| FR-06.5 | Retry tự động tối đa 5 lần (exponential backoff) khi gọi KiotViet API bị lỗi tạm thời (429/5xx/network error).                                                               | Cao         | Hoàn thành     |

## 3.7. FR-07: Giao diện người dùng

| **Mã**  | **Mô tả**                                                                                                                | **Ưu tiên** | **Trạng thái** |
|---------|--------------------------------------------------------------------------------------------------------------------------|-------------|----------------|
| FR-07.1 | Sidebar điều hướng với các mục tương ứng từng section của dashboard.                                                    | Cao         | Hoàn thành     |
| FR-07.2 | Khu vực KPI cards: hiển thị các chỉ số tổng quan với icon và màu sắc phân biệt.                                         | Cao         | Hoàn thành     |
| FR-07.3 | Biểu đồ doanh thu theo ngày (line/bar chart) với bộ lọc 7/30/90 ngày.                                                   | Cao         | Hoàn thành     |
| FR-07.4 | Bảng top sản phẩm bán chạy, hàng đã hết, công nợ khách hàng, NCC, đặt hàng, trả hàng, nhập hàng gần nhất.              | Cao         | Hoàn thành     |
| FR-07.7 | Biểu đồ cột giá trị và biểu đồ tròn số lượng tồn kho đều gom theo nhóm cha; biểu đồ cột hiển thị tối đa 30 cột và tooltip có giá trị tiền, tỷ trọng. | Cao | Hoàn thành |
| FR-07.5 | Route `/api/debug`: kiểm tra biến môi trường, kết nối Google Sheets và liệt kê `sheetTabs`; trả riêng `sheetTabsError` nếu bước liệt kê lỗi. | Thấp | Hoàn thành |
| FR-07.6 | Route `/health`: trả HTTP 200 `{"status":"ok"}` để Render health check.                                                  | Cao         | Hoàn thành     |

# 4. Yêu cầu phi chức năng (Non-functional Requirements)

| **Mã** | **Hạng mục**         | **Mô tả yêu cầu**                                                                                                                               |
|--------|----------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| NFR-01 | Hiệu năng            | API `/api/dashboard` trả kết quả trong vòng 5 giây trong điều kiện bình thường (1 request metadata + 1 `batchGet`).                            |
| NFR-02 | Khả dụng             | Hệ thống hoạt động ổn định trên Render.com, mục tiêu uptime >= 99% trong giờ hành chính.                                                        |
| NFR-03 | Bảo mật              | Toàn bộ giao tiếp qua HTTPS; Service Account key và Spreadsheet ID lưu trong biến môi trường, không commit vào repo.                             |
| NFR-04 | Khả năng mở rộng     | Kiến trúc module rõ ràng (config, sheets, dashboard, routes) cho phép bổ sung module mới mà không phải rewrite code hiện tại.                    |
| NFR-05 | Usability            | Giao diện trực quan, thao tác lọc thời gian và làm mới trong 1–2 cú nhấp chuột; hỗ trợ desktop và tablet.                                       |
| NFR-06 | Bảo trì              | Mã nguồn tổ chức theo module rõ ràng, comment tiếng Việt, dễ đọc và bảo trì.                                                                   |
| NFR-07 | Giới hạn API         | Sau khi lấy metadata tab, dùng một `batchGet` duy nhất để đọc toàn bộ tab dữ liệu đang tồn tại; chu kỳ làm mới tự động là 10 phút.               |
| NFR-08 | Nhật ký & debug      | Log chi tiết lỗi khi `/api/dashboard` thất bại; `/api/debug` kiểm tra kết nối và trả danh sách tab hiện có mà không lộ secret.                   |
| NFR-09 | Độ trễ đồng bộ       | Từ khi dữ liệu thay đổi trên KiotViet → Apps Script cập nhật Sheets (qua webhook): mục tiêu < 10 giây. Trả hàng/NCC/Nhập hàng: tối đa 5 phút (polling). |
| NFR-10 | Nhất quán thời gian  | Parse ngày từ Sheets, xác định ngày hiện tại, tạo bucket 7/30/90 ngày và format `updatedAt` theo Asia/Ho_Chi_Minh, độc lập timezone máy chủ.      |

# 5. Yêu cầu giao diện người dùng (UI Requirements)

## 5.1. Bố cục tổng thể

Giao diện Dashboard gồm:
- **Sidebar (trái):** logo, danh sách mục điều hướng, có thể thu gọn.
- **Header (trên):** tên trang, timestamp cập nhật theo giờ Việt Nam, bộ lọc thời gian (7/30/90 ngày), nút "Làm mới".
- **Khu vực KPI cards:** dãy thẻ số liệu tổng quan.
- **Khu vực biểu đồ & bảng:** biểu đồ doanh thu theo ngày, bảng top sản phẩm, hàng đã hết, công nợ, đơn hàng gần nhất.

## 5.2. Trạng thái giao diện cần xử lý

- **Loading:** hiển thị spinner/text "Đang tải dữ liệu..." khi đang gọi API lần đầu.
- **Đang làm mới:** hiển thị trạng thái loading cục bộ khi nhấn "Làm mới".
- **Làm mới nền:** tự tải mỗi 10 phút và khi quay lại tab đã ẩn quá một chu kỳ; không che giao diện bằng loading veil.
- **Lỗi API:** hiển thị thông báo lỗi rõ ràng (alert hoặc toast), kèm nội dung lỗi từ server.
- **Dữ liệu trống:** hiển thị trạng thái empty state nếu tab không có dữ liệu hoặc không tồn tại; các section khác vẫn hoạt động.

# 6. Đặc tả API

## 6.1. GET /api/dashboard

**Mô tả:** Liệt kê tab thực tế, đọc tối đa 9 tab dữ liệu dashboard đang tồn tại từ Google Spreadsheet, rồi tính toán toàn bộ KPI và dữ liệu biểu đồ. Tab bị thiếu được xử lý như dữ liệu rỗng.

**Query params:**
- `days` (optional, number): frontend sử dụng 7, 30 hoặc 90; backend mặc định 30 nếu giá trị bị thiếu hoặc không chuyển được thành số.

**Response (HTTP 200):**
```json
{
  "updatedAt": "29/07/2026 15:30:00",
  "days": 30,
  "kpi": {
    "revenueToday": 0,
    "invoicesToday": 0,
    "cancelledToday": 0,
    "totalProducts": 0,
    "totalStock": 0,
    "inStockCodes": 0,
    "activeProducts": 0,
    "inactiveProducts": 0,
    "lowStockCount": 0,
    "totalInventoryValue": 0,
    "inventoryValueCategoryCount": 0,
    "totalCustomers": 0,
    "customersWithDebt": 0,
    "totalDebt": 0,
    "periodRevenue": 0,
    "periodInvoices": 0,
    "pendingOrdersCount": 0,
    "pendingOrdersTotal": 0,
    "returnsCount": 0,
    "totalReturns": 0,
    "totalSuppliers": 0,
    "suppliersWithDebt": 0,
    "totalSupplierDebt": 0,
    "purchaseOrdersCount": 0,
    "totalPurchaseSpend": 0
  },
  "revenueByDay": [{ "date": "dd/MM/yyyy", "label": "dd/MM", "revenue": 0, "count": 0 }],
  "recentInvoices": [{ "code": "", "customer": "", "total": 0, "status": "", "time": "" }],
  "lowStock": [{ "code": "", "name": "", "stock": 0, "reserved": 0, "status": "" }],
  "stockValueByCategory": [{ "name": "", "stockValue": 0, "stock": 0, "productCount": 0 }],
  "allProducts": [{ "code": "", "name": "", "stock": 0, "reserved": 0, "status": "", "pct": 0 }],
  "topDebt": [{ "code": "", "name": "", "phone": "", "debt": 0 }],
  "stockByCategory": [{ "name": "", "stock": 0, "productCount": 0 }],
  "topSellingProducts": [{ "code": "", "name": "", "qty": 0, "revenue": 0 }],
  "recentOrders": [{ "code": "", "date": "", "customer": "", "total": 0, "status": "" }],
  "recentReturns": [{ "code": "", "date": "", "originalInvoiceCode": "", "customer": "", "total": 0, "status": "" }],
  "suppliers": [{ "code": "", "name": "", "phone": "", "email": "", "address": "", "debt": 0 }],
  "recentPurchaseOrders": [{ "code": "", "date": "", "supplier": "", "branch": "", "total": 0, "status": "" }]
}
```

**Response (HTTP 500):**
```json
{
  "error": "Khong lay duoc du lieu dashboard.",
  "detail": "error message",
  "googleStatus": 403,
  "googleMessage": "..."
}
```

## 6.2. GET /health

**Mô tả:** Health check cho Render.com.

**Response (HTTP 200):** `{"status": "ok"}`

## 6.3. GET /api/debug

**Mô tả:** Kiểm tra nhanh trạng thái biến môi trường, kết nối Google Sheets và danh sách tab thực tế. Dùng để debug, không bảo mật.

**Response (HTTP 200):**
```json
{
  "SPREADSHEET_ID": true,
  "GOOGLE_SERVICE_ACCOUNT_JSON": true,
  "spreadsheetId": "1DHsALn...",
  "sheetsTest": "OK — 1500 rows tu sheet \"Hóa đơn\"",
  "sheetsError": null,
  "sheetTabs": ["Nhóm hàng", "Hàng hóa", "Hóa đơn", "Chi tiết hóa đơn", "Đặt hàng", "Trả hàng", "Khách hàng", "Nhà cung cấp", "Nhập hàng"],
  "sheetTabsError": null
}
```

# 7. Đặc tả Apps Script (KiotVietExport.gs)

## 7.1. Schema 9 tab đồng bộ và dashboard sử dụng

### Sheet "Nhóm hàng" (col index 0–2)
`[0]Mã nhóm hàng [1]Tên nhóm hàng [2]Mã nhóm cha`

### Sheet "Hàng hóa" (col index 0–11)
`[0]Mã hàng [1]Tên hàng [2]Nhóm hàng [3]Thương hiệu [4]Loại [5]Giá vốn [6]Giá bán [7]Tồn kho [8]Khách đặt [9]Trạng thái kinh doanh [10]Ngày sửa cuối [11]Mã nhóm hàng`

### Sheet "Hóa đơn" (col index 0–9)
`[0]Mã hóa đơn [1]Ngày bán [2]Khách hàng [3]SĐT khách [4]Nhân viên bán [5]Chi nhánh [6]Tổng tiền hàng [7]Giảm giá [8]Khách đã trả [9]Trạng thái`

**Trạng thái:** "Hoàn thành" | "Đã hủy" | "Đang xử lý"

### Sheet "Chi tiết hóa đơn" (col index 0–6)
`[0]Mã hóa đơn [1]Mã hàng [2]Tên hàng [3]Số lượng [4]Đơn giá [5]Giảm giá [6]Thành tiền`

### Sheet "Đặt hàng" (col index 0–6)
`[0]Mã đặt hàng [1]Ngày đặt [2]Khách hàng [3]Nhân viên lập [4]Chi nhánh [5]Tổng tiền [6]Trạng thái`

**Trạng thái:** "Phiếu tạm" | "Đang xử lý" | "Đã xác nhận" | "Đã hủy" | "Hoàn thành"

### Sheet "Trả hàng" (col index 0–5)
`[0]Mã trả hàng [1]Ngày trả [2]Mã hóa đơn gốc [3]Khách hàng [4]Tổng tiền trả [5]Trạng thái`

### Sheet "Khách hàng" (col index 0–8)
`[0]Mã khách hàng [1]Tên khách hàng [2]Điện thoại [3]Giới tính [4]Nhóm khách hàng [5]Địa chỉ [6]Email [7]Nợ hiện tại [8]Tổng bán`

### Sheet "Nhà cung cấp" (col index 0–5)
`[0]Mã NCC [1]Tên NCC [2]Điện thoại [3]Email [4]Địa chỉ [5]Nợ cần trả`

### Sheet "Nhập hàng" (col index 0–5)
`[0]Mã nhập hàng [1]Ngày nhập [2]Nhà cung cấp [3]Chi nhánh [4]Tổng tiền [5]Trạng thái`

## 7.2. Webhook KiotViet — 9 loại event

`product.update`, `product.delete`, `stock.update`, `customer.update`, `customer.delete`, `invoice.update`, `order.update`, `category.update`, `category.delete`

**Lưu ý quan trọng:** KiotViet KHÔNG có webhook cho Trả hàng (`return.*`), Nhà cung cấp (`supplier.*`), Nhập hàng (`purchaseorder.*`) → phải dùng polling 5 phút.

## 7.3. Format ngày tháng

Tất cả giá trị ngày trong sheet được lưu dạng chuỗi: `dd/MM/yyyy HH:mm:ss` (vd: `28/07/2026 14:30:00`), do Apps Script dùng `Utilities.formatDate(..., 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy HH:mm:ss')`.

Backend parse ngày bằng hàm `parseSheetDate()` hỗ trợ: số serial Excel, chuỗi `dd/MM/yyyy [HH:mm:ss]`, chuỗi ISO không offset (được hiểu là giờ Việt Nam) và ISO 8601 có offset. Giá trị không hợp lệ trả về `null` thay vì làm lỗi toàn bộ dashboard.

Các phép tính "hôm nay", bucket ngày 7/30/90 ngày và `updatedAt` đều dùng `Asia/Ho_Chi_Minh` (`UTC+07:00`), không dùng timezone mặc định của máy chủ Render.

# 8. Ma trận truy vết yêu cầu (Traceability Matrix)

| **Yêu cầu BRD**                          | **Yêu cầu SRS liên quan**           |
|------------------------------------------|-------------------------------------|
| Kết nối Sheets — Service Account (5.1)   | FR-01.1 → FR-01.5                   |
| KPI tổng quan (5.2)                      | FR-02.1 → FR-02.9                   |
| Biểu đồ & bảng chi tiết (5.3)           | FR-03.1 → FR-03.9                   |
| Bộ lọc 7/30/90 ngày (5.4)               | FR-04.1, FR-04.2, FR-04.3           |
| Cập nhật dashboard (5.5)                 | FR-05.1 → FR-05.5                   |
| Đồng bộ tự động — Apps Script (5.5)     | FR-06.1 → FR-06.5                   |
| Giao diện Dashboard (5.3, 5.4, 5.5)     | FR-07.1 → FR-07.6                   |

# 9. Rủi ro kỹ thuật & phương án giảm thiểu

| **Rủi ro**                                                                           | **Phương án giảm thiểu**                                                                                            |
|--------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| Google Sheets API trả 500 khiến dashboard không load được                            | Log chi tiết lỗi (googleStatus, message) + route `/api/debug` để chẩn đoán nhanh. Hiển thị lỗi rõ ràng cho user. |
| Service Account bị xóa hoặc mất quyền trên Spreadsheet                              | Biến môi trường `GOOGLE_SERVICE_ACCOUNT_JSON` trên Render; cần re-share Spreadsheet khi thay SA.                   |
| KiotViet webhook bị gỡ/hết hạn → Sheets không được cập nhật real-time               | Polling 5 phút là fallback cho 3 bảng; sync full thủ công `syncAll()` để recover.                                  |
| Apps Script timeout khi đồng bộ lượng lớn dữ liệu (quota 6 phút/execution)          | Hàm `kvFetchAllPages_` chia nhỏ theo trang (pageSize=100); retry có delay tránh rate-limit.                         |
| Tên sheet hoặc thứ tự cột thay đổi trong Apps Script → backend đọc sai dữ liệu      | Schema cố định, comment rõ ràng trong cả 2 file; cần sync thay đổi schema giữa Apps Script và dashboardData.js.    |
| Một tab bị thiếu/đổi tên làm `batchGet` lỗi toàn bộ                                 | Liệt kê tab trước khi đọc, chỉ `batchGet` tab hiện có; trả mảng rỗng cho tab thiếu và kiểm tra bằng `/api/debug`.   |
| Múi giờ máy chủ Render khác Việt Nam làm lệch KPI "hôm nay"                        | Parse, tạo bucket ngày và format kết quả bằng `Asia/Ho_Chi_Minh`/UTC+07:00.                                         |
| Trình duyệt trì hoãn timer khi tab chạy nền làm timestamp cũ                        | Lưu thời điểm fetch cuối và gọi lại API khi tab `visible` nếu đã qua chu kỳ 10 phút.                               |
| Render.com free tier hibernation → cold start làm chậm request đầu tiên             | Health check endpoint `/health` được Render ping định kỳ để giữ instance ấm.                                       |

*— Hết tài liệu SRS v1.2 —*
