# TÀI LIỆU ĐẶC TẢ YÊU CẦU PHẦN MỀM

*(Software Requirements Specification – SRS)*

**HỆ THỐNG DASHBOARD NỘI BỘ — TOKOSI**

| **Thông tin**      | **Nội dung**                                               |
|--------------------|------------------------------------------------------------|
| Tên dự án          | Hệ thống Dashboard nội bộ TOKOSI                          |
| Phiên bản          | 2.5                                                        |
| Ngày tạo           | 27/07/2026                                                 |
| Ngày cập nhật      | 19/09/2026                                                 |
| Tài liệu liên quan | BRD v2.0 · BPMN v2.1 · Implementation Plan v2.4 · CSNS-NP-01 (Chính sách nghỉ phép) · Design System MASTER (mục 7 — ràng buộc hiệu năng) |
| Trạng thái         | Đang vận hành (Supabase PostgreSQL, Quản lý công nợ CN1/CN3/CN7, HR Leave, Vòng đời đơn hàng, 717 unit tests) |

> **Ghi chú phiên bản 2.6 (19/09/2026):** Telegram ID được lưu lâu dài tại `app_users.telegram_id` trong Supabase PostgreSQL. Luồng tạo mã liên kết qua tab `_HR_TELEGRAM_LINKS` của Google Sheets tạm ngừng; bot sẽ tích hợp trực tiếp với database ở giai đoạn sau. Các nguồn Google Sheets nghiệp vụ khác không đổi.

# 1. Giới thiệu

## 1.1. Mục đích

Tài liệu này đặc tả chi tiết các yêu cầu chức năng và phi chức năng của hệ thống Website Dashboard TOKOSI, làm cơ sở cho đội phát triển thiết kế, xây dựng, kiểm thử phần mềm. Tài liệu cụ thể hóa các yêu cầu nghiệp vụ đã nêu trong BRD v2.0 thành các đặc tả kỹ thuật có thể triển khai được.

## 1.2. Phạm vi hệ thống

Hệ thống là một Web Application nội bộ gồm các thành phần chính:

1. **Engine đồng bộ KiotViet (Node.js):** `server/kiotvietSync/` nhận webhook KiotViet và polling đối soát tự động, nạp và duy trì toàn bộ dữ liệu bán hàng KiotViet vào database Supabase PostgreSQL.

2. **Web Server (Node.js/Express + HTML frontend):** đọc dữ liệu KiotViet từ Supabase PostgreSQL qua `dashboardPgReader.js`, tab `Trả NCC` từ Google Sheets Kiot HN/SG, workbook `Bảng Công nợ` chỉ đọc (`DEBT_MANAGEMENT_SPREADSHEET_ID`), nguồn vòng đời đơn hàng (`ORDER_LIFECYCLE_SPREADSHEET_ID`) và nhân sự (`HR_SPREADSHEET_ID`) qua Google Sheets API; lưu trạng thái xử lý công nợ và tài khoản người dùng (`app_users`) trong PostgreSQL. Server xác thực người dùng, áp dụng RBAC và `req.branch`, tính KPI/biểu đồ/cảnh báo, xuất Excel và trả frontend qua REST API. Ba kỳ công nợ **CN1 / CN3 / CN7** (1/3/7 ngày, trước đây gọi là HN1/HN3/HN7) đọc từ bảng `customer_debt_activity_periods` làm nguồn đối chiếu nội bộ cho cảnh báo `Chưa thu`.

## 1.3. Định nghĩa & thuật ngữ

| **Thuật ngữ**           | **Giải thích**                                                                        |
|-------------------------|---------------------------------------------------------------------------------------|
| Dashboard               | Trang tổng hợp hiển thị số liệu và biểu đồ từ dữ liệu nguồn.                          |
| KPI Card                | Thẻ hiển thị 1 chỉ số tổng hợp (vd: Doanh thu hôm nay, Tổng tồn kho).               |
| CN1 / CN3 / CN7         | Báo cáo hoạt động công nợ khách hàng 1 ngày, 3 ngày, 7 ngày gần nhất (trước đây gọi là HN1/HN3/HN7), lưu trong bảng `customer_debt_activity_periods` của Supabase PostgreSQL. |
| Spreadsheet nguồn       | Hai file Kiot HN/SG (chỉ đọc `Trả NCC`), workbook `Bảng Công nợ` (`DEBT_MANAGEMENT_SPREADSHEET_ID`), Vòng đời đơn hàng (`ORDER_LIFECYCLE_SPREADSHEET_ID`) và Nhân sự (`HR_SPREADSHEET_ID`). |
| Cơ sở vật lý            | `Hà Nội` hoặc `Sài Gòn` — giá trị duy nhất được phép lưu vào các cột nghiệp vụ (`branch` = `hanoi`/`saigon` trong PostgreSQL). |
| `Cả hai` (BRANCH_BOTH)  | Lựa chọn phạm vi XEM dành cho tài khoản được phép cả hai cơ sở vật lý. `allowedBranches(user)` chỉ trả cơ sở vật lý, `selectableBranches(user)` mới thêm `Cả hai`; `resolveBranchScope('Cả hai')` quy về `['Hà Nội','Sài Gòn']` trước mọi truy vấn dữ liệu. |
| Chữ ký cảnh báo         | SHA-256 của loại cảnh báo và số nợ hiện tại; dùng để vô hiệu trạng thái kết thúc khi khoản nợ thay đổi. |
| Service Account         | Tài khoản dịch vụ Google dùng để backend đọc `Trả NCC` và quản lý Sheets Vòng đời đơn hàng / Nhân sự mà không cần OAuth user. |
| Result Cache            | Cơ chế lưu đệm kết quả KPI/biểu đồ đã tính theo phiên bản dữ liệu thô và bộ lọc.    |
| OTP                     | One-Time Password mã xác thực dùng một lần 6 số dùng để khôi phục mật khẩu.         |
| HR Leave                | Phân hệ quản lý đơn nghỉ phép, tính toán số dư ngày phép theo chính sách CSNS-NP-01. |
| Vòng đời đơn hàng       | Tính năng tra cứu trạng thái đơn hàng theo mã đơn qua Google Sheets.                 |

## 1.4. Tài liệu tham khảo

- BRD v2.0 — Hệ thống Dashboard nội bộ TOKOSI.
- CSNS-NP-01 — Quy định & Chính sách quản lý nghỉ phép nhân sự.
- Supabase PostgreSQL Documentation.
- Google Sheets API v4 Documentation.
- KiotViet Public API Documentation.

# 2. Mô tả tổng quan hệ thống

## 2.1. Kiến trúc tổng quan — Giai đoạn 1 & Phase 0/0.5/1 & HR Module (đã triển khai)

```
```
KiotViet API / Webhook
    |
    | (webhook POST JSON / Polling REST)
    v
Node.js Sync Engine (server/kiotvietSync/ trên Render.com)
    ├── server/kiotviet/webhookEventQueue.js : nhận webhook POST, hàng đợi nền
    ├── server/kiotvietSync/syncDriver.js    : driver đồng bộ entity incremental/full
    ├── server/kiotvietSync/scheduler.js     : polling & đối soát định kỳ
    ├── server/kiotvietSync/customerDebtReportRefresh.js : tổng hợp CN1/CN3/CN7
    └── server/kiotvietSync/dashboardRollupRefresh.js   : rollup theo ngày (5 phút)
    |
    v (UPSERT / Query)
Cơ sở dữ liệu Supabase PostgreSQL
    ├── categories, products, customers, suppliers, staff
    ├── invoices, invoice_details, invoice_payments
    ├── orders, order_details, returns, return_details
    ├── purchases, purchase_details, cash_flows
    ├── daily_invoice_summary, daily_product_sales, daily_purchase_summary, product_first_purchase
    ├── customer_debt_activity_periods (CN1/CN3/CN7)
    ├── app_users, hr_employees, debt_collection_statuses
    └── webhook_events_raw, sync_checkpoints, backfill_progress

Google Sheets (chỉ đọc có chọn lọc qua Google Sheets API v4)
    ├── Kiot HN / SG: chỉ đọc tab `Trả NCC` (dữ liệu nhập thủ công)
    ├── Bảng Công nợ: `DEBT_MANAGEMENT_SPREADSHEET_ID` (Quản lý công nợ)
    ├── Vòng đời đơn hàng: `ORDER_LIFECYCLE_SPREADSHEET_ID` (DonHang_HN, DonHang_SG, Lịch sử cập nhật)
    └── Nhân sự: `HR_SPREADSHEET_ID` (HR_Leaves)

Backend Web Server: Node.js + Express
    - server/index.js                 : khởi động server Express (Gzip, Cache-Control)
    - server/config.js                : đọc biến môi trường (SUPABASE_DB_URL, JWT_SECRET...)
    - server/routes.js                : định nghĩa endpoints & phân quyền middleware
    - server/auth/authMiddleware.js   : requireAuth, requireRole bọc route
    - server/auth/authRoutes.js       : /api/auth/* (register, login, google, profile, otp reset)
    - server/auth/userRepository.js   : đọc/tìm người dùng từ PostgreSQL app_users
    - server/hr/hrLeaveRoutes.js      : /api/hr/leave/* (nộp đơn, tra cứu, duyệt/từ chối, xuất Excel)
    - server/hr/hrLeaveService.js     : nghiệp vụ tính hạn mức và trừ ngày phép
    - server/sheets/sheetsClient.js   : gọi Google Sheets API đọc Trả NCC (cache thô 90s)
    - server/sheets/debtManagementSheetsClient.js : đọc-only Bảng Công nợ HN/SG, cache 90s
    - server/sheets/orderLifecycleSheetsClient.js : đọc/ghi Vòng đời đơn hàng
    - server/dashboard/dashboardPgReader.js : đọc dữ liệu vận hành từ Supabase PostgreSQL
    - server/dashboard/customerDebtActivityRepository.js : đọc CN1/CN3/CN7 từ PostgreSQL
    - server/dashboard/debtManagement.js : parser, đối chiếu cảnh báo, KPI và chữ ký công nợ
    - server/dashboard/debtCollectionStatusRepository.js : trạng thái thu nợ trong PostgreSQL
    - server/dashboard/debtManagementRoutes.js : PATCH trạng thái theo req.branch ("Cả hai" ghi hai cơ sở trong một transaction)
    - server/branch/branches.js       : cơ sở vật lý, phạm vi "Cả hai" và quy đổi nhãn <-> mã branch
    - server/dashboard/exportService.js : dịch vụ lấy danh sách trường và tạo file xuất Excel .xlsx (đọc thẳng PostgreSQL theo mã)
    - server/dashboard/exportFieldCatalog.js : từ điển trường xuất Excel (nhãn tiếng Việt chuẩn hóa, nguồn sự thật duy nhất)
    |
    | REST APIs: /api/auth/*, /api/dashboard, /api/search, /api/export, /api/shipment/*, /api/hr/*
    v
Frontend: HTML/CSS/JS tĩnh (server/public/)
    - server/public/index.html        : Live Dashboard (KPI, biểu đồ, Quản lý công nợ, xuất Excel)
    - server/public/account/index.html: Quản lý tài khoản (Hồ sơ & Quản trị người dùng)
    - server/public/humanresources/   : Cổng thông tin nhân sự (Nộp đơn nghỉ phép, tra cứu, phê duyệt)
    - server/public/login/index.html   : Đăng nhập nội bộ, Google Sign-In & Quên mật khẩu OTP
    - server/public/register/index.html: Đăng ký tài khoản Khách bằng Email
    - server/public/shipment/lifecycle/: Tra cứu vòng đời đơn hàng theo mã đơn
    - server/public/shared/shared-nav.js : Điều hướng dùng chung đa trang & auth guard
    - server/public/js/pagination.js  : Phân trang bảng client-side
    - Chart.js (biểu đồ 2D)
    |
    v
Người dùng (trình duyệt) — tokosi.onrender.com / localhost:3000
```

## 2.2. Stack công nghệ thực tế

### Backend
- **Runtime:** Node.js (>= 18)
- **Framework:** Express.js v4
- **Database:** Supabase PostgreSQL (kết nối pooling & direct qua thư viện `pg`)
- **Dependencies:** `pg`, `googleapis` (Google Sheets API client), `bcryptjs` / `bcrypt`, `jsonwebtoken`, `exceljs` / export builder, `dotenv` (dev only)
- **Entry point:** `server/index.js`
- **Testing:** `node:test` + `node:assert/strict` (717 unit tests tự động)
- **API:** REST; endpoints:
  - Auth: `/api/auth/*` (register, login, google, profile, otp reset, logout)
  - Role Requests & Admin: `/api/role-requests/*`, `/api/admin/users/*`
  - Shipment / Vòng đời đơn hàng: `/api/shipment/order-lifecycle/*`
  - HR Leave: `/api/hr/leave/*`
  - Dashboard & Analytics: `GET /api/dashboard`, `GET /api/search`, `GET /api/customer-product-top`
  - Quản lý công nợ: `PATCH /api/dashboard/debt-management/status`
  - Sync nội bộ: `POST /api/internal/kiotviet-sync/webhook`, `GET /api/internal/kiotviet-sync/status`
  - Export: `POST /api/export/fields`, `POST /api/export`
  - System: `GET /health`, `GET /api/debug`

### Frontend
- **Công nghệ:** HTML5, CSS3 (Vanilla), JavaScript (ES6+)
- **Thư viện biểu đồ:** Chart.js (vendor local tại `server/public/vendor/chart.umd.min.js`)
- **Phân trang:** `server/public/js/pagination.js` (module độc lập, test riêng)
- **File chính:** `server/public/index.html` (single-page, đầy đủ modal xuất Excel, bảng phân trang, dropdown mượt mà)
- **Không dùng:** React, Next.js, TailwindCSS, TypeScript

### Dữ liệu & Caching
- **Nguồn chính:** Supabase PostgreSQL (`SUPABASE_DB_URL`) cho toàn bộ thực thể KiotViet, tài khoản và công nợ CN1/CN3/CN7.
- **Nguồn bổ trợ:** Google Sheets cho `Trả NCC` (`SPREADSHEET_ID`, `SPREADSHEET_ID_SG`), Bảng Công nợ (`DEBT_MANAGEMENT_SPREADSHEET_ID`), Vòng đời đơn hàng (`ORDER_LIFECYCLE_SPREADSHEET_ID`), và Nhân sự (`HR_SPREADSHEET_ID`).
- **Xác thực Google:** Google Service Account JSON (`GOOGLE_SERVICE_ACCOUNT_JSON`).
- **Caching:** Result Cache in-memory theo key `(rawDataVersion, filters)` + Cache thô Sheets 90s cho các tab phụ trợ.

### Hạ tầng & triển khai
- **Hosting:** Render.com (Web Service)
- **Domain:** `tokosi.onrender.com`
- **CI/CD:** tự động deploy khi push lên branch `main` của GitHub repo
- **Biến môi trường:** cấu hình trực tiếp trên Render dashboard

### Sync Engine KiotViet
- **Vị trí:** `server/kiotvietSync/` và `server/kiotviet/`
- **Cơ chế:** Webhook KiotViet đẩy trực tiếp vào server (xử lý qua queue nền) + Polling/scheduler đối soát mỗi 5-15 phút.
- **Dữ liệu công nợ:** Job `customerDebtReportRefresh.js` tự động tính và ghi ba kỳ CN1/CN3/CN7 vào `customer_debt_activity_periods`.

## 2.3. Đối tượng người dùng

| **Vai trò**  | **Mô tả**                                                              |
|--------------|------------------------------------------------------------------------|
| Người xem    | Mọi người dùng nội bộ có URL — xem KPI, lọc thời gian, phân trang, xuất Excel, làm mới dữ liệu. |
| Quản lý / Trợ lý | Toàn quyền xem và cập nhật trạng thái xử lý Quản lý công nợ, duyệt nghỉ phép HR. |
| IT Admin     | Cấu hình biến môi trường Render, quản trị database và tài khoản hệ thống. |

## 2.4. Giả định & phụ thuộc

- Database Supabase PostgreSQL hoạt động ổn định với schema chuẩn hóa `0001` đến `0015`.
- Service Account Google được cấp quyền Viewer trên Sheets Kiot HN/SG (để đọc `Trả NCC`) và quyền truy cập các file Vòng đời đơn hàng, HR.
- Webhook KiotViet đang hoạt động và trỏ đúng endpoint server `/api/internal/kiotviet-sync/webhook`.
- Render.com có đầy đủ biến môi trường kết nối database và credentials KiotViet.

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
| FR-01.8 | Workbook công nợ dùng `DEBT_MANAGEMENT_SPREADSHEET_ID`, ánh xạ Hà Nội → `Công nợ HN`, Sài Gòn → `Công nợ SG`; service account chỉ cần Viewer. | Cao | Hoàn thành |
| FR-01.9 | Nguồn vận hành và workbook công nợ tải song song, cache riêng 90 giây; cache key kết quả chứa phiên bản của cả hai nguồn và cơ sở. | Cao | Hoàn thành |
| FR-01.10 | Lỗi workbook công nợ không làm sập phần dashboard khác; lỗi PostgreSQL không tắt cảnh báo tự động nhưng khóa sửa trạng thái. | Cao | Hoàn thành |

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
| FR-03.8 | Tạo `periodOrders`, `periodReturns` (toàn bộ trong khoảng lọc) và `recentPurchaseOrders` (8 bản ghi gần nhất), sort theo thời gian giảm dần.                  | Cao         | Hoàn thành     |
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

## 3.6. FR-06: Node.js Sync Engine — Đồng bộ KiotViet tự động vào Supabase PostgreSQL

| **Mã**  | **Mô tả**                                                                                                                                                                     | **Ưu tiên** | **Trạng thái** |
|---------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------|----------------|
| FR-06.1 | `preflightCheck` & `backfill.js`: Kiểm tra kết nối API KiotViet và database, đồng bộ toàn bộ dữ liệu lịch sử vào Supabase PostgreSQL cho cả hai cơ sở Hà Nội và Sài Gòn. | Cao | Hoàn thành |
| FR-06.2 | `POST /api/internal/kiotviet-sync/webhook`: Nhận webhook POST từ KiotViet, phản hồi `HTTP 200` tức thì và đưa vào hàng đợi nền `webhookEventQueue.js` để upsert/delete vào database mà không nghẽn luồng. | Cao | Hoàn thành |
| FR-06.3 | `scheduler.js` & `syncDriver.js`: Lập lịch polling đối soát định kỳ mỗi 5-15 phút, cập nhật checkpoint tăng dần `lastModifiedFrom` và bù đắp các bản ghi bị sót. | Cao | Hoàn thành |
| FR-06.4 | Cấu hình đăng ký webhook KiotViet trỏ về endpoint của server trên Render, phân biệt cơ sở bằng thông tin gian hàng trong payload. | Cao | Hoàn thành |
| FR-06.5 | Retry tự động (exponential backoff) khi gọi KiotViet API bị lỗi tạm thời (429/5xx/network error). | Cao | Hoàn thành |
| FR-06.6 | `dashboardRollupRefresh.js`: Tự động tổng hợp 4 bảng rollup theo ngày (`daily_invoice_summary`, `daily_product_sales`, `daily_purchase_summary`, `product_first_purchase`) mỗi 5 phút để phục vụ KPI dashboard tức thì. | Cao | Hoàn thành |
| FR-06.12 | `customerDebtReportRefresh.js`: Tự động tính toán khách hàng có giao dịch trong 1/3/7 ngày gần nhất và ghi vào bảng `customer_debt_activity_periods` (**CN1 / CN3 / CN7**, trước đây gọi là HN1/HN3/HN7) gần 15:00 hàng ngày để phục vụ cảnh báo "Chưa thu" trên màn hình Quản lý công nợ. | Cao | Hoàn thành |


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
| FR-07.10 | Mỗi bảng dữ liệu có nút `Xuất Excel`; file giữ bộ lọc/sort hiện tại và bỏ giới hạn phân trang (danh sách mã dòng lấy từ kết quả dashboard đã cache, cột dữ liệu gốc đọc thẳng từ Supabase PostgreSQL theo các mã đó, không đọc Google Sheets). Riêng Quản lý công nợ mặc định chọn 10 cột hiển thị và cho chọn thêm Người cập nhật/Cập nhật lúc. | Cao | Hoàn thành |
| FR-07.11 | Kết quả tìm kiếm ngoài Tổng quan được xuất Excel; kết quả nhiều nguồn tạo một worksheet cho mỗi nguồn và tự lấy toàn bộ trường. Tìm kiếm Tổng quan không hỗ trợ xuất do trộn nhiều loại dữ liệu. | Cao | Hoàn thành |
| FR-07.12 | Xuất Nhập hàng giữ worksheet tổng hợp/chi tiết; Quản lý công nợ xuất một worksheet `Công nợ HN` hoặc `Công nợ SG`, giữ tiền/tỷ lệ ở kiểu số, cố định header, bật AutoFilter và trung hòa chuỗi công thức. | Cao | Hoàn thành |
| FR-07.13 | Bảng tất cả hàng hóa (`allProducts`) và bảng hàng đã hết (`lowStock`) được phân trang client-side qua `pagination.js` (~200 dòng/trang), có điều khiển Trang trước / Trang sau, giữ nguyên thẻ đếm tổng số lượng. | Cao | Hoàn thành |
| FR-07.14 | Biểu đồ Chart.js có animation gating (không animate lại khi chuyển tab, đổi theme hay background polling); các phần tử dropdown, surface theme và dòng chi tiết công nợ có transition mượt mà dùng chung token `--ease-out`. | Cao | Hoàn thành |
| FR-07.15 | `POST /api/export/fields` với các bảng cố định trả danh sách worksheet và trường ngay từ từ điển tĩnh (`rowCount = null`, mỗi trường có `description` hiển thị dạng tooltip), không gọi `getDashboardData`, không đọc PostgreSQL/Google Sheets. Riêng `search.results` (worksheet phụ thuộc kết quả tìm kiếm) vẫn chạy tìm kiếm thật và trả `rowCount` là số dòng thực. | Cao | Hoàn thành |
| FR-07.16 | `POST /api/export` lấy danh sách mã dòng từ `dashboardData.getDashboardData()` (kết quả cache, chỉ nạp 7 tab lõi), đọc cột gốc bằng `dashboardPgReader.readRowsByCodes(tab, cơ sở, mã)` chỉ cho các mã đó rồi ghi bằng ExcelJS. Chỉ 7 nguồn được phép (Hàng hóa, Hóa đơn, Đặt hàng, Trả hàng, Khách hàng, Nhà cung cấp, Nhập hàng); nguồn khác bị từ chối `400 EXPORT_SOURCE_NOT_ALLOWED`. Mã khớp chính xác, trùng bị loại, danh sách rỗng thì không truy vấn, hơn 20.000 mã được chia lô 5.000 mã chạy tuần tự. | Cao | Hoàn thành |
| FR-07.17 | Modal Xuất Excel hủy được mọi lúc (nút X, nút Hủy, phím Esc, bấm nền) bằng `AbortController`; danh sách trường timeout 30 giây, tạo file timeout 180 giây, hết giờ hoặc lỗi thì hiện thông báo tiếng Việt cùng nút `Thử lại` lặp lại đúng bước vừa lỗi; phản hồi trễ của yêu cầu cũ (đã đóng, mở lại, thử lại) bị bỏ qua. Khi trình duyệt ngắt kết nối, máy chủ hủy việc đang làm và nhả chỗ xuất file. | Cao | Hoàn thành |
| FR-07.18 | Nhãn trường tiếng Việt chuẩn hóa: có dấu, không dùng tên biến tiếng Anh/`snake_case`, không viết tắt (Số lượng, Doanh số, Khách hàng, Nhà cung cấp, Tháng...), cùng khái niệm dùng cùng một nhãn ở mọi nguồn, nhãn tối đa 40 ký tự và duy nhất trong một worksheet. Quy ước áp dụng cho cả cột dữ liệu gốc, cột dashboard tính thêm và cột bảng tổng hợp. Từ điển nằm tại `server/dashboard/exportFieldCatalog.js` và là nguồn sự thật duy nhất cho nhãn/kiểu/mô tả trường của 7 nguồn PostgreSQL; cột dashboard tính thêm không thuộc từ điển này mà được khai báo trong `exportService.js`. | Cao | Hoàn thành |

## 3.8. FR-08: Đăng ký, Google Guest, Quản trị tài khoản & Tra cứu vận chuyển

| **Mã** | **Mô tả** | **Ưu tiên** | **Trạng thái** |
|--------|-----------|-------------|----------------|
| FR-08.1 | Form đăng ký riêng nhận họ tên, email và mật khẩu; mật khẩu được băm bcrypt, tài khoản `Khách` hoạt động và tự đăng nhập ngay. | Cao | Hoàn thành |
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
| FR-10.3 | Bot dùng luồng nhập ngày và buổi, khôi phục được `startDate`/`endDate` sau restart và chống xử lý trùng theo `chatId:messageId`. | Cao | Tạm ngừng tích hợp |
| FR-10.4 | Thời gian gửi sau 07:45 đối với buổi Sáng hoặc 12:30 đối với buổi Chiều được cảnh báo; nếu vẫn xác nhận, đơn được lưu với trạng thái `Vi phạm`. | Cao | Hoàn thành |
| FR-10.5 | Tab Nghỉ phép hiển thị cột Thời gian gửi; bộ lọc `from`/`to` lọc theo trường này và mặc định 3 ngày gần đây. | Cao | Hoàn thành |
| FR-10.6 | Telegram ID lưu ở `app_users.telegram_id` trong PostgreSQL, duy nhất giữa các tài khoản chưa xoá; API tạo mã cũ không được đọc/ghi `_HR_TELEGRAM_LINKS`. | Cao | Hoàn thành |

## 3.11. FR-11: Quản lý công nợ

| **Mã** | **Mô tả** | **Ưu tiên** | **Trạng thái** |
|---|---|---|---|
| FR-11.1 | Parse workbook công nợ theo header/alias, bỏ hàng tổng số 2, giữ `null` cho ô trống/`#N/A`, hỗ trợ số và phần trăm Việt Nam. | Cao | Hoàn thành |
| FR-11.2 | Ghép khách với CN1/CN3/CN7 bằng tên chuẩn hóa Unicode/khoảng trắng/hoa thường, không fuzzy matching; tên trùng bị đánh `Lỗi dữ liệu` và khóa sửa trạng thái. | Cao | Hoàn thành |
| FR-11.3 | Lịch 1/3 tạo cảnh báo `Chưa thu` theo ma trận đối chiếu; mọi lịch tạo `Quá hạn` khi nợ quá hạn dương; chỉ miễn cảnh báo khi cả nợ hiện tại và nợ quá hạn đều dưới 400.000đ. | Cao | Hoàn thành |
| FR-11.4 | Thiếu bất kỳ CN1/CN3/CN7 sẽ tắt riêng cảnh báo `Chưa thu`; cảnh báo `Quá hạn` vẫn hoạt động. | Cao | Hoàn thành |
| FR-11.5 | Dashboard gồm 4 KPI, biểu đồ theo sale/lịch, top nợ hiện tại/quá hạn, bảng 10 cột; hỗ trợ lọc, tìm, click biểu đồ, sort ba trạng thái và phân trang 100 dòng. | Cao | Hoàn thành |
| FR-11.6 | Trạng thái `Chưa xử lý/Đang xử lý/Đã xử lý/Bỏ qua` lưu theo `(branch, customer_key)`; Đã xử lý/Bỏ qua rời hàng chờ và tự hết hiệu lực khi chữ ký cảnh báo thay đổi. | Cao | Hoàn thành |
| FR-11.7 | Chỉ Quản lý/Trợ lý được PATCH trạng thái. Cơ sở lấy từ `req.branch`, không nhận từ payload client; các vai trò khác chỉ thấy pill đọc-only. | Cao | Hoàn thành |
| FR-11.8 | Ở phạm vi `Cả hai`, một PATCH ghi trạng thái cho cả hai cơ sở vật lý trong đúng một transaction PostgreSQL (xem FR-12.6). | Cao | Hoàn thành |

## 3.12. FR-12: Phạm vi dữ liệu "Cả hai" cơ sở

| **Mã** | **Mô tả** | **Ưu tiên** | **Trạng thái** |
|---|---|---|---|
| FR-12.1 | `Cả hai` chỉ xuất hiện trong `selectableBranches(user)` khi tài khoản được phép **cả** `Hà Nội` và `Sài Gòn`; `allowedBranches(user)` luôn chỉ trả cơ sở vật lý và là ranh giới phân quyền đọc/ghi. `POST /api/branch` từ chối giá trị không nằm trong danh sách chọn được. | Cao | Hoàn thành |
| FR-12.2 | Mọi lớp truy vấn dữ liệu nhận cơ sở vật lý: route quy `req.branch` qua `resolveBranchScope` trước khi gọi repository/sheets. `branchLabelToCode('Cả hai')` trả chuỗi rỗng nên không route nào được truyền thẳng `req.branch` xuống cột `branch`; `Cả hai`/`both` không bao giờ được ghi vào database. | Cao | Hoàn thành |
| FR-12.3 | `GET /api/dashboard` ở `Cả hai` cộng KPI/bucket của hai cơ sở, gộp thực thể trùng mã theo mã (cộng số lượng/công nợ, giá vốn bình quân theo tồn, lấy tên thật đầu tiên HN→SG) rồi mới xếp hạng; giao dịch riêng lẻ giữ khóa `(cơ sở, mã)` kèm nhãn cơ sở. Cache kết quả `Cả hai` có khóa chứa phiên bản nguồn của **cả hai** cơ sở. | Cao | Hoàn thành |
| FR-12.4 | `/api/search`, `/api/customer-product-top`, `/api/customer-product-revenue`, `/api/product-revenue-search`, `/api/product-revenue-detail` ở `Cả hai` chạy trên dữ liệu đã gộp theo cùng quy tắc; phản hồi ở cơ sở vật lý giữ nguyên hình dạng cũ, chế độ gộp chỉ **thêm** trường (`branch` cho dòng giao dịch, `branchDetails` cho chi tiết hàng hóa). | Cao | Hoàn thành |
| FR-12.5 | Xuất Excel ở `Cả hai` thêm cột `Cơ sở` cho các worksheet giao dịch và kết quả tìm kiếm, ghép dữ liệu theo `(cơ sở, mã)`, dùng tiền tố tên file `TKS_`. Bảng Quản lý công nợ lọc/sắp xếp trên **dòng gộp** rồi mới tách một dòng cho mỗi cơ sở của khách hàng. | Cao | Hoàn thành |
| FR-12.6 | PATCH trạng thái công nợ ở `Cả hai` ghi cùng `(customer_key, trạng thái, chữ ký)` cho **mọi cơ sở vật lý trong phạm vi** bằng một transaction (`BEGIN`/`COMMIT`, lỗi bất kỳ → `ROLLBACK` toàn bộ). Chỉ ghi cơ sở thực sự có khách hàng trong nguồn công nợ; không cơ sở nào có → `404 DEBT_CUSTOMER_NOT_FOUND`; cơ sở không đọc được nguồn vẫn được ghi để hai cơ sở không lệch trạng thái. Cache workflow/dashboard của từng cơ sở chỉ bị xóa **sau** khi COMMIT thành công. | Cao | Hoàn thành |
| FR-12.7 | HR đọc theo `allowedBranches` nên tài khoản `Cả hai` thấy cả hai cơ sở kèm cột `Cơ sở` và bộ lọc cơ sở; ghi nhận đơn nghỉ phép ở `Cả hai` suy cơ sở từ hồ sơ nhân sự, không suy được hoặc trùng tên ở hai cơ sở → `400 LEAVE_BRANCH_UNRESOLVED`. SSE và thông báo dùng cơ sở vật lý của bản ghi. | Cao | Hoàn thành |
| FR-12.8 | Quét đứt hàng ở `Cả hai` chạy tuần tự hai cơ sở như job con rồi gộp kết quả (mỗi dòng kèm cơ sở, cảnh báo ghi rõ cơ sở); một cơ sở lỗi thì job cha báo lỗi, không trả kết quả một nửa. `/api/debug` đếm gộp hai cơ sở bằng `branch = ANY($1::text[])`. | Trung bình | Hoàn thành |

**Giới hạn đã biết của FR-12:** (a) dòng công nợ gộp hiển thị trạng thái và chữ ký cảnh báo của cơ sở xuất hiện trước (Hà Nội trước Sài Gòn) — ghi trạng thái ở `Cả hai` lưu chữ ký của dòng gộp cho cả hai cơ sở, nên khi xem riêng một cơ sở, trạng thái kết thúc có thể bị coi là hết hiệu lực nếu chữ ký của cơ sở đó khác; (b) quét đứt hàng ở `Cả hai` tốn gấp đôi thời gian và hạn mức Google Sheets.

# 4. Yêu cầu phi chức năng (Non-functional Requirements)

| **Mã** | **Hạng mục**         | **Mô tả yêu cầu**                                                                                                                               |
|--------|----------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| NFR-01 | Hiệu năng            | API `/api/dashboard` phản hồi < 10ms khi cache hit (Result Cache); phản hồi trong vòng 5 giây khi phải gọi Google Sheets API (`batchGet`).     |
| NFR-02 | Khả dụng             | Hệ thống hoạt động ổn định trên Render.com, mục tiêu uptime >= 99% trong giờ hành chính.                                                        |
| NFR-03 | Bảo mật              | Toàn bộ giao tiếp qua HTTPS; Service Account key và Spreadsheet ID lưu trong biến môi trường; cơ sở lấy từ session; workbook công nợ chỉ cấp Viewer. |
| NFR-04 | Khả năng mở rộng     | Kiến trúc module rõ ràng (config, sheets, dashboard, routes) cho phép bổ sung module mới mà không phải rewrite code hiện tại.                    |
| NFR-05 | Usability            | Giao diện trực quan, thao tác lọc thời gian và làm mới trong 1–2 cú nhấp chuột; bảng lớn chuyển trang tức thì không đơ UI; hỗ trợ desktop/tablet.|
| NFR-06 | Bảo trì              | Mã nguồn tổ chức theo module rõ ràng, comment tiếng Việt, dễ đọc và bảo trì.                                                                   |
| NFR-07 | Giới hạn API         | Nguồn vận hành dùng một `batchGet`; workbook công nợ dùng request read-only riêng. Hai nguồn tải song song, cache 90 giây và có version độc lập. |
| NFR-08 | Nhật ký & debug      | Log chi tiết lỗi khi `/api/dashboard` thất bại; `/api/debug` kiểm tra kết nối và trả danh sách tab hiện có mà không lộ secret.                   |
| NFR-09 | Độ trễ đồng bộ       | Từ khi dữ liệu thay đổi trên KiotViet → Apps Script cập nhật Sheets qua webhook: mục tiêu dưới 2 phút. Nhập hàng mới/sửa trong 7 ngày: tối đa 5 phút; Trả hàng/NCC và đối soát toàn lịch sử: 15 phút + thời gian backfill. |
| NFR-10 | Nhất quán thời gian  | Parse ngày từ Sheets, xác định ngày hiện tại, tạo bucket 7/30/90 ngày và format `updatedAt` theo Asia/Ho_Chi_Minh, độc lập timezone máy chủ.      |
| NFR-11 | An toàn xuất dữ liệu | API xuất chỉ nhận khóa bảng, bộ lọc và danh sách trường hợp lệ (`columns`: khóa worksheet -> danh sách khóa trường); chặn bảng lạ (`EXPORT_TABLE_NOT_ALLOWED`) và trường lạ (`EXPORT_FIELD_NOT_ALLOWED`), kiểm tra hợp lệ trước khi nạp dữ liệu, mã truyền vào SQL bằng tham số và vô hiệu hóa chuỗi có thể bị Excel hiểu là công thức. Hai bảng đứt hàng nhận kết quả quét do client gửi nhưng chỉ ghi các cột khai báo sẵn. |
| NFR-12 | Kiểm thử tự động     | Duy trì bộ `node:test` bao phủ parser/cảnh báo/workflow/export công nợ, HR, auth, vận chuyển, cache, phân trang, đồng bộ và frontend; migration integration chỉ chạy với `SUPABASE_TEST_DB_URL` tách biệt. |
| NFR-13 | Tải xuất Excel | Tối đa 2 file xuất chạy đồng thời và tối đa 8 yêu cầu xếp hàng chờ; vượt trần trả `503 EXPORT_BUSY`. Yêu cầu bị hủy khi đang chờ thì bị bỏ khỏi hàng đợi, chỗ xuất file luôn được nhả kể cả khi lỗi. Mỗi lần xuất chỉ đọc PostgreSQL theo mã của các dòng cần xuất, không nạp toàn bộ 9 tab như luồng cũ, để không chiếm hết pool kết nối và bộ nhớ của các API khác. |
| NFR-14 | Độ trễ lấy danh sách trường | Với bảng cố định, `POST /api/export/fields` phải trả dưới 1 giây vì không thực hiện truy vấn nặng (không `getDashboardData`, không `readRowsByCodes`, không tìm kiếm); có test đếm số lần gọi bằng 0. |
| NFR-15 | Chuẩn nhãn trường xuất | Nhãn trường tiếng Việt chuẩn hóa theo FR-07.18; việc dùng viết tắt, tên biến tiếng Anh hoặc `snake_case` trong nhãn/mô tả bị test tự động (`exportFieldCatalog.test.js`, `exportService.test.js`) chặn. |


# 5. Yêu cầu giao diện người dùng (UI Requirements)

## 5.1. Bố cục tổng thể

Giao diện Dashboard gồm:
- **Sidebar (trái):** logo, danh sách mục điều hướng, có thể thu gọn.
- **Header (trên):** tên trang, timestamp cập nhật theo giờ Việt Nam, bộ lọc thời gian (7/30/90 ngày), nút "Làm mới".
- **Khu vực KPI cards:** dãy thẻ số liệu tổng quan.
- **Khu vực biểu đồ & bảng:** biểu đồ doanh thu theo ngày, bảng top sản phẩm, hàng đã hết, công nợ, đơn hàng gần nhất.
- **Quản lý công nợ:** 4 KPI, biểu đồ sale/lịch thanh toán, top 10 nợ hiện tại/quá hạn và bảng thao tác 10 cột; mặc định lọc `Cần xử lý`, hỗ trợ keyboard focus, Light/Dark và reduced motion.

## 5.2. Trạng thái giao diện cần xử lý

- **Loading:** hiển thị spinner/text "Đang tải dữ liệu..." khi đang gọi API lần đầu.
- **Đang làm mới:** hiển thị trạng thái loading cục bộ khi nhấn "Làm mới".
- **Làm mới nền:** tự tải mỗi 10 phút và khi quay lại tab đã ẩn quá một chu kỳ; không che giao diện bằng loading veil.
- **Lỗi API:** hiển thị thông báo lỗi rõ ràng (alert hoặc toast), kèm nội dung lỗi từ server.
- **Dữ liệu trống:** hiển thị trạng thái empty state nếu tab không có dữ liệu hoặc không tồn tại; các section khác vẫn hoạt động.
- **Khách:** chỉ hiển thị mục Quản lý vận chuyển; bảng kết quả mặc định trống và trở lại trống khi xóa danh sách mã.

# 6. Đặc tả API

## 6.1. GET /api/dashboard

**Mô tả:** Tải song song nguồn vận hành của cơ sở đang chọn và workbook công nợ dùng chung, rồi tính KPI, biểu đồ và cảnh báo. Cơ sở lấy từ middleware/session. Tab vận hành bị thiếu được xử lý fail-soft; lỗi workbook chỉ làm `debtManagement.available=false`, không làm hỏng các phần dashboard khác.

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
  "periodOrders": [{ "code": "", "date": "", "customer": "", "total": 0, "status": "" }],
  "periodReturns": [{ "code": "", "date": "", "originalInvoiceCode": "", "customer": "", "total": 0, "status": "" }],
  "suppliers": [{ "code": "", "name": "", "phone": "", "email": "", "address": "", "debt": 0 }],
  "recentPurchaseOrders": [{ "code": "", "date": "", "supplier": "", "branch": "", "total": 0, "status": "" }],
  "debtManagement": {
    "available": true,
    "sourceSheet": "Công nợ HN",
    "dataWarnings": [],
    "kpi": {
      "totalCurrentDebt": 0,
      "totalOverdueDebt": 0,
      "actionCustomerCount": 0,
      "overdueToSalesRatio": 0
    },
    "bySale": [],
    "byPaymentSchedule": [],
    "topCurrentDebt": [],
    "topOverdueDebt": [],
    "customers": [{
      "customerKey": "",
      "customerName": "",
      "sale": "Chưa xác định",
      "paymentSchedule": "1",
      "openingDebt": 0,
      "currentDebt": 0,
      "overdueDebt": 0,
      "currentDebtToSalesRatio": null,
      "overdueToSalesRatio": null,
      "alertCodes": ["uncollected", "overdue"],
      "dataIssues": [],
      "workflowStatus": "Chưa xử lý",
      "needsAction": true,
      "canEditStatus": true,
      "alertSignature": "",
      "updatedBy": "",
      "updatedAt": null
    }]
  }
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

**Mô tả:** Trả danh sách worksheet và trường có thể chọn để xuất Excel cho một bảng dữ liệu hoặc kết quả tìm kiếm. Với các bảng cố định, dữ liệu trả **ngay** từ từ điển tĩnh (`exportFieldCatalog.js` cùng cột dashboard tính thêm trong `exportService.js`): không gọi `getDashboardData`, không đọc PostgreSQL hay Google Sheets, nên `rowCount` luôn là `null`. Chỉ `tableKey = "search.results"` chạy tìm kiếm thật để biết các nguồn/worksheet và trả `rowCount` là số dòng thực. Yêu cầu sai (bảng lạ, thiếu khách/từ khóa...) vẫn bị từ chối ngay ở bước này.

**Quyền:** đã đăng nhập bằng tài khoản nội bộ (cùng nhóm vai trò với các API dashboard); cơ sở lấy từ session.

**Body (JSON):** `tableKey` (bắt buộc, một trong các khóa như `products.all`, `invoices.orders`, `debt.management`, `search.results`...), `filters` (bộ lọc kỳ của các tab), `context` (nhóm cha, bộ lọc công nợ, khách/hàng đang xem...), `tableSearch` (tìm kiếm trong bảng, nếu có) và `search` (chỉ với `search.results`).
```json
{
  "tableKey": "products.all",
  "filters": { "products": { "mode": "days", "days": 30, "status": "all" } },
  "context": {}
}
```

**Response (HTTP 200):**
```json
{
  "tableKey": "products.all",
  "title": "Tất cả mã hàng",
  "selectionMode": "custom",
  "worksheets": [
    {
      "key": "all_products",
      "name": "Tất cả mã hàng",
      "rowCount": null,
      "fields": [
        {
          "key": "ma_hang",
          "label": "Mã hàng",
          "type": "text",
          "description": "Mã hàng hiển thị trên KiotViet, dùng để tra cứu và ghép với hóa đơn, phiếu nhập.",
          "selected": true
        }
      ]
    }
  ]
}
```

- `selectionMode`: `custom` (người dùng chọn trường) hoặc `all-only` (kết quả tìm kiếm nhiều nguồn: modal tự xuất toàn bộ trường, mỗi nguồn một worksheet).
- `fields[].key` là khóa để gửi lại trong `columns` của `POST /api/export`; `type` là `text | number | date | percent | general`; `description` có thể vắng và được modal hiển thị dạng tooltip; `selected` là lựa chọn mặc định.
- Nhãn `label` theo quy ước chuẩn hóa ở FR-07.18. Mỗi bảng cố định có một hoặc nhiều worksheet gồm các trường của nguồn PostgreSQL tương ứng theo từ điển, cộng cột dashboard tính thêm (ví dụ `Số lượng bán`, `Doanh thu`) nếu có.

**Lỗi:** HTTP `400` với `EXPORT_TABLE_NOT_ALLOWED`, `EXPORT_NO_CUSTOMER_SELECTED`, `EXPORT_NO_QUERY`, `EXPORT_OVERVIEW_SEARCH_DISABLED`...; `EXPORT_NO_DATA` (`400` khi bảng đứt hàng chưa có kết quả quét, `404` khi tìm kiếm hoặc bộ lọc không còn dòng nào). Body lỗi có `error`, `detail`, `code`.

## 6.7. POST /api/export

**Mô tả:** Nhận khóa bảng, bộ lọc/ngữ cảnh và danh sách trường đã chọn, tạo file `.xlsx` định dạng hoàn chỉnh (cố định hàng tiêu đề, bật AutoFilter, ép kiểu text cho mã/SĐT, trung hòa chuỗi công thức). Luồng dữ liệu **không còn đọc Google Sheets**:

1. Kiểm tra hợp lệ (bảng, trường, `columns`) trước khi xin chỗ xuất file; yêu cầu sai không chiếm hàng đợi và không chạm cơ sở dữ liệu.
2. Xin một trong tối đa 2 chỗ xuất file đồng thời (hàng đợi tối đa 8, vượt trần trả `503 EXPORT_BUSY`, xem NFR-13).
3. Lấy danh sách mã dòng logic (đã lọc/xếp hạng) từ `dashboardData.getDashboardData()` — kết quả cache 90 giây, chỉ nạp 7 tab lõi.
4. Với bảng có nguồn PostgreSQL, gọi `dashboardPgReader.readRowsByCodes(tab, cơ sở, mã)` để đọc thẳng Supabase PostgreSQL chỉ các dòng có mã đang hiển thị, ghép theo mã và cắt theo cột đã chọn. Bảng tổng hợp (công nợ, nhóm hàng, bảng theo khách...) dùng trực tiếp dữ liệu dashboard đã tính; bảng đứt hàng dùng kết quả quét do client gửi lên.
5. Ghi workbook bằng ExcelJS và trả file. Nếu client ngắt kết nối hoặc hủy, tiến trình dừng sau bước đang chạy và nhả chỗ xuất file.

Tìm kiếm trong bảng (`tableSearch`) được áp dụng lên dữ liệu đầy đủ cột rồi mới cắt cột đã chọn; kết quả tìm kiếm ngoài Tổng quan (`search.results`) dùng chính dữ liệu tìm kiếm và không cần gửi `columns` khi có nhiều nguồn.

**Body (JSON):**
```json
{
  "tableKey": "products.all",
  "filters": { "products": { "mode": "days", "days": 30, "status": "all" } },
  "context": {},
  "columns": {
    "all_products": ["ma_hang", "ten_hang", "nhom_hang"]
  }
}
```
`columns` là ánh xạ khóa worksheet (`worksheets[].key` ở 6.6) -> danh sách khóa trường; khóa lạ bị từ chối `400 EXPORT_FIELD_NOT_ALLOWED`, thiếu worksheet `400 EXPORT_FIELDS_REQUIRED`, không chọn trường nào `400 EXPORT_NO_FIELDS_SELECTED`.

**Response (HTTP 200):** Binary stream file `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` kèm header `Content-Disposition: attachment; filename="..."` (tên file dạng `<HN|SG|TKS>_<tên bảng không dấu>_<yyyymmdd_hhmm>.xlsx`). Lỗi trả JSON `error`, `detail`, `code`: `400` (yêu cầu sai), `404 EXPORT_NO_DATA`, `503 EXPORT_BUSY`, `499 EXPORT_ABORTED` (yêu cầu đã hủy, thường client không nhận được body).

## 6.7a. PATCH /api/debt-management/status

**Quyền:** chỉ `Quản lý` và `Trợ lý`. Cơ sở luôn lấy từ session (`req.branch`).

**Body (JSON):**
```json
{
  "customerKey": "khach-hang-da-chuan-hoa",
  "status": "Đang xử lý",
  "alertSignature": "64-ky-tu-hex"
}
```

Endpoint upsert theo `(branch, customer_key)`, từ chối status/chữ ký/khóa không hợp lệ và trả `503` nếu PostgreSQL không sẵn sàng. Body không có và không được phép quyết định cơ sở.

**Ở một cơ sở vật lý:** một lệnh upsert, phản hồi `{ customerKey, status, alertSignature, updatedBy, updatedAt }` — không đổi so với trước.

**Ở phạm vi `Cả hai`** (xem FR-12.6):
- Server hỏi nguồn công nợ của từng cơ sở vật lý xem `customerKey` có tồn tại không (dùng lại cache workbook của dashboard). Cơ sở có khách → ghi; cơ sở **không đọc được** workbook → vẫn ghi (không âm thầm bỏ sót); không cơ sở nào có khách → `404` `{ "code": "DEBT_CUSTOMER_NOT_FOUND" }`.
- Toàn bộ upsert nằm trong **một transaction** (`BEGIN` → upsert từng cơ sở → `COMMIT`; lỗi bất kỳ → `ROLLBACK` và trả `503 DEBT_STATUS_UNAVAILABLE`). Cột `branch` chỉ nhận `hanoi`/`saigon` — repository ném lỗi với mọi mã khác nên `Cả hai`/`both` không thể xuống database.
- Cache `invalidateDebtWorkflowCache` được gọi cho **từng cơ sở đã ghi** và chỉ **sau khi COMMIT**; khóa cache kết quả `Cả hai` chứa phiên bản workflow của cả hai cơ sở nên bản tổng hợp cũng tươi lại.
- Phản hồi giữ nguyên hình dạng cũ, **thêm** `branches` — danh sách nhãn cơ sở đã được ghi, ví dụ `["Hà Nội", "Sài Gòn"]`.

## 6.8. API xác thực & Hồ sơ cá nhân

- `POST /api/auth/register`: nhận `{ "hoTen": "...", "email": "...", "password": "..." }`; chỉ chấp nhận đăng ký trực tiếp bằng email, tạo tài khoản `Khách`, cookie JWT và trả user với HTTP 201.
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

## 7.5. Dữ liệu công nợ CN1/CN3/CN7 trong database (Supabase PostgreSQL)

- Scheduler job `server/kiotvietSync/customerDebtReportRefresh.js` tính toán khách hàng có phát sinh giao dịch trong 1/3/7 ngày gần nhất (CN1/CN3/CN7, trước đây gọi là HN1/HN3/HN7) trực tiếp từ database PostgreSQL (`invoices`, `returns`, `cash_flows`, `customers`).
- Kết quả được ghi vào bảng `customer_debt_activity_periods` gần 15:00 hàng ngày hoặc khi chạy tác vụ làm mới.
- Dashboard đọc dữ liệu này qua `customerDebtActivityRepository.js` để làm nguồn đối chiếu cảnh báo "Chưa thu" trên màn hình Quản lý công nợ, hoàn toàn không phụ thuộc Google Sheets.

## 7.6. Cơ chế Webhook KiotViet & Polling Sync Engine

- Endpoint nhận webhook: `POST /api/internal/kiotviet-sync/webhook` nhận sự kiện trực tiếp từ KiotViet API, phản hồi `HTTP 200` tức thì và xử lý nền qua `webhookEventQueue.js`.
- KiotViet đăng ký webhook cho các loại: `product.update`, `product.delete`, `stock.update`, `customer.update`, `customer.delete`, `invoice.update`, `order.update`, `category.update`, `category.delete`.
- KiotViet không có webhook cho Trả hàng, Nhà cung cấp, Nhập hàng: scheduler `server/kiotvietSync/scheduler.js` chạy polling đối soát định kỳ mỗi 5-15 phút để đảm bảo toàn vẹn dữ liệu.
- Apps Script cũ (`src-dashboard`) đã được gỡ bỏ hoàn toàn.

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
| Giao diện, Phân trang & Xuất Excel (5.3, 5.4, 5.5) | FR-07.1 → FR-07.18        |
| Đăng ký, Google Guest, Quản trị tài khoản & tra cứu vận chuyển | FR-08.1 → FR-08.7 |
| Nghỉ phép theo buổi & Telegram Bot | FR-10.1 → FR-10.5 |
| Quản lý công nợ theo cơ sở | FR-11.1 → FR-11.8 |
| Phạm vi dữ liệu theo cơ sở — Hà Nội / Sài Gòn / Cả hai (5.7) | FR-12.1 → FR-12.8 |
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
