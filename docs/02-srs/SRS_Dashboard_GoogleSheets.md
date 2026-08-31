# TÀI LIỆU ĐẶC TẢ YÊU CẦU PHẦN MỀM

*(Software Requirements Specification – SRS)*

**HỆ THỐNG DASHBOARD NỘI BỘ — TOKOSI**

| **Thông tin**      | **Nội dung**                                               |
|--------------------|------------------------------------------------------------|
| Tên dự án          | Hệ thống Dashboard nội bộ TOKOSI                          |
| Phiên bản          | 2.2                                                        |
| Ngày tạo           | 27/07/2026                                                 |
| Ngày cập nhật      | 26/08/2026                                                 |
| Tài liệu liên quan | BRD v1.9 · BPMN v1.9 · Implementation Plan v2.3 · CSNS-NP-01 (Chính sách nghỉ phép) · Plan Process Automation · Lag Optimization Plan · Design System MASTER (mục 7 — ràng buộc hiệu năng) |
| Trạng thái         | Đang vận hành (Giai đoạn 1, Phase 0/0.5/1, Gói tối ưu hóa hiệu năng, Phân hệ HR Leave + Bot, Chuông thông báo, Đổi vai trò & Kiểm tra đứt hàng) |

> **Ghi chú phiên bản 2.2:** Bổ sung Chuông thông báo toàn hệ thống, Cơ chế xin đổi & duyệt vai trò người dùng, Công cụ Kiểm tra đứt hàng đối chiếu file Excel với KiotViet API nền, Phân hệ Quản lý Nghỉ phép HR (HR Leave Management) & Telegram Bot theo chính sách CSNS-NP-01. Chuẩn hóa bộ kiểm thử tự động toàn diện đạt **434 unit tests**.

# 1. Giới thiệu

## 1.1. Mục đích

Tài liệu này đặc tả chi tiết các yêu cầu chức năng và phi chức năng của hệ thống Website Dashboard TOKOSI, làm cơ sở cho đội phát triển thiết kế, xây dựng, kiểm thử phần mềm. Tài liệu cụ thể hóa các yêu cầu nghiệp vụ đã nêu trong BRD v1.8 thành các đặc tả kỹ thuật có thể triển khai được.

## 1.2. Phạm vi hệ thống

Hệ thống là một Web Application nội bộ gồm các thành phần chính:

1. **Apps Script tách theo Google Sheets:** `src-dashboard/` duy trì 9 tab vận hành, lịch sử/báo cáo và polling của Dashboard; `src-order-lifecycle/` duy trì sheet Vận chuyển độc lập và nhận `invoice.update` qua hàng đợi bền vững. Mỗi thư mục là một GAS project tự chứa với `rootDir`, manifest và cấu hình clasp riêng.

2. **Web Server (Node.js/Express + HTML frontend):** đọc đủ 9 tab dữ liệu, 3 tab công nợ HN1/HN3/HN7, tab `Users`, 6 tab vận chuyển `VC_*` và 3 tab nhân sự `HR_*` từ Google Spreadsheet qua Google Sheets API (Service Account), xác thực người dùng và phân quyền RBAC (JWT httpOnly cookie, bcrypt, Google OAuth, mã OTP 6 số, local backup store), tra cứu trạng thái vận chuyển đơn hàng, quản trị người dùng, quản lý ngày nghỉ phép nhân viên và tích hợp Telegram Bot, tính toán KPI, dữ liệu biểu đồ và báo cáo công nợ khách hàng 1/3/7 ngày, trả về cho frontend qua REST API. Tích hợp Result Cache tầng backend, phân trang bảng client-side và xuất file Excel đa worksheet. Frontend hiển thị Dashboard tương tác, trang tra cứu vận chuyển, cổng thông tin nhân sự, quản lý tài khoản và đăng nhập/đăng ký trên trình duyệt.

## 1.3. Định nghĩa & thuật ngữ

| **Thuật ngữ**           | **Giải thích**                                                                        |
|-------------------------|---------------------------------------------------------------------------------------|
| Dashboard               | Trang tổng hợp hiển thị số liệu và biểu đồ từ dữ liệu nguồn.                          |
| KPI Card                | Thẻ hiển thị 1 chỉ số tổng hợp (vd: Doanh thu hôm nay, Tổng tồn kho).               |
| Spreadsheet nguồn       | Ba Google Spreadsheet độc lập: Dashboard (`SPREADSHEET_ID`), Vận chuyển (`VC_SPREADSHEET_ID`) và Nhân sự (`HR_SPREADSHEET_ID`). |
| Service Account         | Tài khoản dịch vụ Google dùng để backend đọc/ghi Spreadsheet mà không cần OAuth user. |
| Apps Script             | Hai GAS project trong `src-dashboard/` và `src-order-lifecycle/` đồng bộ dữ liệu theo từng tính năng. |
| batchGet                | Gọi Google Sheets API đọc nhiều tab đang tồn tại cùng lúc trong 1 request HTTP.      |
| KiotViet webhook        | KiotViet Public API gửi POST JSON về Web App URL của Apps Script khi có thay đổi.    |
| Polling trigger         | Apps Script time-based trigger chạy mỗi 15 phút cho 3 bảng không có KiotViet webhook. |
| Result Cache            | Cơ chế lưu đệm kết quả KPI/biểu đồ đã tính theo phiên bản dữ liệu thô và bộ lọc.    |
| OTP                     | One-Time Password mã xác thực dùng một lần 6 số dùng để khôi phục mật khẩu.         |
| HR Leave                | Phân hệ quản lý đơn nghỉ phép, tính toán số dư ngày phép theo chính sách CSNS-NP-01. |

## 1.4. Tài liệu tham khảo

- BRD v1.8 — Hệ thống Dashboard nội bộ TOKOSI.
- CSNS-NP-01 — Quy định & Chính sách quản lý nghỉ phép nhân sự.
- Google Sheets API v4 Documentation.
- KiotViet Public API Documentation.
- Google Apps Script Documentation.

# 2. Mô tả tổng quan hệ thống

## 2.1. Kiến trúc tổng quan — Giai đoạn 1 & Phase 0/0.5/1 & HR Module (đã triển khai)

```
KiotViet POS / Telegram User / HR Portal
    |
    | (webhook POST JSON — 9 loại event / Telegram Bot webhook / HTTP REST)
    v
Apps Script (`src-dashboard/`, `src-order-lifecycle/`) / Backend Node.js Express (Render.com)
    |                                   |
    | hydrate + upsert/delete           | time-based trigger (15 phút)
    | (real-time cho 6 nhóm)            | (Trả hàng + NCC + Nhập hàng)
    v                                   v
Ba Google Spreadsheet độc lập (Dashboard / Vận chuyển / Nhân sự)
    |
    | Google Sheets API v4 — list tab → lọc tab hiện có → batchGet / append (Service Account)
    v
Backend: Node.js + Express
    - server/index.js                 : khởi động server Express (Gzip, Cache-Control)
    - server/config.js                : đọc biến môi trường (JWT_SECRET, SPREADSHEET_ID...)
    - server/routes.js                : định nghĩa endpoints & phân quyền middleware
    - server/auth/authMiddleware.js   : requireAuth, requireRole bọc route
    - server/auth/authRoutes.js       : /api/auth/* (register, login, google, profile, otp reset)
    - server/auth/adminUserRoutes.js  : /api/admin/users (CRUD tài khoản, phân quyền)
    - server/auth/otpService.js       : sinh mã OTP 6 số, mask Email/SĐT, kiểm tra thời hạn
    - server/auth/localUserStore.js   : lưu trữ tài khoản cục bộ bảo mật (server/data/users.json)
    - server/auth/userRepository.js   : đọc/tìm người dùng từ sheet Users & local store
    - server/auth/userWriteRepository.js : tạo/cập nhật user vào sheet Users & local store
    - server/hr/hrLeaveRoutes.js      : /api/hr/leave/* (nộp đơn, tra cứu, duyệt/từ chối, xuất Excel)
    - server/hr/hrLeaveService.js     : nghiệp vụ tính hạn mức và trừ ngày phép
    - server/hr/hrLeaveRepository.js  : CRUD dữ liệu Google Sheets HR_Leaves
    - server/hr/hrLeaveExportService.js : xuất báo cáo ngày nghỉ phép nhân viên ra Excel
    - server/telegram/hrTelegramBot.js : Telegram Bot nộp đơn, tra cứu ngày phép & thông báo duyệt
    - server/shipment/invoiceStatusService.js : tra cứu trạng thái hóa đơn (cache 90s)
    - server/shipment/orderStateMachine.js : State Machine 9 trạng thái vận đơn
    - server/shipment/vcOrderRepository.js : CRUD 6 tab vận chuyển VC_*
    - server/sheets/sheetsClient.js   : gọi Google Sheets API (cache thô 90s, timeout 15s)
    - server/sheets/vcSheetsClient.js : gọi Google Sheets API VC_* (cache 12s, write invalidation)
    - server/sheets/hrSheetsClient.js : gọi Google Sheets API HR_*
    - server/dashboard/dashboardData.js : tính toán KPI, biểu đồ & Result Cache
    - server/dashboard/debtReport.js  : báo cáo công nợ khách hàng HN1/HN3/HN7
    - server/dashboard/exportService.js : dịch vụ tạo file xuất Excel .xlsx 16 bảng
    - server/scripts/setupUsersSheet.js : CLI quản trị tài khoản người dùng
    - server/scripts/setupHrSheet.js  : CLI khởi tạo các tab HR
    |
    | REST APIs: /api/auth/*, /api/admin/*, /api/shipment/*, /api/hr/*, /api/dashboard, /api/search, /api/export
    v
Frontend: HTML/CSS/JS tĩnh (server/public/)
    - server/public/index.html        : Live Dashboard (KPI, biểu đồ, phân trang, xuất Excel)
    - server/public/account/index.html: Quản lý tài khoản (Hồ sơ & Quản trị người dùng)
    - server/public/humanresources/   : Cổng thông tin nhân sự (Nộp đơn nghỉ phép, tra cứu, phê duyệt)
    - server/public/login/index.html   : Đăng nhập nội bộ, Google Sign-In & Quên mật khẩu OTP
    - server/public/register/index.html: Đăng ký tài khoản Khách (Email / Số điện thoại)
    - server/public/shipment/index.html: Tra cứu trạng thái vận chuyển hóa đơn
    - server/public/shipment/dispatch/: Bảng điều phối vận đơn Web Desktop (Kế toán)
    - server/public/shipment/mobile/  : Mobile Web 1-chạm (Thủ kho & Lái xe)
    - server/public/shared/shared-nav.js : Điều hướng dùng chung đa trang & auth guard
    - server/public/js/pagination.js  : Phân trang bảng client-side
    - Chart.js (biểu đồ với animation gating)
    |
    v
Người dùng (trình duyệt) — tokosi.onrender.com / localhost:3000
```

## 2.2. Stack công nghệ thực tế

### Backend
- **Runtime:** Node.js (>= 18)
- **Framework:** Express.js v4
- **Dependencies:** `googleapis` (Google Sheets API client), `bcryptjs` / `bcrypt`, `jsonwebtoken`, `exceljs` / export builder, `dotenv` (dev only)
- **Entry point:** `server/index.js`
- **Testing:** `node:test` + `node:assert/strict` (324 unit tests tự động)
- **API:** REST; endpoints:
  - Auth: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/google`, `GET /api/auth/google-config`, `GET /api/auth/me`, `PUT /api/auth/profile`, `POST /api/auth/change-password`, `POST /api/auth/request-reset-otp`, `POST /api/auth/verify-reset-otp`, `POST /api/auth/reset-password-otp`, `POST /api/auth/logout`
  - Admin: `GET /api/admin/users`, `POST /api/admin/users`, `PATCH /api/admin/users/:username`, `POST /api/admin/users/:username/reset-password`, `DELETE /api/admin/users/:username`
  - Shipment: `POST /api/shipment/invoice-status`, `GET /api/shipment/orders`, `POST /api/shipment/orders`, `GET /api/shipment/orders/:id`, `POST /api/shipment/orders/:id/transition`, `POST /api/shipment/orders/:id/assign-driver`, `POST /api/shipment/orders/:id/photos`, `POST /api/shipment/orders/:id/exception`, `GET /api/shipment/audit`, `GET /api/shipment/vehicles`
  - HR Leave: `GET /api/hr/leave/history`, `POST /api/hr/leave/requests`, `GET /api/hr/leave/balance`, `GET /api/hr/leave/admin/requests`, `POST /api/hr/leave/admin/requests/:id/approve`, `POST /api/hr/leave/admin/requests/:id/reject`, `GET /api/hr/leave/export`
  - Dashboard & Analytics: `GET /api/dashboard`, `GET /api/search`, `GET /api/customer-product-top`
  - Export: `POST /api/export/fields`, `POST /api/export`
  - System: `GET /health`, `GET /api/debug`

### Frontend
- **Công nghệ:** HTML5, CSS3 (Vanilla), JavaScript (ES6+)
- **Thư viện biểu đồ:** Chart.js (vendor local tại `server/public/vendor/chart.umd.min.js`)
- **Phân trang:** `server/public/js/pagination.js` (module độc lập, test riêng)
- **File chính:** `server/public/index.html` (single-page, đầy đủ modal xuất Excel, bảng phân trang, dropdown mượt mà)
- **Không dùng:** React, Next.js, TailwindCSS, TypeScript

### Dữ liệu & Caching
- **Nguồn:** ba Google Spreadsheet, cấu hình qua `SPREADSHEET_ID`, `VC_SPREADSHEET_ID`, `HR_SPREADSHEET_ID`
- **Xác thực:** Google Service Account JSON (env var `GOOGLE_SERVICE_ACCOUNT_JSON`)
- **Caching:** Cache dữ liệu thô Sheets 90s (`dashboardSheetsCache`) + Result Cache in-memory theo key `(rawDataVersion, filters)`

### Hạ tầng & triển khai
- **Hosting:** Render.com (Web Service)
- **Domain:** `tokosi.onrender.com`
- **CI/CD:** tự động deploy khi push lên branch `main` của GitHub repo
- **Biến môi trường:** cấu hình trực tiếp trên Render dashboard

### Apps Script
- **Dashboard:** `src-dashboard/` qua `.clasp.json` (`rootDir: "src-dashboard"`)
- **Vận chuyển:** `src-order-lifecycle/` qua `.clasp.order-lifecycle.json` (`rootDir: "src-order-lifecycle"`)
- **Nơi chạy:** hai Google Apps Script project gắn với hai Google Spreadsheet tương ứng
- **Chức năng:** webhook receiver (`doPost`), queue bền vững, hydrate + upsert/delete; Dashboard có thêm full sync và polling 15 phút

## 2.3. Đối tượng người dùng (Giai đoạn 1)

| **Vai trò**  | **Mô tả**                                                              |
|--------------|------------------------------------------------------------------------|
| Người xem    | Mọi người dùng nội bộ có URL — xem KPI, lọc thời gian, phân trang, xuất Excel, làm mới dữ liệu. |
| IT Admin     | Cấu hình biến môi trường Render, quản lý Apps Script trigger/webhook.   |

## 2.4. Giả định & phụ thuộc

- Apps Script `src-dashboard/kiotviet/SheetSchemas.gs` duy trì schema cố định cho 9 tab; backend dùng các cột tương thích bên trái và tab Nhóm hàng để ánh xạ nhóm con về nhóm cha.
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

# 3. Yêu cầu chức năng (Functional Requirements)

## 3.1. FR-01: Đọc dữ liệu từ Google Sheets & Caching

| **Mã**  | **Mô tả**                                                                                                                        | **Ưu tiên** | **Trạng thái** |
|---------|----------------------------------------------------------------------------------------------------------------------------------|-------------|----------------|
| FR-01.1 | Backend gọi `spreadsheets.get` để lấy tên tab, lọc 9 tab dữ liệu kỳ vọng rồi đọc các tab đang tồn tại bằng một `batchGet`.        | Cao         | Hoàn thành     |
| FR-01.2 | Xác thực với Google bằng Service Account JSON (không yêu cầu OAuth người dùng).                                                   | Cao         | Hoàn thành     |
| FR-01.3 | `SPREADSHEET_ID` và `GOOGLE_SERVICE_ACCOUNT_JSON` đọc từ biến môi trường, không hard-code trong code.                            | Cao         | Hoàn thành     |
| FR-01.4 | Thông tin xác thực KiotViet được đọc từ Apps Script Properties hoặc biến môi trường server; không hard-code trong mã nguồn. | Cao | Hoàn thành |
| FR-01.5 | Nếu gọi API thất bại (timeout, 403, 500...), hệ thống trả HTTP 500 kèm thông tin lỗi chi tiết (message, Google API status).      | Cao         | Hoàn thành     |
| FR-01.6 | Nếu một tab dữ liệu không tồn tại/đã đổi tên, tab đó được ánh xạ thành mảng rỗng; các phần dữ liệu còn lại vẫn được trả về.      | Cao         | Hoàn thành     |
| FR-01.7 | Backend duy trì cache dữ liệu thô Sheets trong 90s (`dashboardSheetsCache`) và Result Cache theo `(rawDataVersion, filters)`; `rememberSearchSheets` chỉ build lại search index khi raw data thực sự được fetch mới. | Cao | Hoàn thành |

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
| FR-03.10 | Tạo `products.childCategorySalesByParent`: doanh thu và SL bán theo nhóm con, gom theo từng nhóm cha (từ Chi tiết hóa đơn, loại trừ hóa đơn đã hủy), phục vụ phần "Chi tiết theo nhóm con" ở tab Hàng hóa. | Trung bình  | Hoàn thành     |
| FR-03.11 | Tạo `products.availableParentCategories`: danh sách tên nhóm cha (từ `parentCategoryMap`, sắp xếp theo bảng chữ cái), dùng để đổ vào dropdown chọn nhóm cha thay vì nhập liệu tự do. | Trung bình  | Hoàn thành     |

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
| FR-06.1 | `syncAllInitialData()`: đồng bộ toàn bộ dữ liệu KiotViet vào 9 sheet vận hành và làm mới các báo cáo; HN1/HN3/HN7 phải chạy sau khi tab Hàng hóa đã được làm mới. | Cao | Hoàn thành |
| FR-06.2 | `doPost(e)`: nhận webhook POST, hydrate bản ghi chi tiết rồi upsert/delete đúng sheet cho product/invoice/order/customer/category; hóa đơn đồng thời thay chi tiết hóa đơn và các dòng `Hàng bán theo khách`. | Cao | Hoàn thành |
| FR-06.3 | `setupPollingTrigger()`: bật trigger 15 phút để sync Trả hàng + Nhà cung cấp + Nhập hàng (KiotViet không có webhook cho 3 loại này).                                          | Cao         | Hoàn thành     |
| FR-06.4 | `setupRealtimeWebhook()`: đăng ký 9 loại event webhook với KiotViet API, xóa webhook cũ trước khi đăng ký mới.                                                               | Cao         | Hoàn thành     |
| FR-06.5 | Retry tự động tối đa 5 lần (exponential backoff) khi gọi KiotViet API bị lỗi tạm thời (429/5xx/network error).                                                               | Cao         | Hoàn thành     |
| FR-06.6 | `syncCustomerReport()`: tổng hợp toàn bộ lịch sử hóa đơn và trả hàng hoàn thành, ghi tab `Báo cáo bán hàng` đủ 18 cột như file xuất KiotViet, gồm thông tin khách, số đơn, tổng tiền, giảm giá, doanh thu và chi tiết từng giao dịch. | Cao | Hoàn thành |
| FR-06.7 | Tab `Hàng bán theo khách` giữ đúng 5 cột Khách hàng, Mã hàng, Tên hàng, SL mua chi tiết, Thời gian; mỗi chi tiết hàng hóa của hóa đơn hoàn thành trong 90 ngày là một dòng. | Cao | Hoàn thành |
| FR-06.8 | Webhook hóa đơn thay/xóa đúng các dòng `Hàng bán theo khách` trong chu kỳ hàng đợi 1 phút; `syncCustomerReportIfDue_()` đối soát độc lập `Báo cáo bán hàng` gần 06:00, `Hàng bán theo khách` gần 06:30 và `Khách theo hàng hóa` gần 07:00. Hàng đợi kiểm tra mỗi phút và chạy bù riêng báo cáo nào đã đến lịch nhưng chưa đồng bộ thành công. | Cao | Hoàn thành |
| FR-06.9 | 9 sheet giữ các cột dashboard ở bên trái và các trường KiotViet dạng phẳng đang dùng ở bên phải; không lưu object/mảng hoặc payload gốc dạng JSON. Trigger nền tự xóa vật lý các cột `(JSON)` của schema cũ sau khi deploy. | Cao | Hoàn thành |
| FR-06.10 | Webhook phải được ghi vào tab hàng đợi ẩn bền vững trước khi phản hồi thành công; chỉ xóa sau khi xử lý thành công. Lỗi được retry tối đa 10 lần rồi giữ ở trạng thái `ERROR` để xử lý thủ công. | Cao | Hoàn thành |
| FR-06.11 | Full sync ghi dữ liệu mới trước khi dọn dòng cũ dư và khóa chung với luồng webhook, tránh xóa trắng hoặc ghi đè chéo khi cập nhật lỗi. | Cao | Hoàn thành |
| FR-06.12 | `syncCustomerDebtReports()` dùng cùng luồng tính cho chạy riêng và `syncAllInitialData()`, ghi đè HN1/HN3/HN7 theo kỳ 1/3/7 ngày và tự cập nhật gần 15:00. | Cao | Hoàn thành |
| FR-06.14 | Tab `Khách theo hàng hóa` có đúng 25 cột như file xuất KiotViet, tổng hợp toàn bộ lịch sử theo sản phẩm → khách hàng → chi tiết hóa đơn; chỉ cập nhật gần 07:00 hoặc qua `syncCustomerByProductReport()`, không nhận cập nhật webhook. | Cao | Hoàn thành |

## 3.7. FR-07: Giao diện người dùng & Tối ưu tương tác

| **Mã**  | **Mô tả**                                                                                                                | **Ưu tiên** | **Trạng thái** |
|---------|--------------------------------------------------------------------------------------------------------------------------|-------------|----------------|
| FR-07.1 | Sidebar điều hướng với các mục tương ứng từng section của dashboard.                                                    | Cao         | Hoàn thành     |
| FR-07.2 | Khu vực KPI cards: hiển thị các chỉ số tổng quan với icon và màu sắc phân biệt.                                         | Cao         | Hoàn thành     |
| FR-07.3 | Biểu đồ doanh thu theo ngày (line/bar chart) với bộ lọc 7/30/90 ngày.                                                   | Cao         | Hoàn thành     |
| FR-07.4 | Bảng top sản phẩm bán chạy, hàng đã hết, công nợ khách hàng, NCC, đặt hàng, trả hàng, nhập hàng gần nhất.              | Cao         | Hoàn thành     |
| FR-07.7 | Biểu đồ cột giá trị và biểu đồ tròn số lượng tồn kho đều gom theo nhóm cha; biểu đồ cột hiển thị tối đa 30 cột và tooltip có giá trị tiền, tỷ trọng. | Cao | Hoàn thành |
| FR-07.5 | Route `/api/debug`: kiểm tra biến môi trường, kết nối Google Sheets và liệt kê `sheetTabs`; trả riêng `sheetTabsError` nếu bước liệt kê lỗi. | Thấp | Hoàn thành |
| FR-07.6 | Route `/health`: trả HTTP 200 `{"status":"ok"}` để Render health check.                                                  | Cao         | Hoàn thành     |
| FR-07.8 | Thanh tìm kiếm có hai chế độ: thông thường và nhiều mã. Chế độ nhiều mã tách tối đa 50 mã theo khoảng trắng, khớp chính xác không phân biệt hoa thường, loại mã trùng và trả kết quả theo thứ tự nhập. | Cao | Hoàn thành |
| FR-07.9 | Riêng tab Khách hàng có thêm chế độ `Top KH theo sản phẩm`: nhận tối đa 50 mã, trả tối đa 3 khách/mã theo SL mua trong kỳ; hiển thị doanh thu mua, tổng trả toàn thời gian, doanh thu thuần hỗn hợp và ngày mua cuối cùng. | Cao | Hoàn thành |
| FR-07.10 | Mỗi bảng dữ liệu có nút `Xuất Excel`; người dùng chọn trường từ đầy đủ header Google Sheets, mặc định chọn tất cả. File giữ bộ lọc hiện tại, bỏ giới hạn phân trang nhưng giữ giới hạn Top/gần đây của bảng. | Cao | Hoàn thành |
| FR-07.11 | Kết quả tìm kiếm ngoài Tổng quan được xuất Excel; kết quả nhiều nguồn tạo một worksheet cho mỗi nguồn và tự lấy toàn bộ trường. Tìm kiếm Tổng quan không hỗ trợ xuất do trộn nhiều loại dữ liệu. | Cao | Hoàn thành |
| FR-07.12 | Xuất Nhập hàng và Công nợ tạo hai worksheet tổng hợp/chi tiết; workbook cố định header, bật AutoFilter và giữ mã/SĐT dạng text. | Cao | Hoàn thành |
| FR-07.13 | Bảng tất cả hàng hóa (`allProducts`) và bảng hàng đã hết (`lowStock`) được phân trang client-side qua `pagination.js` (~200 dòng/trang), có điều khiển Trang trước / Trang sau, giữ nguyên thẻ đếm tổng số lượng. | Cao | Hoàn thành |
| FR-07.14 | Biểu đồ Chart.js có animation gating (không animate lại khi chuyển tab, đổi theme hay background polling); các phần tử dropdown, surface theme và dòng chi tiết công nợ có transition mượt mà dùng chung token `--ease-out`. | Cao | Hoàn thành |

## 3.8. FR-08: Đăng ký, Google Guest, Quản trị tài khoản & Tra cứu vận chuyển

| **Mã** | **Mô tả** | **Ưu tiên** | **Trạng thái** |
|--------|-----------|-------------|----------------|
| FR-08.1 | Form đăng ký riêng nhận họ tên, email hoặc số điện thoại và mật khẩu; mật khẩu được băm bcrypt, tài khoản `Khách` hoạt động và tự đăng nhập ngay. | Cao | Hoàn thành |
| FR-08.2 | Google Identity cho phép email xác minh đăng nhập ngay: email mới nhận vai trò `Khách`, tài khoản nội bộ giữ vai trò hiện có, tài khoản khóa bị từ chối và bản ghi legacy `Chờ duyệt` chuyển thành `Khách`. | Cao | Hoàn thành |
| FR-08.3 | `Khách` chỉ thấy mục Quản lý vận chuyển và bị backend chặn khỏi dashboard, tìm kiếm, xuất Excel và debug; bốn vai trò nội bộ giữ quyền hiện tại. | Cao | Hoàn thành |
| FR-08.4 | Tra cứu vận chuyển nhận tối đa 50 mã hóa đơn, khớp chính xác không phân biệt hoa/thường, loại trùng và chỉ trả `code`, `found`, `status`; giao diện không hiển thị dữ liệu trước khi tìm. | Cao | Hoàn thành |
| FR-08.5 | Quản lý hồ sơ cá nhân và đổi mật khẩu chủ động (`PUT /api/auth/profile`, `POST /api/auth/change-password`), yêu cầu nhập mật khẩu hiện tại để xác minh. | Cao | Hoàn thành |
| FR-08.6 | Khôi phục mật khẩu qua mã OTP 6 số (`request-reset-otp`, `verify-reset-otp`, `reset-password-otp`), che mờ Email/SĐT, giới hạn thử lại, chống brute-force và cơ chế lockout tạm thời 5 phút khi đăng nhập sai quá 5 lần liên tiếp. | Cao | Hoàn thành |
| FR-08.7 | Quản trị người dùng Admin (`/api/admin/users`), chỉ vai trò `Quản lý` được xem danh sách, tạo tài khoản, đổi vai trò, đặt lại mật khẩu và khóa/mở khóa tài khoản; hỗ trợ lưu trữ cục bộ bảo mật `users.json`. | Cao | Hoàn thành |

## 3.10. FR-10: Nghỉ phép theo buổi và Telegram Bot

| **Mã** | **Mô tả** | **Ưu tiên** | **Trạng thái** |
|---|---|---|---|
| FR-10.1 | Đơn nghỉ lưu mốc bắt đầu/kết thúc dạng `Sáng|Chiều dd/mm/yyyy`, tổng số buổi và tổng ngày quy đổi bằng số buổi chia 2. | Cao | Hoàn thành |
| FR-10.2 | Phép tính buổi tính chính xác từ đầu buổi bắt đầu đến hết cuối buổi kết thúc (ví dụ: Sáng - Sáng cùng ngày là 1 buổi, Chiều hôm trước - Sáng hôm sau là 2 buổi, Sáng - Chiều cùng ngày là 2 buổi). | Cao | Hoàn thành |
| FR-10.3 | Bot dùng luồng nhập ngày và buổi, khôi phục được `startDate`/`endDate` sau restart và chống xử lý trùng theo `chatId:messageId`. | Cao | Hoàn thành |
| FR-10.4 | Thời gian gửi sau 07:45 đối với buổi Sáng hoặc 12:30 đối với buổi Chiều được cảnh báo; nếu vẫn xác nhận, đơn được lưu với trạng thái `Vi phạm`. | Cao | Hoàn thành |
| FR-10.5 | Tab Nghỉ phép hiển thị cột Thời gian gửi; bộ lọc `from`/`to` lọc theo trường này và mặc định 3 ngày gần đây. | Cao | Hoàn thành |

# 4. Yêu cầu phi chức năng (Non-functional Requirements)

| **Mã** | **Hạng mục**         | **Mô tả yêu cầu**                                                                                                                               |
|--------|----------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| NFR-01 | Hiệu năng            | API `/api/dashboard` phản hồi < 10ms khi cache hit (Result Cache); phản hồi trong vòng 5 giây khi phải gọi Google Sheets API (`batchGet`).     |
| NFR-02 | Khả dụng             | Hệ thống hoạt động ổn định trên Render.com, mục tiêu uptime >= 99% trong giờ hành chính.                                                        |
| NFR-03 | Bảo mật              | Toàn bộ giao tiếp qua HTTPS; Service Account key và Spreadsheet ID lưu trong biến môi trường, không commit vào repo.                             |
| NFR-04 | Khả năng mở rộng     | Kiến trúc module rõ ràng (config, sheets, dashboard, routes) cho phép bổ sung module mới mà không phải rewrite code hiện tại.                    |
| NFR-05 | Usability            | Giao diện trực quan, thao tác lọc thời gian và làm mới trong 1–2 cú nhấp chuột; bảng lớn chuyển trang tức thì không đơ UI; hỗ trợ desktop/tablet.|
| NFR-06 | Bảo trì              | Mã nguồn tổ chức theo module rõ ràng, comment tiếng Việt, dễ đọc và bảo trì.                                                                   |
| NFR-07 | Giới hạn API         | Sau khi lấy metadata tab, dùng một `batchGet` duy nhất để đọc toàn bộ tab dữ liệu đang tồn tại; chu kỳ làm mới tự động là 10 phút.               |
| NFR-08 | Nhật ký & debug      | Log chi tiết lỗi khi `/api/dashboard` thất bại; `/api/debug` kiểm tra kết nối và trả danh sách tab hiện có mà không lộ secret.                   |
| NFR-09 | Độ trễ đồng bộ       | Từ khi dữ liệu thay đổi trên KiotViet → Apps Script cập nhật Sheets qua webhook: mục tiêu dưới 2 phút. Trả hàng/NCC/Nhập hàng: tối đa 15 phút (polling). |
| NFR-10 | Nhất quán thời gian  | Parse ngày từ Sheets, xác định ngày hiện tại, tạo bucket 7/30/90 ngày và format `updatedAt` theo Asia/Ho_Chi_Minh, độc lập timezone máy chủ.      |
| NFR-11 | An toàn xuất dữ liệu | API xuất chỉ nhận khóa bảng, bộ lọc và danh sách trường hợp lệ; không nhận dòng dữ liệu từ client, chặn trường lạ và vô hiệu hóa chuỗi có thể bị Excel hiểu là công thức. |
| NFR-12 | Kiểm thử tự động     | Duy trì bộ **417 unit tests** chuẩn `node:test` bao phủ HR leave, Telegram bot, conversation store, Apps Script sync, auth/Guest/SĐT, Admin CRUD, OTP reset, tra cứu vận chuyển, State Machine 9 trạng thái, VC repository, cache, phân trang, xuất Excel, tìm kiếm nâng cao và frontend (gồm `no-3d-effects.test.js` chặn lớp 3D quay lại). |


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
- **Khách:** chỉ hiển thị mục Quản lý vận chuyển; bảng kết quả mặc định trống và trở lại trống khi xóa danh sách mã.

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
  "products": {
    "childCategorySalesByParent": { "<Tên nhóm cha>": [{ "name": "", "qty": 0, "revenue": 0, "productCount": 0 }] },
    "availableParentCategories": [""]
  },
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

## 6.2. GET /api/search

**Mô tả:** Tìm bản ghi trong phạm vi tab dashboard hiện tại. Mặc định tìm mã, tên hoặc từ khóa như trước; khi `mode=codes`, tìm chính xác nhiều mã cùng lúc.

**Query params:**
- `view` (optional): phạm vi dữ liệu tương ứng tab hiện tại.
- `q` (required): từ khóa hoặc danh sách mã phân tách bởi một hay nhiều ký tự khoảng trắng.
- `limit` (optional): số dòng tối đa hoặc `all`; chế độ nhiều mã luôn trả toàn bộ dòng khớp.
- `mode` (optional): đặt `codes` để tìm tối đa 50 mã chính xác, loại mã trùng không phân biệt hoa thường và giữ thứ tự nhập.

Chế độ nhiều mã trả thêm `requestedCount`, `matchedCount` và `missingCount`; cấu trúc từng phần tử `results` giống chế độ thông thường.

## 6.3. GET /api/customer-product-top

**Mô tả:** Tìm tối đa 3 khách hàng có SL mua cao nhất cho từng mã hàng từ sheet `Khách theo hàng hóa`. Dữ liệu mua và ngày mua cuối chịu bộ lọc thời gian tab Khách hàng; SL trả và Giá trị trả là tổng toàn thời gian do sheet nguồn không lưu ngày trả chi tiết.

**Query params:**
- `q` (required): tối đa 50 mã hàng, phân tách bằng khoảng trắng hoặc xuống dòng; khớp chính xác, không phân biệt hoa thường, loại mã trùng và giữ thứ tự nhập.
- `cuMode`: `days`, `range` hoặc `all`.
- `cuDays`: số ngày khi `cuMode=days`.
- `cuFrom`, `cuTo`: ngày `yyyy-MM-dd` khi `cuMode=range`.

**Response (HTTP 200):** trả `filter`, `requestedCount`, `matchedCount`, `missingCount`, `total` và `results`. Mỗi kết quả gồm `productCode`, `productName`, `customerName`, `purchasedQuantity`, `purchaseRevenue`, `returnedQuantityAllTime`, `returnValueAllTime`, `netRevenue`, `lastPurchaseDate`.

Kết quả xếp theo SL mua giảm dần, sau đó doanh thu mua, ngày mua cuối và mã khách. `netRevenue` bằng doanh thu mua trong kỳ trừ giá trị trả toàn thời gian; khi `cuMode` khác `all`, hai vế không cùng kỳ và giao diện phải hiển thị chú thích rõ ràng.

## 6.4. GET /health

**Mô tả:** Health check cho Render.com.

**Response (HTTP 200):** `{"status": "ok"}`

## 6.5. GET /api/debug

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

## 6.6. POST /api/export/fields

**Mô tả:** Lấy danh sách các worksheet và trường dữ liệu hợp lệ có thể chọn để xuất Excel cho một bảng dữ liệu hoặc kết quả tìm kiếm cụ thể.

**Body (JSON):**
```json
{
  "tableKey": "allProducts",
  "searchContext": null
}
```

**Response (HTTP 200):**
```json
{
  "tableKey": "allProducts",
  "defaultFilename": "tat-ca-ma-hang_14-08-2026.xlsx",
  "sheets": [
    {
      "sheetKey": "allProducts",
      "sheetTitle": "Tất cả mã hàng",
      "fields": [
        { "key": "code", "label": "Mã hàng", "default": true },
        { "key": "name", "label": "Tên hàng", "default": true },
        { "key": "category", "label": "Nhóm hàng", "default": true },
        { "key": "stock", "label": "Tồn kho", "default": true },
        { "key": "costPrice", "label": "Giá vốn", "default": true }
      ]
    }
  ]
}
```

## 6.7. POST /api/export

**Mô tả:** Nhận cấu hình trường cần xuất và ngữ cảnh bộ lọc/tìm kiếm, đọc dữ liệu thực tế từ Google Sheets trên server và tạo file `.xlsx` định dạng hoàn chỉnh (cố định hàng tiêu đề, bật AutoFilter, ép kiểu text cho mã/SĐT).

**Body (JSON):**
```json
{
  "tableKey": "allProducts",
  "selectedFields": {
    "allProducts": ["code", "name", "category", "stock", "costPrice"]
  },
  "searchContext": null
}
```

**Response (HTTP 200):** Binary stream file `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` kèm header `Content-Disposition: attachment; filename="..."`.

## 6.8. API xác thực & Hồ sơ cá nhân

- `POST /api/auth/register`: nhận `{ "hoTen": "...", "email": "...", "phone": "...", "password": "..." }`; tạo tài khoản `Khách`, cookie JWT và trả user với HTTP 201.
- `POST /api/auth/login`: đăng nhập username/password, cấp JWT cookie `tks_auth`; kích hoạt lockout 5 phút nếu nhập sai 5 lần liên tiếp.
- `POST /api/auth/google`: xác minh Google ID token; email mới hoặc legacy `Chờ duyệt` vào ngay với vai trò `Khách`, email nội bộ giữ nguyên vai trò, tài khoản khóa trả 403.
- `GET /api/auth/me` và `POST /api/auth/logout`: dùng chung cho tài khoản nội bộ và Khách.
- `PUT /api/auth/profile`: cập nhật thông tin cá nhân (họ tên, email, SĐT khôi phục) kèm xác thực mật khẩu hiện tại.
- `POST /api/auth/change-password`: đổi mật khẩu người dùng chủ động.
- `POST /api/auth/request-reset-otp`: sinh và gửi mã OTP 6 số khôi phục mật khẩu (hạn dùng 5 phút).
- `POST /api/auth/verify-reset-otp`: xác thực mã OTP và cấp `resetToken` 10 phút.
- `POST /api/auth/reset-password-otp`: đổi mật khẩu mới sử dụng `resetToken`.

## 6.9. POST /api/shipment/invoice-status

**Quyền:** mọi tài khoản đã đăng nhập. Các API dashboard/debug/search/export chỉ cho bốn vai trò nội bộ.

**Body:** `{ "codes": ["HD001", "HD002"] }`, tối đa 50 phần tử.

**Response (HTTP 200):**
```json
{
  "results": [
    { "code": "HD001", "found": true, "status": "Hoàn thành" },
    { "code": "HD002", "found": false, "status": "" }
  ]
}
```

API trim, khớp chính xác không phân biệt hoa/thường, loại mã trùng theo thứ tự đầu vào và chỉ đọc hai cột `Mã hóa đơn`/`Trạng thái`. Snapshot sheet được cache 90 giây.

## 6.10. API Quản trị người dùng Admin (`/api/admin/users/*`)

- `GET /api/admin/users`: danh sách tài khoản, vai trò và trạng thái. (Chỉ vai trò `Quản lý`).
- `POST /api/admin/users`: tạo tài khoản người dùng mới.
- `PATCH /api/admin/users/:username`: cập nhật thông tin tài khoản, đổi vai trò hoặc khóa/kích hoạt.
- `POST /api/admin/users/:username/reset-password`: đặt lại mật khẩu cho tài khoản người dùng.
- `DELETE /api/admin/users/:username`: khóa tài khoản người dùng.

## 6.11. API Vận chuyển & Điều phối (`/api/shipment/*`)

- `GET /api/shipment/orders`: danh sách đơn vận chuyển kèm bộ lọc trạng thái, luồng, kho, lái xe, ngày.
- `POST /api/shipment/orders`: tạo đơn vận chuyển mới.
- `GET /api/shipment/orders/:id`: chi tiết vận đơn, mặt hàng, lịch sử và ảnh chứng từ.
- `POST /api/shipment/orders/:id/transition`: chuyển trạng thái vận đơn theo State Machine 9 trạng thái.
- `POST /api/shipment/orders/:id/assign-driver`: gán lái xe và mã phương tiện.
- `POST /api/shipment/orders/:id/photos`: tải lên ảnh chứng từ lưu Google Drive (`VC_Attachments`).
- `POST /api/shipment/orders/:id/exception`: báo cáo sự cố vận chuyển (`VC_Exceptions`).
- `GET /api/shipment/audit`: báo cáo đối soát cuối ngày lọc đơn thiếu ảnh hoặc giao trễ.
- `GET /api/shipment/vehicles`: danh mục xe và tài xế (`VC_Vehicles`).

# 7. Đặc tả Apps Script theo tính năng

## 7.1. Schema 9 tab đồng bộ và dashboard sử dụng

Các dải cột dưới đây là **cột tương thích dashboard** và luôn nằm bên trái.
`src-dashboard/kiotviet/SheetSchemas.gs` nối thêm các trường Public API dạng phẳng đang sử
dụng ở bên phải, gồm ID, trạng thái gốc, thời gian tạo/cập nhật và thông tin thuế.
Object/mảng lồng và payload gốc không được ghi vào Sheets; bước di trú chạy một
lần qua trigger nền sẽ xóa vật lý các cột `(JSON)` của schema cũ.

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

## 7.2. Schema tab "Báo cáo bán hàng" (dashboard không đọc)

`[0]Mã KH [1]Khách hàng [2]Số điện thoại [3]Nhóm khách hàng [4]SL đơn bán [5]Tổng tiền [6]Giảm giá HĐ [7]Doanh thu [8]SL đơn trả [9]Giá trị trả [10]Doanh thu thuần [11]Mã giao dịch [12]Thời gian (theo giao dịch) [13]Nhân viên [14]SL giao dịch (theo giao dịch) [15]Tổng tiền hàng (theo giao dịch) [16]Giảm giá (theo giao dịch) [17]Doanh thu (theo giao dịch)`

- Mỗi hóa đơn hoặc phiếu trả hàng là một dòng; các cột tổng hợp theo khách hàng được lặp lại để mỗi dòng có thể lọc/đối soát độc lập.
- Số điện thoại và nhóm khách hàng được nối từ endpoint khách hàng của KiotViet; mã, thời gian, nhân viên, số lượng và giá trị giao dịch lấy từ hóa đơn/phiếu trả.
- Dữ liệu bao phủ toàn bộ lịch sử đến hết ngày hiện tại theo `Asia/Ho_Chi_Minh`.
- Chỉ tính hóa đơn/phiếu trả hàng trạng thái hoàn thành; `Doanh thu thuần = Doanh thu - Giá trị trả`.
- `Báo cáo bán hàng` tự động đối soát gần 06:00 theo `Asia/Ho_Chi_Minh`; hàng đợi kiểm tra mỗi phút và chạy bù nếu báo cáo chưa đồng bộ thành công.

## 7.3. Schema tab "Hàng bán theo khách" (dashboard không đọc)

`[0]Khách hàng [1]Mã hàng [2]Tên hàng [3]SL mua chi tiết [4]Thời gian`

- Mỗi chi tiết hàng hóa trong hóa đơn hoàn thành là một dòng; không có dòng tổng hợp.
- Dữ liệu được lấy theo khoảng thời gian **90 ngày qua**, sắp xếp mới nhất trước.
- Khoảng ngày chạy từ 00:00 của ngày cách hiện tại 90 ngày đến hết ngày hiện tại theo `Asia/Ho_Chi_Minh`, tương ứng cách KiotViet hiển thị “30 ngày qua”.
- Chỉ ghi hóa đơn trạng thái hoàn thành. Webhook cập nhật trong khoảng 1 phút; mã/ID hóa đơn được lưu ở note nội bộ của cột A để thay hoặc xóa đúng dòng mà không phải thêm cột kỹ thuật.
- Lượt đối soát gần 06:30 làm mới toàn bộ cửa sổ 90 ngày để loại bản ghi hết hạn và đối soát sai lệch webhook.

## 7.4. Schema tab "Khách theo hàng hóa"

`[0]Nhóm hàng [1]Mã hàng [2]Tên hàng [3]Thương hiệu [4]Đơn vị tính [5]SL Khách hàng [6]SL mua (theo sản phẩm) [7]Doanh thu (theo sản phẩm) [8]SL Trả (theo sản phẩm) [9]Giá trị trả (theo sản phẩm) [10]Doanh thu thuần (theo sản phẩm) [11]Mã KH [12]Khách hàng [13]Số điện thoại [14]SL mua (theo khách hàng) [15]Doanh thu (theo khách hàng) [16]SL Trả (theo khách hàng) [17]Giá trị trả (theo khách hàng) [18]Doanh thu thuần (theo khách hàng) [19]Mã hóa đơn [20]Chi nhánh [21]Thời gian [22]SL chi tiết [23]Đơn giá chi tiết [24]Thành tiền chi tiết`

- Dữ liệu bao phủ toàn bộ lịch sử; chỉ tính hóa đơn và phiếu trả hoàn thành.
- Các chỉ tiêu sản phẩm và khách hàng được lặp lại trên từng dòng hóa đơn để có thể lọc và đối soát độc lập; phiếu trả không còn hóa đơn gốc vẫn được giữ bằng một dòng trống phần chi tiết bán.
- Metadata nhóm hàng, thương hiệu và đơn vị tính được nối từ tab `Hàng hóa`; số điện thoại nối từ hồ sơ khách hàng.
- Sheet không nhận webhook. `syncCustomerByProductReport()` tự động đối soát gần 07:00 và cho phép cập nhật thủ công bất kỳ lúc nào.
- Dashboard chỉ đọc sheet này khi gọi `/api/customer-product-top` và giữ cache riêng 90 giây; luồng `/api/dashboard` thông thường không tải sheet lớn này.

## 7.5. Các tab HN1/HN3/HN7 do Apps Script duy trì

- `CustomerDebtReport.gs` lấy dữ liệu khách hàng, hóa đơn, trả hàng và thu/chi từ KiotViet rồi ghi HN1/HN3/HN7 theo các kỳ 1/3/7 ngày.
- `syncAllInitialData()` làm mới tab Hàng hóa trước khi dựng ba báo cáo để thông tin mã hàng, tên hàng, thương hiệu và nhóm hàng giống kết quả chạy `syncCustomerDebtReports()` riêng.
- Trigger hàng ngày chạy gần 15:00; hàng đợi một phút có cơ chế chạy bù nếu lịch ngày bị trễ hoặc lỗi.
- Backend dashboard chỉ đọc ba tab này và không ghi ngược lại.

## 7.6. Webhook KiotViet — hai project độc lập

Project `src-dashboard/` đăng ký 9 loại: `product.update`, `product.delete`, `stock.update`, `customer.update`, `customer.delete`, `invoice.update`, `order.update`, `category.update`, `category.delete`.

KiotViet chỉ chấp nhận một webhook cho mỗi Type, vì vậy project Dashboard giữ đăng ký `invoice.update`. Sau khi cập nhật sheet Dashboard thành công, hàng đợi chuyển tiếp payload sang Web App `src-order-lifecycle/`; project Vận chuyển có queue một phút riêng và không đăng ký webhook trùng. Profile `COMBINED` không còn được sử dụng.

**Lưu ý quan trọng:** KiotViet KHÔNG có webhook cho Trả hàng (`return.*`), Nhà cung cấp (`supplier.*`), Nhập hàng (`purchaseorder.*`) → dùng polling 15 phút để cân bằng độ mới dữ liệu và quota.

## 7.7. Format ngày tháng

Tất cả giá trị ngày trong sheet được lưu dạng chuỗi: `dd/MM/yyyy HH:mm` (vd: `28/07/2026 14:30`), do Apps Script dùng `Utilities.formatDate(..., 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy HH:mm')`.

Backend parse ngày bằng hàm `parseSheetDate()` hỗ trợ: số serial Excel, chuỗi `dd/MM/yyyy [HH:mm:ss]`, chuỗi ISO không offset (được hiểu là giờ Việt Nam) và ISO 8601 có offset. Giá trị không hợp lệ trả về `null` thay vì làm lỗi toàn bộ dashboard.

Các phép tính "hôm nay", bucket ngày 7/30/90 ngày và `updatedAt` đều dùng `Asia/Ho_Chi_Minh` (`UTC+07:00`), không dùng timezone mặc định của máy chủ Render.

## 7.8. Schema tab yêu cầu nghỉ phép HR

Các cột nghiệp vụ nghỉ phép dùng `Thời gian gửi` (ISO), `Thời gian bắt đầu`, `Thời gian kết thúc`, `Tổng buổi nghỉ`, `Tổng ngày nghỉ quy đổi`. Hai mốc nghỉ có định dạng `Sáng dd/mm/yyyy` hoặc `Chiều dd/mm/yyyy`; không còn cột tổng giờ nghỉ.

# 8. Ma trận truy vết yêu cầu (Traceability Matrix)

| **Yêu cầu BRD**                          | **Yêu cầu SRS liên quan**           |
|------------------------------------------|-------------------------------------|
| Kết nối Sheets & Caching (5.1)           | FR-01.1 → FR-01.7                   |
| KPI tổng quan (5.2)                      | FR-02.1 → FR-02.9                   |
| Biểu đồ & bảng chi tiết (5.3)           | FR-03.1 → FR-03.11                  |
| Bộ lọc 7/30/90 ngày (5.4)               | FR-04.1, FR-04.2, FR-04.3           |
| Cập nhật dashboard (5.5)                 | FR-05.1 → FR-05.5                   |
| Đồng bộ tự động — Apps Script (5.5)     | FR-06.1 → FR-06.14                  |
| Giao diện, Phân trang & Xuất Excel (5.3, 5.4, 5.5) | FR-07.1 → FR-07.14        |
| Đăng ký, Google Guest, Quản trị tài khoản & tra cứu vận chuyển | FR-08.1 → FR-08.7 |
| Nghỉ phép theo buổi & Telegram Bot | FR-10.1 → FR-10.5 |
| ~~Lớp hiệu ứng 3D Visual & Giám sát hiệu năng thích ứng~~ (FR-09.x đã thu hồi — lớp 3D bị gỡ bỏ vì hiệu năng) | — |

# 9. Rủi ro kỹ thuật & phương án giảm thiểu

| **Rủi ro**                                                                           | **Phương án giảm thiểu**                                                                                            |
|--------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| Google Sheets API trả 500 khiến dashboard không load được                            | Log chi tiết lỗi (googleStatus, message) + route `/api/debug` để chẩn đoán nhanh. Hiển thị lỗi rõ ràng cho user. |
| Service Account bị xóa hoặc mất quyền trên Spreadsheet                              | Biến môi trường `GOOGLE_SERVICE_ACCOUNT_JSON` trên Render; cần re-share Spreadsheet khi thay SA.                   |
| KiotViet webhook bị gỡ/hết hạn → các bảng có webhook ngừng cập nhật                  | Kiểm tra webhook/queue; chạy thủ công `syncAllInitialData()` để đối soát toàn bộ. Polling 15 phút chỉ áp dụng cho 3 bảng không có webhook. |
| Apps Script timeout khi đồng bộ lượng lớn dữ liệu (quota 6 phút/execution)          | Hàm `kvFetchAllPages_` chia nhỏ theo trang (pageSize=100); retry có delay tránh rate-limit.                         |
| Tên sheet hoặc thứ tự cột thay đổi trong Apps Script → backend đọc sai dữ liệu      | Schema cố định, comment rõ ràng trong cả 2 file; cần sync thay đổi schema giữa Apps Script và dashboardData.js.    |
| Một tab bị thiếu/đổi tên làm `batchGet` lỗi toàn bộ                                 | Liệt kê tab trước khi đọc, chỉ `batchGet` tab hiện có; trả mảng rỗng cho tab thiếu và kiểm tra bằng `/api/debug`.   |
| Múi giờ máy chủ Render khác Việt Nam làm lệch KPI "hôm nay"                        | Parse, tạo bucket ngày và format kết quả bằng `Asia/Ho_Chi_Minh`/UTC+07:00.                                         |
| Trình duyệt trì hoãn timer khi tab chạy nền làm timestamp cũ                        | Lưu thời điểm fetch cuối và gọi lại API khi tab `visible` nếu đã qua chu kỳ 10 phút.                               |
| Render.com free tier hibernation → cold start làm chậm request đầu tiên             | Health check endpoint `/health` được Render ping định kỳ để giữ instance ấm.                                       |

*— Hết tài liệu SRS v1.9 —*
