# TÀI LIỆU ĐẶC TẢ YÊU CẦU PHẦN MỀM

*(Software Requirements Specification – SRS)*

**HỆ THỐNG DASHBOARD TỰ ĐỘNG TỪ GOOGLE SHEETS**

| **Thông tin**      | **Nội dung**                               |
|--------------------|--------------------------------------------|
| Tên dự án          | Hệ thống Dashboard nội bộ từ Google Sheets |
| Phiên bản          | 1.0                                        |
| Ngày tạo           | 27/07/2026                                 |
| Tài liệu liên quan | BRD – Business Requirements Document v1.0  |
| Trạng thái         | Bản thảo – chờ phê duyệt                   |

# 1. Giới thiệu

## 1.1. Mục đích

Tài liệu này đặc tả chi tiết các yêu cầu chức năng và phi chức năng của hệ thống Website Dashboard, làm cơ sở cho đội phát triển thiết kế, xây dựng, kiểm thử phần mềm. Tài liệu cụ thể hóa các yêu cầu nghiệp vụ đã nêu trong BRD v1.0 thành các đặc tả kỹ thuật có thể triển khai được.

## 1.2. Phạm vi hệ thống

Hệ thống là một Web Application nội bộ, cho phép Quản trị viên kết nối 1 Google Sheets nguồn; hệ thống tự động phân tích cấu trúc dữ liệu và hiển thị Dashboard gồm 3 khu vực: Sidebar điều hướng, Tổng số liệu (KPI), và Biểu đồ trực quan, có hỗ trợ lọc theo 4 khung thời gian, cập nhật dữ liệu thủ công, phân quyền 2 vai trò, và xuất báo cáo PDF/Excel.

## 1.3. Định nghĩa & thuật ngữ

| **Thuật ngữ**      | **Giải thích**                                                      |
|--------------------|---------------------------------------------------------------------|
| Dashboard          | Trang tổng hợp hiển thị số liệu và biểu đồ từ dữ liệu nguồn.        |
| KPI Card           | Thẻ hiển thị 1 chỉ số tổng hợp (vd: Tổng doanh thu, Tổng đơn hàng). |
| Sheet nguồn        | Google Sheets được kết nối làm nguồn dữ liệu cho Dashboard.         |
| Admin              | Vai trò Quản trị viên, có quyền cấu hình hệ thống.                  |
| Nhân viên (Viewer) | Vai trò chỉ xem, không có quyền cấu hình.                           |
| Auto-chart engine  | Cơ chế phân tích dữ liệu và tự động gợi ý loại biểu đồ phù hợp.     |
| OAuth              | Giao thức đăng nhập/ủy quyền của Google để đọc Sheet riêng tư.      |

## 1.4. Tài liệu tham khảo

- BRD – Business Requirements Document, phiên bản 1.0.

- Google Sheets API v4 Documentation.

- Google Identity Services (OAuth 2.0) Documentation.

# 2. Mô tả tổng quan hệ thống

## 2.1. Bối cảnh sản phẩm

Hệ thống hoạt động như một lớp trực quan hóa (visualization layer) độc lập, đọc dữ liệu chỉ-đọc (read-only) từ 1 Google Sheets nguồn thông qua Google Sheets API, xử lý và hiển thị dưới dạng Dashboard tương tác trên trình duyệt web.

## 2.2. Kiến trúc tổng quan đề xuất — Giai đoạn 1, thiết kế sẵn cho mở rộng

Hệ thống Giai đoạn 1 được xây dựng theo mô hình “Modular Monolith” (khối ứng dụng thống nhất nhưng chia theo mô-đun nghiệp vụ rõ ràng): dễ triển khai, vận hành và kiểm soát chi phí ở quy mô ~150 người dùng hiện tại, đồng thời các ranh giới mô-đun được thiết kế theo hướng miền nghiệp vụ (domain-driven) để có thể tách thành dịch vụ độc lập (microservice) trong tương lai mà không phải viết lại từ đầu.

### Frontend

- Next.js 15 (App Router) + React 19 + TypeScript — hiệu năng cao nhờ Server Components, render lai (SSR/CSR), phù hợp dashboard nhiều dữ liệu.

- TailwindCSS + shadcn/ui — hệ thống thiết kế hiện đại, tuỳ biến nhanh, đúng định hướng giao diện “sinh động, nhiều màu sắc kiểu SaaS dashboard”.

- Recharts hoặc Tremor (thư viện biểu đồ chuyên cho dashboard) cho khu vực Biểu đồ; Framer Motion cho hiệu ứng chuyển động mượt mà.

- TanStack Query (React Query) để quản lý gọi API, cache dữ liệu phía client, đồng bộ mượt với dữ liệu realtime từ webhook.

### Backend

- NestJS (Node.js + TypeScript) — framework backend theo kiến trúc module hoá sẵn có (mỗi domain nghiệp vụ là 1 Nest Module độc lập: Dashboard, Sheets-Connector, Auth, Export, v.v.), rất phù hợp để sau này thêm các module Sales/Inventory/Analytics/AI mà không phá vỡ cấu trúc hiện tại.

- REST API theo chuẩn OpenAPI (Swagger) cho giao tiếp Frontend–Backend; có thể bổ sung GraphQL ở giai đoạn sau nếu cần truy vấn linh hoạt hơn cho các module phân tích.

- Endpoint Webhook nhận sự kiện từ Google Apps Script trigger gắn trên Sheet nguồn; kênh WebSocket (Socket.io) để đẩy cập nhật realtime tới client.

### Dữ liệu

- PostgreSQL làm cơ sở dữ liệu chính — phù hợp dữ liệu quan hệ phức tạp (đơn hàng, tồn kho, phòng ban) sẽ phát sinh ở các giai đoạn sau; ngay từ Giai đoạn 1, schema được tổ chức theo namespace/schema riêng cho từng domain (vd: schema "dashboard", để dành schema "sales", "inventory", "hr", "analytics" cho tương lai) trong cùng 1 cụm CSDL.

- Prisma ORM — type-safe, migration rõ ràng, thuận tiện mở rộng model dữ liệu qua từng giai đoạn.

- Redis — cache dữ liệu Sheet đã xử lý (giảm số lần gọi Google Sheets API), quản lý session, và làm message broker nội bộ cho các sự kiện giữa module (chuẩn bị cho kiến trúc hướng sự kiện ở giai đoạn sau).

### Hạ tầng & triển khai

- Đóng gói bằng Docker; triển khai trên cloud (VD: GCP/AWS/DigitalOcean) hoặc VPS nội bộ có khả năng scale theo chiều ngang (horizontal scaling) khi số lượng người dùng/module tăng.

- CI/CD tự động (vd: GitHub Actions) để triển khai an toàn khi bổ sung module mới ở các giai đoạn sau.

- HTTPS bắt buộc cho toàn bộ giao tiếp.

### Dịch vụ bên ngoài & tích hợp

- Google Sheets API v4 (đọc dữ liệu nguồn), Google OAuth 2.0 (xác thực khi dùng Sheet riêng tư).

- Chuẩn bị sẵn lớp tích hợp LLM API (vd: Anthropic Claude API) cho module Trợ lý AI ở Giai đoạn 6 — xem chi tiết mục 8.

## 2.3. Đối tượng người dùng

| **Vai trò**        | **Mô tả**                                                                        |
|--------------------|----------------------------------------------------------------------------------|
| Admin              | Quản trị viên hệ thống, cấu hình kết nối Sheet, quản lý dashboard và người dùng. |
| Nhân viên (Viewer) | Người dùng nội bộ, chỉ xem và xuất báo cáo.                                      |

## 2.4. Giả định & phụ thuộc

- Google Sheets nguồn tồn tại và có ít nhất 1 cột dữ liệu dạng ngày tháng để phục vụ lọc thời gian.

- Hệ thống phụ thuộc vào tính khả dụng và giới hạn quota (rate limit) của Google Sheets API.

- Khoảng 150 người dùng nội bộ truy cập, không yêu cầu multi-tenant.

- Công ty vận hành mô hình nhiều kho/chi nhánh, ~5.000–20.000 SKU, ~500–5.000 giao dịch/ngày — các thông số này định hình yêu cầu hiệu năng & thiết kế dữ liệu cho các giai đoạn mở rộng.

## 2.5. Định hướng kiến trúc mở rộng dài hạn (không thuộc phạm vi triển khai Giai đoạn 1)

Mục này mô tả các nguyên tắc kiến trúc mà đội phát triển cần tuân thủ ngay từ Giai đoạn 1, để các giai đoạn sau (mô tả trong BRD mục 3.3 và 9.2) có thể được bổ sung với chi phí tái cấu trúc thấp nhất.

### Ranh giới mô-đun theo miền nghiệp vụ (Domain Modules)

| **Mô-đun (Domain)**           | **Phạm vi**                                               | **Giai đoạn**            |
|-------------------------------|-----------------------------------------------------------|--------------------------|
| Dashboard & Reporting         | Đọc Google Sheets, KPI, biểu đồ, xuất báo cáo             | Giai đoạn 1 (hiện tại)   |
| Auth & Access Control         | Đăng nhập, phân quyền theo vai trò/phòng ban              | Giai đoạn 1, mở rộng dần |
| Sales / POS                   | Đơn bán, khách hàng, công nợ, hoá đơn                     | Giai đoạn 2              |
| Inventory / Warehouse         | Nhập/xuất/chuyển kho, tồn kho đa chi nhánh, kiểm kê       | Giai đoạn 3              |
| Analytics & Anomaly Detection | Phân tích doanh số, dự đoán nhu cầu, phát hiện bất thường | Giai đoạn 4              |
| Directory / HR-lite           | Danh bạ phòng ban, sơ đồ tổ chức                          | Giai đoạn 5              |
| AI Assistant                  | Chatbot hỏi-đáp số liệu, gợi ý tự động                    | Giai đoạn 6              |

### Nguyên tắc thiết kế để đảm bảo khả năng mở rộng

- Mỗi domain là 1 Nest Module riêng biệt với ranh giới rõ ràng (own controllers/services/schema), giao tiếp với nhau qua interface/event nội bộ thay vì gọi chéo trực tiếp vào chi tiết triển khai của module khác.

- Cơ sở dữ liệu dùng chung 1 cụm PostgreSQL nhưng tách theo schema riêng cho từng domain, giúp mỗi module có thể được tách thành service/CSDL độc lập sau này mà ít ảnh hưởng các module khác.

- Các bảng dữ liệu lõi dự kiến dùng chung nhiều module (vd: Sản phẩm/SKU, Kho, Người dùng, Phòng ban) được thiết kế làm “bảng dùng chung” (shared reference data) ngay từ đầu, tránh trùng lặp định nghĩa khi các module Sales/Inventory được xây sau.

- API versioning (vd: /api/v1/...) áp dụng ngay từ Giai đoạn 1 để không phá vỡ tương thích khi bổ sung endpoint cho module mới.

- Redis message broker nội bộ được thiết lập từ Giai đoạn 1 (dùng cho cache/webhook) để có thể mở rộng thành cơ chế giao tiếp hướng sự kiện (event-driven) giữa các module ở giai đoạn sau, ví dụ: module Sales phát sự kiện “đơn hàng mới” để module Analytics xử lý mà không gọi trực tiếp lẫn nhau.

- Thiết kế hệ thống phân quyền (RBAC) từ Giai đoạn 1 theo mô hình vai trò + phạm vi (role + scope), sẵn sàng mở rộng thành phân quyền theo phòng ban khi module Directory (Giai đoạn 5) được bổ sung.

# 3. Yêu cầu chức năng (Functional Requirements)

## 3.1. FR-01: Xác thực & phân quyền

| **Mã**  | **Mô tả**                                                                             | **Ưu tiên** |
|---------|---------------------------------------------------------------------------------------|-------------|
| FR-01.1 | Hệ thống cho phép đăng nhập bằng tài khoản nội bộ (email/mật khẩu) hoặc Google OAuth. | Cao         |
| FR-01.2 | Hệ thống phân biệt 2 vai trò: Admin và Nhân viên, giới hạn chức năng theo vai trò.    | Cao         |
| FR-01.3 | Admin có thể tạo, khóa, phân quyền tài khoản người dùng khác.                         | Trung bình  |

## 3.2. FR-02: Kết nối Google Sheets nguồn

| **Mã**  | **Mô tả**                                                                                                                                                           | **Ưu tiên** |
|---------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------|
| FR-02.1 | Admin nhập link Google Sheets nguồn vào màn hình Cài đặt kết nối.                                                                                                   | Cao         |
| FR-02.2 | Hệ thống hỗ trợ 2 phương thức truy cập: (a) OAuth để đọc Sheet riêng tư của người dùng đăng nhập, (b) đọc trực tiếp Sheet đã publish/chia sẻ công khai qua API key. | Cao         |
| FR-02.3 | Hệ thống kiểm tra và báo lỗi rõ ràng nếu link không hợp lệ hoặc không có quyền truy cập.                                                                            | Cao         |
| FR-02.4 | Hệ thống cho phép chọn tab/sheet cụ thể trong file Google Sheets nếu có nhiều tab.                                                                                  | Trung bình  |

## 3.3. FR-03: Engine tự nhận diện & phân tích dữ liệu

| **Mã**  | **Mô tả**                                                                                                              | **Ưu tiên** |
|---------|------------------------------------------------------------------------------------------------------------------------|-------------|
| FR-03.1 | Hệ thống đọc dòng tiêu đề (header) và dữ liệu mẫu để suy luận kiểu dữ liệu từng cột: số, ngày tháng, văn bản/danh mục. | Cao         |
| FR-03.2 | Hệ thống xác định (các) cột dạng ngày tháng để làm trục thời gian phục vụ bộ lọc 1/7/30/90 ngày.                       | Cao         |
| FR-03.3 | Hệ thống xác định các cột số để tính toán KPI (tổng, trung bình, đếm) và vẽ biểu đồ.                                   | Cao         |
| FR-03.4 | Hệ thống xác định các cột dạng danh mục/văn bản lặp lại để nhóm dữ liệu (group by) cho biểu đồ phân bổ.                | Trung bình  |
| FR-03.5 | Nếu không phát hiện được cột ngày tháng, hệ thống thông báo và ẩn bộ lọc thời gian, vẫn hiển thị KPI/biểu đồ tổng.     | Trung bình  |

## 3.4. FR-04: Khu vực Tổng số liệu (KPI)

| **Mã**  | **Mô tả**                                                                                                                                            | **Ưu tiên** |
|---------|------------------------------------------------------------------------------------------------------------------------------------------------------|-------------|
| FR-04.1 | Hệ thống tự động sinh tối đa 4–6 thẻ KPI quan trọng nhất từ các cột số được phát hiện (vd: Tổng, Trung bình, Số lượng bản ghi, Giá trị lớn nhất...). | Cao         |
| FR-04.2 | Giá trị KPI cập nhật theo khung thời gian đang chọn (1/7/30/90 ngày).                                                                                | Cao         |
| FR-04.3 | Mỗi thẻ KPI hiển thị thêm % thay đổi so với kỳ trước đó (nếu đủ dữ liệu).                                                                            | Thấp        |

## 3.5. FR-05: Khu vực Biểu đồ

| **Mã**  | **Mô tả**                                                                                                                                                                                                                               | **Ưu tiên** |
|---------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------|
| FR-05.1 | Hệ thống tự động gợi ý loại biểu đồ phù hợp dựa trên đặc tính dữ liệu: dữ liệu theo thời gian → biểu đồ đường/cột; dữ liệu theo danh mục → biểu đồ tròn/cột ngang; dữ liệu tương quan 2 biến số → biểu đồ phân tán (tuỳ chọn nâng cao). | Cao         |
| FR-05.2 | Người dùng có thể đổi loại biểu đồ được gợi ý sang loại khác trong nhóm phù hợp (vd: đường ↔ cột).                                                                                                                                      | Trung bình  |
| FR-05.3 | Biểu đồ cập nhật theo khung thời gian đang chọn.                                                                                                                                                                                        | Cao         |
| FR-05.4 | Hỗ trợ tối thiểu các loại biểu đồ: Line, Bar, Pie/Donut, Area.                                                                                                                                                                          | Cao         |

## 3.6. FR-06: Sidebar điều hướng

| **Mã**  | **Mô tả**                                                                                               | **Ưu tiên** |
|---------|---------------------------------------------------------------------------------------------------------|-------------|
| FR-06.1 | Sidebar hiển thị danh sách các dashboard/view đã cấu hình để chuyển đổi qua lại.                        | Cao         |
| FR-06.2 | Sidebar hiển thị các mục chức năng: Tổng quan, Cài đặt kết nối Sheet, Quản lý người dùng, Xuất báo cáo. | Cao         |
| FR-06.3 | Mục Quản lý người dùng chỉ hiển thị với vai trò Admin.                                                  | Cao         |

## 3.7. FR-07: Bộ lọc thời gian

| **Mã**  | **Mô tả**                                                                               | **Ưu tiên** |
|---------|-----------------------------------------------------------------------------------------|-------------|
| FR-07.1 | Người dùng chọn 1 trong 4 khung thời gian cố định: 1 ngày, 7 ngày, 30 ngày, 90 ngày.    | Cao         |
| FR-07.2 | Khi đổi khung thời gian, cả KPI và biểu đồ cập nhật đồng thời, không cần tải lại trang. | Cao         |

## 3.8. FR-08: Cập nhật dữ liệu (Làm mới thủ công & Đồng bộ tự động qua Webhook)

| **Mã**  | **Mô tả**                                                                                                                                                                                                                                                   | **Ưu tiên** |
|---------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------|
| FR-08.1 | Có nút “Làm mới” trên giao diện để hệ thống gọi lại Google Sheets API và lấy dữ liệu mới nhất.                                                                                                                                                              | Cao         |
| FR-08.2 | Hiển thị thời điểm cập nhật dữ liệu gần nhất (timestamp).                                                                                                                                                                                                   | Trung bình  |
| FR-08.3 | Hiển thị trạng thái loading khi đang làm mới, và thông báo lỗi nếu làm mới thất bại.                                                                                                                                                                        | Cao         |
| FR-08.4 | Hệ thống hỗ trợ đồng bộ tự động qua webhook: một Google Apps Script trigger (onEdit/onChange) gắn trên Sheet nguồn sẽ gọi endpoint webhook của backend mỗi khi dữ liệu thay đổi, để backend cập nhật lại dữ liệu cache mà không cần người dùng bấm Làm mới. | Cao         |
| FR-08.5 | Khi nhận được sự kiện webhook, hệ thống đẩy cập nhật tới các client đang mở Dashboard theo thời gian gần-thực (near real-time), ví dụ qua WebSocket/Server-Sent Events hoặc cơ chế polling ngắn ở phía client.                                              | Trung bình  |
| FR-08.6 | Nếu webhook lỗi hoặc không khả dụng (vd: Apps Script bị gỡ, mất quyền), hệ thống tự động rơi về cơ chế làm mới thủ công và cảnh báo Admin.                                                                                                                  | Trung bình  |

## 3.9. FR-09: Xuất báo cáo

| **Mã**  | **Mô tả**                                                                                             | **Ưu tiên** |
|---------|-------------------------------------------------------------------------------------------------------|-------------|
| FR-09.1 | Người dùng có thể xuất Dashboard hiện tại (KPI + biểu đồ theo khung thời gian đang chọn) ra file PDF. | Cao         |
| FR-09.2 | Người dùng có thể xuất dữ liệu bảng liên quan ra file Excel.                                          | Trung bình  |
| FR-09.3 | File xuất phải khớp đúng với dữ liệu và khung thời gian đang hiển thị tại thời điểm xuất.             | Cao         |

## 3.10. FR-10: Quản trị (Admin panel)

| **Mã**  | **Mô tả**                                                                                                      | **Ưu tiên** |
|---------|----------------------------------------------------------------------------------------------------------------|-------------|
| FR-10.1 | Admin quản lý danh sách người dùng: thêm, khóa/mở khóa, đổi vai trò.                                           | Trung bình  |
| FR-10.2 | Admin quản lý cấu hình dashboard: thay đổi Sheet nguồn, đặt lại KPI/biểu đồ được gợi ý (ẩn/hiện, sắp xếp lại). | Trung bình  |

# 4. Yêu cầu phi chức năng (Non-functional Requirements)

| **Mã** | **Hạng mục**                      | **Mô tả yêu cầu**                                                                                                                                                                                               |
|--------|-----------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| NFR-01 | Hiệu năng                         | Hệ thống đáp ứng đồng thời khoảng 150 người dùng truy cập mà không suy giảm đáng kể tốc độ tải trang (mục tiêu \< 3 giây/tải trang chính).                                                                      |
| NFR-02 | Khả dụng                          | Hệ thống hoạt động ổn định trong giờ hành chính, mục tiêu uptime ≥ 99%.                                                                                                                                         |
| NFR-03 | Bảo mật                           | Toàn bộ giao tiếp qua HTTPS; thông tin xác thực OAuth và token được lưu trữ mã hoá; phân quyền chặt chẽ theo vai trò (RBAC).                                                                                    |
| NFR-04 | Khả năng mở rộng                  | Kiến trúc mô-đun (mục 2.5) cho phép bổ sung các module Sales/Inventory/Analytics/AI mà không phải tái cấu trúc toàn bộ hệ thống hiện có.                                                                        |
| NFR-05 | Tính khả dụng sử dụng (Usability) | Giao diện trực quan, thao tác lọc thời gian và làm mới trong tối đa 2 cú nhấp chuột; hỗ trợ responsive trên desktop và tablet.                                                                                  |
| NFR-06 | Khả năng bảo trì                  | Mã nguồn tổ chức theo module rõ ràng (auth, sheets-connector, analytics-engine, chart-renderer, export) để dễ bảo trì và mở rộng.                                                                               |
| NFR-07 | Giới hạn API                      | Hệ thống xử lý và cảnh báo hợp lý khi đạt giới hạn quota của Google Sheets API (retry/backoff).                                                                                                                 |
| NFR-09 | Độ trễ đồng bộ webhook            | Từ khi Sheet nguồn thay đổi đến khi Dashboard cập nhật (qua webhook), độ trễ mục tiêu dưới 10 giây trong điều kiện vận hành bình thường.                                                                        |
| NFR-10 | Thẩm mỹ giao diện                 | Giao diện hiện đại, sinh động, nhiều màu sắc theo phong cách dashboard SaaS đương đại; sử dụng hệ thống thiết kế nhất quán (design tokens: màu sắc, khoảng cách, typography) để dễ đồng bộ khi thêm module mới. |
| NFR-08 | Nhật ký & giám sát                | Ghi log các thao tác quan trọng: đăng nhập, thay đổi cấu hình Sheet, xuất báo cáo, lỗi kết nối API.                                                                                                             |

# 5. Yêu cầu giao diện người dùng (UI Requirements)

## 5.1. Bố cục tổng thể

Giao diện Dashboard gồm 3 khu vực chính, bố trí theo dạng lưới cố định:

- Sidebar (trái): danh sách dashboard + menu chức năng, có thể thu gọn/mở rộng.

- Khu vực Tổng số liệu (trên cùng phần nội dung): dãy thẻ KPI hiển thị ngang, kèm bộ lọc thời gian (1/7/30/90 ngày) và nút Làm mới ở góc trên bên phải.

- Khu vực Biểu đồ (bên dưới): lưới các biểu đồ được gợi ý tự động, mỗi biểu đồ có tiêu đề rõ ràng và có thể đổi loại biểu đồ.

## 5.2. Trạng thái giao diện cần xử lý

- Trạng thái tải dữ liệu lần đầu (loading toàn trang).

- Trạng thái đang làm mới dữ liệu (loading cục bộ, không chặn thao tác khác).

- Trạng thái lỗi kết nối Sheet / hết quyền truy cập, kèm hướng dẫn khắc phục.

- Trạng thái Sheet không đủ dữ liệu để dựng biểu đồ/KPI (empty state).

# 6. Ma trận truy vết yêu cầu (Traceability Matrix)

| **Yêu cầu BRD**                     | **Yêu cầu SRS liên quan**           |
|-------------------------------------|-------------------------------------|
| Kết nối Google Sheets (mục 5.1 BRD) | FR-02.1 → FR-02.4                   |
| Tổng số liệu (mục 5.2 BRD)          | FR-03.3, FR-04.1 → FR-04.3          |
| Biểu đồ trực quan (mục 5.3 BRD)     | FR-03.2, FR-03.4, FR-05.1 → FR-05.4 |
| Sidebar điều hướng (mục 5.4 BRD)    | FR-06.1 → FR-06.3                   |
| Bộ lọc thời gian (mục 5.5 BRD)      | FR-07.1, FR-07.2                    |
| Cập nhật dữ liệu (mục 5.6 BRD)      | FR-08.1 → FR-08.6                   |
| Phân quyền (mục 5.7 BRD)            | FR-01.1 → FR-01.3, FR-10.1          |
| Xuất báo cáo (mục 5.8 BRD)          | FR-09.1 → FR-09.3                   |

# 7. Định hướng tích hợp AI (Giai đoạn 6 — ngoài phạm vi triển khai Giai đoạn 1)

Mục này mô tả sơ bộ kiến trúc AI dự kiến, để Giai đoạn 1 chuẩn bị sẵn các điểm neo kỹ thuật (chuẩn hoá dữ liệu, API nội bộ) cần thiết, tránh phải thiết kế lại khi triển khai.

## 7.1. Ưu tiên 1 — Chatbot hỏi-đáp số liệu bằng ngôn ngữ tự nhiên

- Người dùng đặt câu hỏi tự nhiên (vd: “Doanh thu tuần này so với tuần trước thế nào?”), hệ thống chuyển câu hỏi thành truy vấn có cấu trúc trên dữ liệu Dashboard/CSDL và trả lời kèm số liệu/biểu đồ minh hoạ.

- Kiến trúc đề xuất: lớp Backend-for-AI gọi LLM API (vd: Anthropic Claude API) theo mô hình function-calling/tool-use — LLM chọn hàm truy vấn nội bộ phù hợp (vd: getRevenueByPeriod, getTopProducts) thay vì cho phép LLM tự sinh câu lệnh SQL trực tiếp, nhằm đảm bảo an toàn dữ liệu và kiểm soát được phạm vi truy vấn.

- Ngữ cảnh trả lời được giới hạn trong phạm vi dữ liệu mà người dùng có quyền xem (tuân theo RBAC hiện có).

## 7.2. Ưu tiên 2 — AI phát hiện bất thường & dự đoán (gắn với Giai đoạn 4)

- Mô hình thống kê/máy học (vd: phát hiện ngoại lai bằng Z-score/IQR cho giai đoạn đầu, nâng cấp dần lên mô hình học máy) để phát hiện sai lệch tồn kho, giá nhập bất thường, dấu hiệu thất thoát.

- Mô hình dự báo chuỗi thời gian (vd: Prophet, ARIMA) để dự đoán nhu cầu bán hàng, hỗ trợ quyết định nhập hàng — chạy như một dịch vụ phân tích riêng (khuyến nghị viết bằng Python, tách biệt khỏi backend Node.js chính) để tận dụng hệ sinh thái khoa học dữ liệu.

## 7.3. Ưu tiên 3 — AI hỗ trợ nhập liệu/gợi ý tự động (gắn với Giai đoạn 2–3)

- Gợi ý số lượng nhập hàng dựa trên lịch sử bán và tồn kho hiện tại; cảnh báo sớm nguy cơ hết hàng/tồn dư quá mức.

## 7.4. Điểm neo kỹ thuật cần chuẩn bị từ Giai đoạn 1

- Chuẩn hoá định dạng dữ liệu số/ngày tháng ngay từ engine nhận diện cột (mục FR-03) để dữ liệu tương lai từ module Sales/Inventory có thể tái sử dụng cùng một chuẩn.

- Thiết kế API nội bộ theo hướng “truy vấn theo hàm nghiệp vụ” (business-function query) thay vì lộ trực tiếp cấu trúc bảng, thuận tiện cho việc LLM gọi hàm ở Giai đoạn 6.

# 8. Rủi ro kỹ thuật & phương án giảm thiểu

| **Rủi ro**                                                                                                  | **Phương án giảm thiểu**                                                                                                                                                                            |
|-------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Google Sheets API giới hạn quota khi 150 người dùng cùng thao tác                                           | Áp dụng cơ chế cache dữ liệu ngắn hạn ở backend, chỉ gọi lại API khi người dùng bấm Làm mới hoặc cache hết hạn.                                                                                     |
| Cấu trúc Sheet quá phức tạp/không đồng nhất khiến engine nhận diện sai kiểu dữ liệu                         | Cho phép Admin xem trước & điều chỉnh thủ công kết quả nhận diện cột trước khi áp dụng.                                                                                                             |
| Sheet không có cột ngày tháng                                                                               | Ẩn bộ lọc thời gian, vẫn hiển thị KPI/biểu đồ tổng quát không theo thời gian.                                                                                                                       |
| Rủi ro bảo mật khi dùng OAuth lưu token truy cập                                                            | Mã hoá token khi lưu trữ, giới hạn thời gian sống (TTL), thu hồi khi đổi Sheet nguồn hoặc đăng xuất.                                                                                                |
| Webhook/Apps Script trigger bị gỡ, lỗi quyền, hoặc mất kết nối khiến dữ liệu không đồng bộ tự động          | Hệ thống tự động rơi về cơ chế làm mới thủ công, cảnh báo Admin qua giao diện khi webhook không hoạt động quá một khoảng thời gian xác định.                                                        |
| Thiết kế Giai đoạn 1 không đủ linh hoạt, gây khó khăn khi bổ sung module Sales/Inventory/AI ở giai đoạn sau | Tuân thủ nghiêm ngặt nguyên tắc kiến trúc mô-đun ở mục 2.5 (ranh giới domain rõ ràng, schema tách biệt, API versioning) ngay từ Giai đoạn 1; rà soát kiến trúc trước khi bắt đầu mỗi giai đoạn mới. |
| Chi phí gọi LLM API tăng cao khi chatbot AI (Giai đoạn 6) được nhiều người dùng sử dụng thường xuyên        | Giới hạn tần suất truy vấn theo người dùng/vai trò, cache câu trả lời cho các câu hỏi lặp lại, theo dõi chi phí theo thời gian thực khi triển khai.                                                 |

*— Hết tài liệu SRS —*
