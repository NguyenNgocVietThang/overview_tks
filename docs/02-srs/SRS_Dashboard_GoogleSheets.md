# TÀI LIỆU ĐẶC TẢ YÊU CẦU PHẦN MỀM

*(Software Requirements Specification – SRS)*

**HỆ THỐNG DASHBOARD NỘI BỘ — TOKOSI**

| **Thông tin**      | **Nội dung**                                               |
|--------------------|------------------------------------------------------------|
| Tên dự án          | Hệ thống Dashboard nội bộ TOKOSI                          |
| Phiên bản          | 3.0                                                        |
| Ngày tạo           | 27/07/2026                                                 |
| Ngày cập nhật      | 06/10/2026                                                 |
| Tài liệu liên quan | BRD v2.2 · BPMN v3.0 · Implementation Plan (cập nhật 05/10/2026) · CSNS-NP-01 (Chính sách nghỉ phép) · `server/db/SCHEMA.md` · Design System MASTER (mục 7 — ràng buộc hiệu năng) |
| Trạng thái         | Nội dung nền rà soát tại HEAD `11751c4` (05/10); FR-15 Sổ quỹ bổ sung và kiểm chứng 06/10. Migration `0033` đã áp thành công lên Supabase DB. Deploy production còn chờ. Số kiểm thử 1.704/1.701/0/3 là mốc lịch sử 05/10. |

> **Ghi chú v3.0 (05/10/2026):** viết lại để khớp code hiện tại. Đã loại các mô tả thuộc thời Apps Script/Google Sheets (schema 9 tab, `Trả NCC` trên Sheets, webhook qua Apps Script, API vận chuyển `/api/shipment/orders`, `/api/hr/leave/*`, `/api/auth/request-reset-otp`…) vì không còn tồn tại; cập nhật theo mô hình "Cả hai" là bộ lọc xem, Báo cáo tổng hợp tải theo tab, bộ lọc Từ–Đến theo từng bảng, Vòng đời đơn hàng hợp nhất đơn KiotViet, Vị trí hàng, khóa tự đăng ký, ID Telegram do Quản lý quản lý, bot Telegram cho quản lý. Tên file giữ `…_GoogleSheets.md` vì lý do lịch sử.

# 1. Giới thiệu

## 1.1. Mục đích

Tài liệu đặc tả yêu cầu chức năng và phi chức năng của Dashboard TOKOSI, làm cơ sở cho thiết kế, xây dựng, kiểm thử và bảo trì. Cụ thể hóa các yêu cầu trong BRD v2.2 thành đặc tả có thể kiểm chứng với code.

## 1.2. Phạm vi hệ thống

Web Application nội bộ gồm:

1. **Engine đồng bộ KiotViet (Node.js):** `server/kiotvietSync/` polling KiotViet API cho hai cơ sở, nạp dữ liệu bán hàng vào Supabase PostgreSQL; webhook KiotViet chỉ được lưu thô.
2. **Web Server (Node.js/Express) + frontend HTML tĩnh:** xác thực JWT, phân quyền theo tính năng, tính KPI/bảng/biểu đồ, xuất Excel/HTML, SSE, bot Telegram quản lý nghỉ phép. Đọc dữ liệu KiotViet, tài khoản, nhân sự, nghỉ phép, công nợ CN1/CN3/CN7, Trả NCC từ Postgres; đọc Google Sheets cho **Bảng Công nợ**, **Vòng đời đơn hàng** (kèm ghi tab `Lịch sử cập nhật`) và **Vị trí hàng**.

## 1.3. Định nghĩa & thuật ngữ

| **Thuật ngữ**           | **Giải thích**                                                                        |
|-------------------------|---------------------------------------------------------------------------------------|
| Dashboard / Báo cáo tổng hợp | Trang `/reports/` gồm 6 tab: Tổng quan, Hàng hóa, Hóa đơn, Khách hàng, Quản lý công nợ, Báo cáo kinh doanh (FR-16). |
| Doanh số tháng (Báo cáo kinh doanh) | Σ tổng tiền hóa đơn `Hoàn thành` trong tháng − Σ tổng tiền phiếu trả `Đã trả` trong tháng, gộp HN + SG (FR-16.2). |
| KPI Card                | Thẻ hiển thị 1 chỉ số tổng hợp.                                                        |
| CN1 / CN3 / CN7         | Khách hàng có hoạt động công nợ trong 1/3/7 ngày gần nhất (trước đây HN1/HN3/HN7), bảng `customer_debt_activity_periods`. |
| Cơ sở vật lý            | `Hà Nội` hoặc `Sài Gòn` — giá trị duy nhất được lưu vào cột nghiệp vụ (`branch` = `hanoi`/`saigon`). |
| `Cả hai` (BRANCH_BOTH)  | Lựa chọn **phạm vi xem** trên thanh điều hướng, không phải cơ sở thứ ba; `resolveBranchScope('Cả hai')` quy về hai cơ sở vật lý trước mọi truy vấn. |
| Cơ sở mặc định          | `app_users.co_so` (`hanoi`/`saigon`/`both`/rỗng = Cả hai): chỉ là cơ sở chọn sẵn lúc đăng nhập, **không** giới hạn quyền xem. |
| Chữ ký cảnh báo         | SHA-256 của loại cảnh báo và số nợ hiện tại; vô hiệu trạng thái kết thúc của công nợ khi khoản nợ đổi. |
| Quyền tính năng         | Khóa trong `server/auth/featureRegistry.js` (vd `reports.overview`, `shipment.lifecycle`); mặc định theo vai trò, Quản lý ghi đè từng tài khoản (`app_users.feature_permissions`). |
| Service Account         | Tài khoản dịch vụ Google để backend đọc/ghi các workbook Google Sheets còn dùng.        |
| Rollup                  | Bảng tổng hợp theo ngày (`daily_invoice_summary`, `daily_product_sales`, `product_first_purchase`) làm mới định kỳ. |
| Phiếu tạm               | Trạng thái đơn đặt hàng KiotViet đang giữ hàng cho khách (`raw->>'statusValue' = 'Phiếu tạm'`). |
| Tồn có thể bán          | Tồn thực tế − Đặt hàng Phiếu tạm (không kẹp về 0; không cộng Hàng đang vận chuyển).   |
| Hàng đang vận chuyển    | Số lượng trong phiếu **Đặt hàng nhập** (`order_suppliers`) trạng thái "Đã xác nhận NCC" của Kiot Sài Gòn. |
| OTP                     | Mã dùng một lần 6 số (hiệu lực 5 phút) để khôi phục mật khẩu / xác minh thay đổi liên hệ. |
| HR Leave                | Phân hệ đơn nghỉ phép (bảng `hr_leave_requests`) theo chính sách CSNS-NP-01.           |
| SSE                     | Server-Sent Events: `/api/dashboard/events` (báo dữ liệu mới) và `/api/hr/leave-requests/stream` (nghỉ phép). |

## 1.4. Tài liệu tham khảo

- BRD v2.2, BPMN v3.0, `server/db/SCHEMA.md`, `server/README.md`, `README.md`.
- CSNS-NP-01 — Quy định & Chính sách quản lý nghỉ phép nhân sự.
- `server/kiotviet/API_ENDPOINTS.md` — tham số KiotViet Public API đã kiểm chứng.
- `docs/stock-locations-setup.md`, `docs/telegram-manager-leave-setup.md`.
- Supabase PostgreSQL, Google Sheets API v4, KiotViet Public API Documentation.

# 2. Mô tả tổng quan hệ thống

## 2.1. Kiến trúc tổng quan

```
KiotViet Public API
    |  polling REST (nguồn dữ liệu)            webhook POST (chỉ lưu thô)
    v                                          v
Node.js Sync Engine (server/kiotvietSync/)    server/kiotviet/webhookEventQueue.js -> webhook_events_raw
    ├── scheduler.js / syncDriver.js : nhóm fast 7 phút, nhóm slow 20 phút, checkpoint theo (branch, entity)
    ├── dashboardRollupRefresh.js    : rollup nóng 7 ngày sau mỗi lượt fast; rollup đầy đủ 400 ngày mỗi 30 phút
    ├── customerDebtReportRefresh.js : CN1/CN3/CN7 mỗi 5 phút
    ├── productReportRefresh.js      : product_report + product_report_customers, 1 lần/đêm
    ├── customerInvoiceLinesRefresh.js : customer_invoice_lines_90d, 1 lần/đêm sau 00:10 VN
    └── inventoryValueSnapshot.js    : inventory_value_snapshots, chụp 23:59 VN
    |
    v
Supabase PostgreSQL
    ├── KiotViet: categories, products, customers, staff, invoices(+details, payments), orders(+details),
    │             returns(+details), purchases(+details), order_suppliers(+details), cash_flows
    ├── Tổng hợp: daily_invoice_summary, daily_product_sales, product_first_purchase, customer_debt_activity_periods,
    │             product_report, product_report_customers, customer_invoice_lines_90d(+_state), inventory_value_snapshots
    ├── Nghiệp vụ: app_users, hr_employees, debt_collection_statuses, supplier_return_imports, hr_rule_documents
    ├── Nghỉ phép/Telegram: hr_leave_requests, hr_telegram_links, hr_telegram_sessions, hr_leave_change_events,
    │             hr_leave_manager_messages, hr_manager_telegram_sessions/_updates/_state
    └── Kỹ thuật: webhook_events_raw, sync_checkpoints, backfill_progress, schema_migrations

Google Sheets (service account)
    ├── Bảng Công nợ (DEBT_MANAGEMENT_SPREADSHEET_ID)         : chỉ đọc
    ├── Vòng đời đơn hàng (ORDER_LIFECYCLE_SPREADSHEET_ID)    : đọc DonHang_HN/SG, GHI tab `Lịch sử cập nhật`
    └── Vị trí hàng (STOCK_LOCATIONS_SPREADSHEET_ID)          : chỉ đọc `Vị trí HN`, `Vị trí SG`
    (Workbook HR và tab `Trả NCC` không còn được đọc)

File JSON cục bộ: server/data/notifications.json (chuông thông báo), server/data/roleChangeRequests.json (yêu cầu đổi vai trò)

Backend Express (server/): index.js · routes.js · config.js · auth/ · branch/ · dashboard/ · hr/ · shipment/ · stockLocations/
    · notifications/ · telegram/ · sheets/ · lib/ · db/
    REST: /api/auth/*, /api/admin/*, /api/role-requests/*, /api/branch, /api/dashboard(+/events), /api/customer-*,
          /api/product-report*, /api/inventory-value-history, /api/invoice-detail, /api/export*, /api/products/*,
          /api/debt-management/status, /api/shipment/lifecycle/*, /api/stock-locations, /api/hr/*, /api/notifications/*,
          /api/internal/kiotviet-sync/status, /api/kiotviet/webhook/:secret, /api/telegram/manager-leave/webhook, /health, /api/debug
    |
    v
Frontend (server/public/): index.html (Báo cáo tổng hợp, phục vụ ở /reports/ và /), account/, humanresources/, shipment/lifecycle/,
    stock-locations/, login/, register/, 404.html, shared/ (shared-nav.js, shared.css, dateInput.js…), js/ (pagination.js, table-explorer.js), vendor/ (Chart.js, html2pdf)
```

## 2.2. Stack công nghệ thực tế

### Backend
- **Runtime:** Node.js 22.x (`engines`), Express 4.
- **Dependencies:** `pg`, `googleapis`, `google-auth-library`, `bcryptjs`, `jsonwebtoken`, `cookie-parser`, `compression`, `multer`, `exceljs` (xuất), `xlsx` (đọc file Trả NCC upload), `nodemailer` (OTP). Dev: `dotenv`, `jsdom`, `@electric-sql/pglite`.
- **Entry point:** `server/index.js` (`npm start` dùng `--max-old-space-size=1536`).
- **Testing:** `node:test` + `node:assert/strict`, 177 file test, `npm test` trong `server/`; frontend được kiểm thử bằng JSDOM.
- **Lưu ý trạng thái trong tiến trình:** OTP, bộ đếm đăng nhập sai, job đứt hàng, SSE, hàng đợi webhook là **bộ nhớ tiến trình** ⇒ chỉ chạy **một instance**.

### Frontend
- HTML5/CSS3/JavaScript thuần (không React/Tailwind/TypeScript, không bước build), Chart.js vendor cục bộ (`server/public/vendor/chart.umd.min.js`), `pagination.js`, `table-explorer.js`.
- Điều hướng dùng chung `shared/shared-nav.js` (sidebar theo quyền, chuông thông báo, lịch nghỉ phép, hồ sơ cá nhân, đổi cơ sở, theme sáng/tối).

### Dữ liệu & Caching
- **Nguồn chính:** Supabase PostgreSQL (`SUPABASE_DB_URL`; pool `PG_POOL_MAX`, mặc định 7).
- **Cache báo cáo:** cache bảng nguồn theo từng bảng (TTL 90 giây, tối đa stale 10 phút) + cache kết quả theo (cơ sở, tab, bộ lọc của tab) TTL 90 giây; nạp sẵn lúc khởi động (`DASHBOARD_PREWARM`). Cache đơn Kiot của Vòng đời đơn hàng 2 phút (stale-while-revalidate). Vị trí hàng không cache giá trị.
- **Xác thực Google:** `GOOGLE_SERVICE_ACCOUNT_JSON`.

### Hạ tầng & triển khai
- Render.com (Web Service) `tokosi.onrender.com`; deploy từ branch `main`; biến môi trường cấu hình trên Render; cookie `tks_auth` `secure` khi `NODE_ENV=production`.

## 2.3. Đối tượng người dùng

| **Vai trò**  | **Mô tả**                                                              |
|--------------|------------------------------------------------------------------------|
| Quản lý      | Toàn quyền mặc định: báo cáo (kể cả xuất file, sửa công nợ), vòng đời đơn hàng (kể cả xuất, ghi đè), nhân sự (duyệt nghỉ, tải quy định), tài khoản/phân quyền, trạng thái đồng bộ. **Quản lý cấp cao** = tài khoản admin cứng. |
| Trợ lý       | 6 tab báo cáo + xuất Excel + sửa trạng thái công nợ; vòng đời đơn hàng (xem, tra cứu, lịch sử); nhân sự (xem). Không "Tính lại tháng" của Báo cáo kinh doanh. |
| Nhân viên sale | 6 tab báo cáo (xem), vòng đời đơn hàng (xem), nhân sự (xem). Không xuất báo cáo, không sửa công nợ. |
| Kế toán, Trưởng kho, Lái xe | Vòng đời đơn hàng (xem/tra cứu/lịch sử), nhân sự (xem), vị trí hàng. Không có tab báo cáo mặc định. |
| Nhân viên kho / marketing / mua hàng | Nhân sự (xem), vị trí hàng; **không** có Vòng đời đơn hàng. |
| Khách        | Chỉ trang Tài khoản/hồ sơ; không vào báo cáo, vòng đời đơn hàng, nhân sự, vị trí hàng. |
| IT Admin     | Cấu hình biến môi trường Render, migration, webhook KiotViet, bot Telegram.   |

Quyền mặc định ở trên tính từ `featureRegistry.js`; Quản lý có thể cấp thêm/rút từng quyền cho từng tài khoản tại `/account/#users`.

## 2.4. Giả định & phụ thuộc

- Schema Postgres đã áp tới migration `0030` (các bảng/cột mới đọc fail-soft nếu thiếu: `inventory_value_snapshots`, `order_suppliers`; riêng `decision_version` (0029) và danh sách trạng thái nghỉ phép (0030) **bắt buộc** đã áp trước khi chạy bản web mới).
- Service account Google: Viewer trên Bảng Công nợ và Vị trí hàng, Editor trên workbook Vòng đời đơn hàng.
- Scheduler chạy liên tục (`KIOTVIET_SYNC_ENABLED=true`); webhook KiotViet trỏ về `/api/kiotviet/webhook/<secret>`.
- Bot xin nghỉ của nhân viên chạy **ngoài repo** và ghi trực tiếp vào Postgres.

## 2.5. Định hướng kiến trúc mở rộng

- Giữ mô-đun theo miền (`dashboard`, `auth`, `hr`, `shipment`, `stockLocations`, `telegram`).
- Thêm quyền/trang mới: sửa `featureRegistry.js` (+ `PAGE_FEATURES`, menu `shared-nav.js`, guard route) và test tương ứng.
- Thay đổi schema bằng migration mới; không sửa migration đã áp.

# 3. Yêu cầu chức năng (Functional Requirements)

## 3.1. FR-01: Nguồn dữ liệu & caching

| **Mã**  | **Mô tả**                                                                                                                        | **Ưu tiên** | **Trạng thái** |
|---------|----------------------------------------------------------------------------------------------------------------------------------|-------------|----------------|
| FR-01.1 | Dữ liệu KiotViet của dashboard đọc từ Postgres qua `dashboardPgReader.js` (7 bảng nguồn dạng "sheet": Nhóm hàng, Hàng hóa, Hóa đơn, Chi tiết hóa đơn, Đặt hàng, Trả hàng, Khách hàng) và các bảng rollup; không đọc Google Sheets. | Cao | Hoàn thành |
| FR-01.2 | Google Sheets chỉ còn dùng cho Bảng Công nợ (chỉ đọc), Vòng đời đơn hàng (đọc + ghi `Lịch sử cập nhật`) và Vị trí hàng (chỉ đọc), xác thực bằng Service Account JSON. | Cao | Hoàn thành |
| FR-01.3 | Mọi ID workbook và `GOOGLE_SERVICE_ACCOUNT_JSON` đọc từ biến môi trường; thiếu ID workbook chỉ tắt tính năng tương ứng (503), không làm sập server. | Cao | Hoàn thành |
| FR-01.4 | Thông tin xác thực KiotViet (`KIOTVIET_CLIENT_ID/SECRET/RETAILER`, hậu tố `_SG`) đọc từ biến môi trường; không hard-code. | Cao | Hoàn thành |
| FR-01.5 | Lỗi đọc dữ liệu trả HTTP 500 kèm `detail`; log chi tiết phía server. Lỗi workbook công nợ chỉ làm `debtManagement.available = false`. | Cao | Hoàn thành |
| FR-01.6 | Cache theo từng bảng nguồn (TTL 90 giây, stale tối đa 10 phút) và cache kết quả theo (cơ sở, tab, bộ lọc của tab); đổi bộ lọc của tab khác không làm mất cache của tab này. | Cao | Hoàn thành |
| FR-01.7 | Nạp sẵn cache nguồn lúc khởi động (tuần tự từng cơ sở, lỗi chỉ log) để người dùng đầu tiên sau restart không chờ; tắt bằng `DASHBOARD_PREWARM=false`. | Trung bình | Hoàn thành |
| FR-01.8 | Workbook công nợ: Hà Nội → `Công nợ HN`, Sài Gòn → `Công nợ SG`; service account chỉ cần Viewer. | Cao | Hoàn thành |
| FR-01.9 | Cột TIMESTAMPTZ của KiotViet lưu "giờ treo tường VN mang nhãn UTC"; mốc lọc ngày so sánh trực tiếp cột gốc (không bọc `AT TIME ZONE`) để dùng index ngày (migration `0021`). | Cao | Hoàn thành |

## 3.2. FR-02: KPI

| **Mã**  | **Mô tả**                                                                                                                              | **Ưu tiên** | **Trạng thái** |
|---------|----------------------------------------------------------------------------------------------------------------------------------------|-------------|----------------|
| FR-02.1 | **Đã gỡ 2026-10-05:** KPI "hôm nay" (`kpi.revenueToday`, `invoicesToday`, `cancelledToday`) không còn được tính/trả; dashboard chỉ hiện số liệu trong kỳ ở FR-02.2. | — | Đã gỡ |
| FR-02.2 | Mục "Xu hướng" của tab Tổng quan có 3 thẻ trong kỳ lọc: **Doanh thu thực tế** (hóa đơn hoàn thành trừ tiền phiếu trả `Đã trả` theo ngày trả), số hóa đơn hoàn thành, số hóa đơn hủy. | Cao | Hoàn thành |
| FR-02.3 | KPI hàng hóa hiển thị ở tab Hàng hóa: tổng mã hàng, mã có hàng, mã hết hàng (tồn = 0), **Giá trị tồn kho** = Σ `max(tồn,0) × max(giá vốn trung bình,0)` chỉ hàng đang kinh doanh, bỏ mã bắt đầu `VAT`. | Cao | Hoàn thành |
| FR-02.4 | KPI khách hàng: tổng khách, số khách có công nợ, tổng công nợ. | Cao | Hoàn thành |
| FR-02.5 | Tab Hóa đơn hiển thị 4 thẻ trong kỳ: Số giao dịch, Doanh thu, Giảm giá, Thực thu. Thẻ "Đặt hàng đang chờ" đã bỏ 2026-10-01 (đơn Phiếu tạm theo dõi ở Vòng đời đơn hàng, FR-14); thẻ Trả hàng (`invoices.returnsCount`/`totalReturns`) đã gỡ khỏi payload 2026-10-05 nên tab Hóa đơn không còn đọc bảng Trả hàng (doanh thu trừ trả hàng lấy từ rollup `daily_invoice_summary`). | Cao | Hoàn thành |
| FR-02.6 | KPI nhà cung cấp / nhập hàng của Báo cáo tổng hợp **đã gỡ** cùng tab Nhà cung cấp (2026-09-30, migration `0026`); `purchases` chỉ còn phục vụ kiểm tra đứt hàng và "Hàng mới nhập". | — | Đã gỡ |
| FR-02.7 | Tab Quản lý công nợ có 4 KPI riêng (xem FR-11.5). Mỗi mục lớn của các tab có chỉ số then chốt riêng ở đầu mục và tính theo bộ lọc Từ–Đến của chính bảng. | Cao | Hoàn thành |

## 3.3. FR-03: Biểu đồ & bảng chi tiết (theo tab)

| **Mã**  | **Mô tả**                                                                                                                                          | **Ưu tiên** | **Trạng thái** |
|---------|----------------------------------------------------------------------------------------------------------------------------------------------------|-------------|----------------|
| FR-03.1 | **Tổng quan mục 1 Xu hướng:** biểu đồ "Doanh thu thực tế theo ngày" (`revenueByDay`) và biểu đồ cột chồng "Giá trị tồn kho theo ngày" (HN + SG; chọn 1 cơ sở thì 1 màu) từ `inventory_value_snapshots` qua `GET /api/inventory-value-history`, bộ lọc Từ–Đến riêng, mặc định 7 ngày; ngày trước 30/09/2026 không có số liệu. | Cao | Hoàn thành |
| FR-03.2 | **Tổng quan mục 2 Báo cáo doanh thu theo khách:** tìm khách (`/api/customer-suggest`), doanh thu 90 ngày gần nhất theo sản phẩm (`/api/customer-product-revenue`, nguồn `customer_invoice_lines_90d`, đã trừ hàng trả, cửa sổ kết thúc hôm qua), biểu đồ + bảng chi tiết sản phẩm. | Cao | Hoàn thành |
| FR-03.3 | **Tổng quan mục 3 Báo cáo hàng hóa:** bảng gộp hai cơ sở từ `product_report` (`GET /api/product-report`): tồn, Tồn có thể bán, bán 30 ngày, doanh thu 90 ngày (đã trừ hàng trả), số khách 90 ngày, % khách lớn nhất; nút **Chi tiết** mỗi dòng mở khung doanh số 90 ngày từng khách (số tiền + %) kèm biểu đồ tròn (`product_report_customers`, `GET /api/product-report/customers?code=`) và ô tìm theo mã/tên. | Cao | Hoàn thành |
| FR-03.4 | **Tổng quan mục 4 Kiểm tra đứt hàng** (chỉ hiện khi có quyền `reports.products`): nhập Trả NCC, Hàng đứt gần đây, kiểm tra 30 ngày, kiểm tra 90 ngày (FR-03.12). | Cao | Hoàn thành |
| FR-03.5 | **Tab Hàng hóa:** "Cơ cấu tồn kho" (chỉ bảng chi tiết theo sản phẩm — đã bỏ biểu đồ — với Tồn kho, **Tồn có thể bán**, **Hàng đang vận chuyển**, Giá trị tồn; chọn "Cả hai" gộp 1 dòng/mã với cột HN/SG riêng); "Phân tích" (Sản phẩm bán chạy theo doanh thu thực tế đã trừ hàng trả, loại hóa đơn đã hủy); "Dữ liệu chi tiết" (Tất cả mã hàng); "Hàng mới nhập" (ngày nhập đầu tiên trong khoảng); "Mã mới tạo" (Danh sách mã mới + Tỷ lệ số mã theo nhóm hàng). | Cao | Hoàn thành |
| FR-03.6 | **Công thức Tồn có thể bán** = Tồn thực tế − Đặt hàng Phiếu tạm (không kẹp về 0, hàng bị giữ quá tồn hiện số âm; Hàng đang vận chuyển chỉ hiển thị, không cộng); dùng chung cho bảng Cơ cấu tồn kho, `product_report.available_to_sell` và các file xuất. | Cao | Hoàn thành |
| FR-03.7 | **Tab Hóa đơn:** bảng "Chi tiết giao dịch" (hóa đơn) trong khoảng Từ–Đến; bấm dòng mở hộp thoại chi tiết (dòng hàng, tổng tiền, phương thức thanh toán) qua `GET /api/invoice-detail?code=&branch=`. Hai bảng Danh sách đặt hàng / Danh sách trả hàng đã bỏ 2026-10-01. | Cao | Hoàn thành |
| FR-03.8 | **Tab Khách hàng:** "Top khách hàng theo doanh thu" (doanh thu thực tế đã trừ hàng trả, cột doanh thu và công nợ theo HN/SG, mặc định xem toàn thời gian) và "Phân tích khách hàng công nợ" (Chi tiết khách nợ, top nợ). | Cao | Hoàn thành |
| FR-03.9 | **Tab Quản lý công nợ:** xem FR-11. | Cao | Hoàn thành |
| FR-03.10 | Tên nhân viên bán lấy từ KiotViet dạng `<tên> - <ID Telegram>` hiển thị chỉ còn `<tên>` ở mọi nơi (kể cả file xuất, Vòng đời đơn hàng) — `dashboard/saleName.js`; dữ liệu gốc giữ nguyên. | Trung bình | Hoàn thành |
| FR-03.11 | Cột thời gian của mọi bảng sắp xếp theo thời gian thật (`dd/MM/yyyy[ HH:mm[:ss]]`, `yyyy-MM-dd[ HH:mm[:ss]]`) trên toàn bộ dữ liệu đã lọc; bảng "Chi tiết giao dịch" trả thêm `timeMs`. | Cao | Hoàn thành |
| FR-03.12 | **Kiểm tra đứt hàng & Trả NCC** (quyền `reports.products`): upload file Excel "Trả hàng nhập" (`POST /api/products/supplier-returns/import`, thay toàn bộ dữ liệu của cơ sở trong `supplier_return_imports`; `GET .../import-status`); quét `stockout-recent`, `stockout-30d`, `stockout-90d` (`POST .../scan` → `GET .../:jobId/progress` → `GET .../:jobId/result`), đọc hóa đơn/nhập hàng/khách trả/Trả NCC từ Postgres (`stockoutPgSource.js`, mốc sàn dữ liệu quét `STOCKOUT_DATA_FLOOR_DATE_KEY` = 01/02/2026); ở "Cả hai" quét tuần tự hai cơ sở rồi gộp, một cơ sở lỗi thì job báo lỗi. Job lưu trong bộ nhớ tiến trình. | Cao | Hoàn thành |
| FR-03.13 | Doanh thu thực tế: các nguồn doanh thu (theo ngày, theo khách, theo hàng hóa, `product_report`, `customer_invoice_lines_90d`) đều **trừ hàng khách trả** (phiếu trả `statusValue = 'Đã trả'`, tính vào ngày trả). | Cao | Hoàn thành |

## 3.4. FR-04: Bộ lọc thời gian

| **Mã**  | **Mô tả**                                                                                                     | **Ưu tiên** | **Trạng thái** |
|---------|---------------------------------------------------------------------------------------------------------------|-------------|----------------|
| FR-04.1 | Không còn bộ lọc chung 7/30/90 ngày và không còn thanh tìm kiếm chung đầu tab. Mỗi bảng/biểu đồ có bộ lọc **Từ – Đến** riêng (tiền tố tham số: `pr`, `in`, `cu`, `np`, `ni` + `Mode`/`Days`/`From`/`To`); xóa trống cả hai ô = "Tất cả". Bộ lọc riêng `ov*` của Tổng quan đã bỏ 2026-10-05: doanh thu theo ngày ở Tổng quan dùng bộ lọc `in*` (`filters.overview` không còn). | Cao | Hoàn thành |
| FR-04.2 | Mặc định: 30 ngày gần nhất cho bảng bán chạy, Hàng mới nhập, Mã mới tạo, Chi tiết giao dịch/doanh thu theo ngày; **toàn thời gian** cho Top khách theo doanh thu; **7 ngày** cho Giá trị tồn kho theo ngày (bộ lọc riêng, gọi API riêng). | Cao | Hoàn thành |
| FR-04.3 | Client cũ chỉ gửi `days` vẫn được hỗ trợ (tham số `days` làm giá trị dự phòng); bộ lọc `or*`/`rt*` của hai bảng đã bỏ bị bỏ qua. | Trung bình | Hoàn thành |
| FR-04.4 | Đổi bộ lọc tải lại đúng tab đang xem, không tải lại trang. Mọi mốc ngày tính theo Asia/Ho_Chi_Minh. | Cao | Hoàn thành |

## 3.5. FR-05: Cập nhật dữ liệu

| **Mã**  | **Mô tả**                                                                                                              | **Ưu tiên** | **Trạng thái** |
|---------|------------------------------------------------------------------------------------------------------------------------|-------------|----------------|
| FR-05.1 | `GET /api/dashboard?view=<tab>`: chỉ đọc/tính/trả phần của một tab (`overview`, `products`, `invoices`, `customers`, `debt`; ghép nhiều tab bằng dấu phẩy; bỏ `view` = cả 5 tab; tên sai → 400 `INVALID_VIEW`; tab không có quyền → `{ filters: {}, kpi: {} }`). Trang chỉ gọi tab đang mở. Tab Báo cáo kinh doanh không nằm trong API này mà dùng `/api/business-report/*` (FR-16). | Cao | Hoàn thành |
| FR-05.2 | Hiển thị `updatedAt` định dạng `dd/MM/yyyy HH:mm:ss` theo Asia/Ho_Chi_Minh; trạng thái loading và thông báo lỗi tiếng Việt khi gọi API thất bại. | Trung bình | Hoàn thành |
| FR-05.3 | Cập nhật gần thời gian thực qua SSE: sau mỗi lượt sync fast + rollup, server phát `dashboard-updated` trên `GET /api/dashboard/events` (heartbeat 25 giây); trình duyệt đánh dấu mọi tab đã tải là cũ, tải lại tab đang xem sau trễ ngẫu nhiên 0–3 giây, tab khác tải lại khi mở. | Cao | Hoàn thành |
| FR-05.4 | Tab trở lại hiển thị sau ≥ 60 giây tải lại và nối lại SSE; SSE lỗi 5 lần liên tiếp thì thử nối lại sau 1, 5, 15 phút. Nút "Làm mới" tải lại tab hiện tại; chỉ render lại khi dữ liệu nghiệp vụ đổi (so fingerprint). | Trung bình | Hoàn thành |

## 3.6. FR-06: Sync Engine — KiotViet → Supabase PostgreSQL

| **Mã**  | **Mô tả**                                                                                                                                                                     | **Ưu tiên** | **Trạng thái** |
|---------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------|----------------|
| FR-06.1 | `preflightCheck`, `backfill.js`, `reconcileCounts.js` (`npm run kiotviet-sync:*`): kiểm tra kết nối, nạp lịch sử, đối chiếu số lượng cho cả hai cơ sở. | Cao | Hoàn thành |
| FR-06.2 | `POST /api/kiotviet/webhook/<KIOTVIET_WEBHOOK_SECRET>`: trả `200` ngay, đưa payload vào hàng đợi nền và **chỉ ghi thô** vào `webhook_events_raw` (không cập nhật bảng nghiệp vụ). Secret sai → 404; đường dẫn cũ không secret còn mở cho tới khi đặt `KIOTVIET_WEBHOOK_LEGACY_PATH_ENABLED=false`. Chỉ nhận khi `KIOTVIET_SYNC_ENABLED=true`. | Cao | Hoàn thành |
| FR-06.3 | `scheduler.js` + `syncDriver.js`: nhóm **fast** mỗi 7 phút (`invoices`, `orders`, `product_on_hands`, `product_on_hands_snapshot`, `order_suppliers`), nhóm **slow** mỗi 20 phút (`categories`, `products`, `customers`, `returns`, `purchases`, `cash_flows`); chạy bù ngay khi khởi động; checkpoint `(branch, entity)` chỉ tiến sau khi **mọi trang** thành công, lỗi giữ mốc cũ. | Cao | Hoàn thành |
| FR-06.4 | Tham số incremental từng entity theo `server/kiotviet/API_ENDPOINTS.md` (đã kiểm chứng): `lastModifiedFrom` cho phần lớn; `purchases` đối soát toàn bộ từ mốc sàn đứt hàng 01/02/2026; `order_suppliers` và snapshot tồn kho quét toàn bộ; `cash_flows` dùng `startDate/endDate`. | Cao | Hoàn thành |
| FR-06.5 | Retry exponential backoff khi KiotViet trả 429/5xx/lỗi mạng; token OAuth cache và làm mới trước hạn. | Cao | Hoàn thành |
| FR-06.6 | `dashboardRollupRefresh.js`: rollup "nóng" 7 ngày ngay sau mỗi lượt fast (rồi phát SSE), rollup đầy đủ 400 ngày mỗi 30 phút, `product_first_purchase` quét đầy đủ lúc khởi động và mỗi 6 giờ; chỉ ghi dòng thật sự đổi (`IS DISTINCT FROM`) để không làm cạn Disk IO Supabase. | Cao | Hoàn thành |
| FR-06.7 | Tồn kho: entity `product_on_hands` (nhẹ) + `product_on_hands_snapshot` quét toàn bộ `/productOnHands` tối đa 10 phút/lần vì `modifiedDate` của endpoint này không bump theo bán/nhập hàng; chỉ `UPDATE` `onHand`/`reserved` trong `products.raw->'inventories'`, giữ `cost`. | Cao | Hoàn thành |
| FR-06.8 | `customerDebtReportRefresh.js`: mỗi 5 phút làm mới `customer_debt_activity_periods` (CN1/CN3/CN7) chỉ ghi dòng đổi tên/mới và xóa dòng không còn. | Cao | Hoàn thành |
| FR-06.9 | `productReportRefresh.js`: kiểm tra mỗi 5 phút, tính lại `product_report` + `product_report_customers` **1 lần/đêm** (TRUNCATE + nạp một câu lệnh); chạy tay: `node kiotvietSync/productReportRefresh.js` (trong `server/`). | Cao | Hoàn thành |
| FR-06.10 | `customerInvoiceLinesRefresh.js`: dựng `customer_invoice_lines_90d` 1 lần/đêm sau 00:10 VN (nạp bảng tạm rồi chỉ DELETE/INSERT phần khác biệt trong một giao dịch), cửa sổ 90 ngày kết thúc hôm qua; chưa dựng thì API quay về cách tính cũ. | Cao | Hoàn thành |
| FR-06.11 | `inventoryValueSnapshot.js`: kiểm tra mỗi phút, chụp giá trị tồn kho từng cơ sở lúc 23:59 VN (`INSERT … ON CONFLICT DO NOTHING`); lỡ giờ thì chụp bù trước 12:00 hôm sau. | Cao | Hoàn thành |
| FR-06.12 | `GET /api/internal/kiotviet-sync/status` (quyền `system.syncStatus`, mặc định Quản lý) báo trạng thái đồng bộ; fail-soft 503 nếu chưa có DB. | Trung bình | Hoàn thành |
| FR-06.13 | `businessMonthlyRefresh.js`: kiểm tra mỗi 5 phút; chốt doanh số tháng vừa qua vào các bảng `business_monthly_*` (migration `0036`) khi ≥ 00:10 VN ngày mùng 1, mỗi tháng 1 lần (`DELETE` + `INSERT … SELECT` theo tháng trong một giao dịch, không TRUNCATE); lần chạy đầu backfill từ T3/2026; mỗi lượt dựng lại bảng sale theo nhóm khách hiện tại, chỉ ghi dòng đổi. Chạy tay: `node kiotvietSync/businessMonthlyRefresh.js [YYYY-MM]` (trong `server/`; có tháng = chốt lại đúng tháng đó, chỉ dùng cho tháng đã kết thúc). Xem FR-16. | Cao | Code hoàn thành |

## 3.7. FR-07: Giao diện & xuất file

| **Mã**  | **Mô tả**                                                                                                                | **Ưu tiên** | **Trạng thái** |
|---------|--------------------------------------------------------------------------------------------------------------------------|-------------|----------------|
| FR-07.1 | Sidebar dùng chung (`shared-nav.js`) dựng từ danh sách quyền server trả về (`GET /api/auth/me`): nhóm Báo cáo tổng hợp, Quản lý đơn hàng, Vị trí hàng, Quản lý nhân sự, Quản lý tài khoản; mục không có quyền không hiện. | Cao | Hoàn thành |
| FR-07.2 | Mỗi bảng có tìm kiếm trong bảng (không dấu), sắp xếp ba trạng thái trên mọi cột, phân trang 100 dòng/trang (`pagination.js`) trên toàn bộ dữ liệu đã lọc; độ rộng cột cố định. | Cao | Hoàn thành |
| FR-07.3 | Thanh điều hướng có bộ chọn cơ sở Hà Nội / Sài Gòn / Cả hai (cookie `tks_branch`, xác thực lại ở server), đổi theme sáng/tối, chuông thông báo (hỏi số chưa đọc mỗi 30 giây), lịch nghỉ phép, hộp hồ sơ cá nhân. | Cao | Hoàn thành |
| FR-07.4 | `/api/debug`: kiểm tra kết nối Postgres (đếm hóa đơn theo `branch = ANY($1)`), quyền như API báo cáo; `/health` trả `{"status":"ok"}` cho health check Render. | Thấp | Hoàn thành |
| FR-07.5 | Mỗi bảng xuất được có nút `Xuất Excel` (tùy trang có thêm `Xuất HTML`): file giữ bộ lọc/sắp xếp hiện tại và bỏ giới hạn phân trang. Các bảng: Chi tiết giao dịch, Danh sách mã mới, Sản phẩm bán chạy, Tất cả mã hàng, Hàng mới nhập, Chi tiết tồn kho theo sản phẩm, Doanh thu theo khách, Chi tiết khách nợ, Bảng chi tiết sản phẩm theo khách, Báo cáo hàng hóa, Quản lý công nợ, Hàng đứt gần đây, Kiểm tra đứt hàng 90/30 ngày (`TABLE_TITLES` trong `exportService.js`). Quyền `reports.export` (mặc định Quản lý + Trợ lý). Ba bảng của Báo cáo kinh doanh xuất qua endpoint riêng `GET /api/business-report/export` (cột tháng động, xem FR-16.7). | Cao | Hoàn thành |
| FR-07.6 | `POST /api/export/fields` trả danh sách worksheet/trường ngay từ từ điển tĩnh (`rowCount = null`), không chạm DB (bảng `search.results` đã gỡ 2026-10-05). `POST /api/export` lấy mã dòng từ `getDashboardData()` rồi `readRowsByCodes()` đọc đúng các mã đó từ Postgres (5 nguồn: Hàng hóa, Hóa đơn, Đặt hàng, Trả hàng, Khách hàng; nguồn khác → `400 EXPORT_SOURCE_NOT_ALLOWED`); danh sách > 20.000 mã chia lô 5.000. Body `format: 'html'` tạo báo cáo HTML tự chứa. | Cao | Hoàn thành |
| FR-07.7 | Modal xuất hủy được mọi lúc (X, Hủy, Esc, bấm nền) bằng `AbortController`; timeout 30 giây (danh sách trường) / 180 giây (tạo file); lỗi hiện thông báo tiếng Việt + `Thử lại`; phản hồi trễ của yêu cầu cũ bị bỏ qua; ngắt kết nối thì server hủy việc và nhả chỗ xuất. | Cao | Hoàn thành |
| FR-07.8 | Nhãn trường xuất tiếng Việt chuẩn hóa (có dấu, không viết tắt/snake_case, ≤ 40 ký tự, duy nhất trong worksheet) tại `exportFieldCatalog.js`; cột dashboard tính thêm khai báo trong `exportService.js`. | Cao | Hoàn thành |
| FR-07.9 | **Đã gỡ 2026-10-05:** `GET /api/search` (tìm chung / `mode=codes`), `GET /api/customer-product-top` và bảng xuất `search.results` — giao diện không còn thanh tìm kiếm chung nên không còn nơi gọi. | — | Đã gỡ |
| FR-07.10 | Chart.js có animation gating (không animate lại khi chuyển tab, đổi theme hay cập nhật nền); bộ test chặn hiệu ứng 3D và `backdrop-filter` ở màn hình chờ toàn màn hình của dashboard (`no-3d-effects.test.js`). | Cao | Hoàn thành |
| FR-07.11 | Giao diện hỗ trợ điện thoại/máy tính bảng; Light/Dark; `prefers-reduced-motion`. | Cao | Hoàn thành |

## 3.8. FR-08: Tài khoản, đăng nhập & phân quyền

| **Mã** | **Mô tả** | **Ưu tiên** | **Trạng thái** |
|--------|-----------|-------------|----------------|
| FR-08.1 | Đăng nhập `POST /api/auth/login` (tên tài khoản/email/SĐT + mật khẩu bcrypt), JWT cookie `tks_auth` (mặc định 12 giờ, `httpOnly`); sai mật khẩu 5 lần liên tiếp khóa 5 phút (HTTP 423, trả thời gian đếm ngược); tài khoản bị khóa → 403 `ACCOUNT_LOCKED`. | Cao | Hoàn thành |
| FR-08.2 | Đăng nhập Google (`POST /api/auth/google`, Google Identity ID token; `GOOGLE_CLIENT_ID` tùy chọn): chỉ liên kết/đăng nhập tài khoản **đã có** (theo email hoặc dòng nhân sự); email lạ không tạo tài khoản khi tự đăng ký đang khóa. | Cao | Hoàn thành |
| FR-08.3 | **Tự đăng ký bị khóa từ 03/10/2026** (`ALLOW_SELF_REGISTRATION`, mặc định tắt): `POST /api/auth/register` trả 403 `REGISTRATION_DISABLED`; admin cứng luôn đăng ký/đăng nhập được; `GET /api/auth/google-config` trả `{ clientId, registrationOpen }` để trang login ẩn link và trang register khóa form. Bật lại: Khách đăng ký bằng email + mật khẩu. Luồng đăng ký nhân sự bằng OTP (`/register/channels`, `/register/send-otp`, `/register/verify`) **đã gỡ 2026-10-05**. Tài khoản mới thông thường do Quản lý tạo (`POST /api/admin/users`). | Cao | Hoàn thành |
| FR-08.4 | Quên mật khẩu qua OTP 6 số: `POST /api/auth/forgot-password/channels` → `/send-otp` → `/verify` (OTP + mật khẩu mới 8–128 ký tự). OTP hiệu lực 5 phút, tối đa 5 lần nhập, gửi lại cách nhau ≥ 60 giây; định danh lạ nhận phản hồi giả (không lộ tài khoản); giới hạn 8 yêu cầu/10 phút theo định danh và 20/10 phút theo IP; thành công xóa khóa đăng nhập tạm. Email gửi qua SMTP (thiếu cấu hình thì in OTP ra console). | Cao | Hoàn thành |
| FR-08.5 | Hồ sơ cá nhân (siết 2026-10-05): `POST /api/auth/profile` chỉ đổi **họ tên** (+ ID Telegram nếu là Quản lý, FR-08.6), **không đổi email** — gửi email khác email hiện tại: tài khoản nhân sự (`hrManaged`) → 403 `EMAIL_CHANGE_LOCKED`, tài khoản thường → 409 `EMAIL_CHANGE_REQUIRES_OTP`. Email tài khoản nhân sự chỉ Quản lý đổi qua `PUT /api/admin/users/:id` (đồng bộ `hr_employees`). Tài khoản thường (Khách, nội bộ không gắn nhân sự) đổi email bằng OTP gửi tới **email mới**: `POST /api/auth/profile/contact-change` `{ field: 'email', value }` → `{ challengeId, targetMasked }`, rồi `POST /api/auth/profile/contact-change/verify` `{ challengeId, otp }`; thành công đặt `verifiedEmail = true`, chỉ ghi `app_users`; email trùng tài khoản khác bị từ chối; giới hạn 5 lần gửi mã/giờ, 10 lần nhập sai/giờ qua mọi lần xin mã, 20 yêu cầu/người dùng + 60/IP mỗi 10 phút — vượt thì 429 kèm `waitSeconds`; email mới khớp nhân sự đã có tài khoản khác hoặc xung đột với SĐT hiện có → 409 không ghi; danh bạ nhân sự lỗi → 503; `field: 'phone'` → 403 `PHONE_CHANGE_LOCKED`. Trang quản trị người dùng: chặn gán định danh admin cứng (`PROTECTED_IDENTITY`), tự đổi email/SĐT của mình (`SELF_CONTACT_CHANGE`), và người không phải Quản lý gán định danh trùng nhân sự cấp cao hơn (`HR_ROLE_ESCALATION`). Đăng nhập Google chỉ tự liên kết vào tài khoản chưa gắn khớp **theo email**; còn lại 409 `HR_IDENTITY_CONFLICT`. `POST /api/auth/recovery` chỉ đổi **email khôi phục** (xác nhận mật khẩu hiện tại); body có `soDienThoai` → 400 `PHONE_CHANGE_NOT_ALLOWED` — SĐT chỉ Quản lý đổi ở trang quản trị. `POST /api/auth/change-password`. Giao diện `/account/#profile` và hộp hồ sơ chung (`shared-nav.js`) hiển thị email chỉ đọc: tài khoản nhân sự thấy gợi ý "liên hệ Quản lý", tài khoản thường có "Đổi email" mở hộp OTP 2 bước. | Cao | Hoàn thành |
| FR-08.6 | **ID Telegram** (`app_users.telegram_id`, chuỗi số nguyên dương ≤ 20 chữ số, rỗng = hủy liên kết): lưu trong một giao dịch (khóa advisory theo ID) thu hồi liên kết cũ, tạo liên kết `manual` và đồng bộ `hr_employees.telegram_id`; trùng với tài khoản/liên kết bot/nhân sự đang hoạt động khác → 409 `TELEGRAM_ID_EXISTS`. Chỉ **Quản lý** (hoặc admin cứng) được thêm/sửa ID ở hồ sơ của chính mình (`telegramEditable`); vai trò khác gửi ID thay đổi → 403 `TELEGRAM_ID_LOCKED`. Quản lý đổi ID người khác qua `PUT /api/admin/users/:id`. | Cao | Hoàn thành |
| FR-08.7 | Quản trị người dùng `/api/admin/users*` (quyền `account.users`, `account.users.manage`, `account.permissions`): danh sách, tạo, sửa, đặt lại mật khẩu, xóa, xem/ghi đè quyền từng tài khoản (`/api/admin/permissions/catalog`, `/api/admin/users/:id/permissions`). Danh mục quyền trả `requires` và `forbiddenRoles` để form khóa đúng ô. | Cao | Hoàn thành |
| FR-08.8 | Chống leo thang (`accountPolicy.js`): người không phải Quản lý chỉ được thêm quyền chính mình có và không đụng tài khoản Quản lý/admin cứng; **Quản lý thường** không đặt lại mật khẩu, đổi email/SĐT/ID Telegram, hạ vai trò, rút quyền, khóa hay xóa **Quản lý khác** (403 `ACCOUNT_POLICY_DENIED`, vẫn thao tác được với nhân viên thường và chính mình); chỉ **Quản lý cấp cao** (admin cứng, `isSeniorAdmin` trong `GET /api/auth/me`) giữ đủ quyền. | Cao | Hoàn thành |
| FR-08.9 | Yêu cầu đổi vai trò tự thân: `POST /api/role-requests`, danh sách/chi tiết, Quản lý duyệt/từ chối `PATCH /api/role-requests/:id/status` (kèm kiểm tra `accountPolicy`); lưu ở `server/data/roleChangeRequests.json`. | Trung bình | Hoàn thành |
| FR-08.10 | Phân quyền theo **tính năng** (`featureRegistry.js`), giải lại mỗi request (không nằm trong JWT): quyền mặc định theo vai trò + ghi đè từng tài khoản (`feature_permissions` chỉ lưu phần lệch); `alwaysOn` (`account.profile`); `requires` (quyền phụ bị loại khi thiếu quyền gốc); `forbiddenRoles` (Khách không có `stockLocations.view`). Admin cứng luôn đủ mọi quyền. | Cao | Hoàn thành |
| FR-08.11 | Bảo vệ trang HTML nội bộ ở server (`pageGuard.js`, bảng `PAGE_FEATURES`: `/reports`, `/shipment/lifecycle`, `/humanresources`, `/stock-locations`, `/account`); thiếu quyền → chuyển tới trang đầu tiên được phép hoặc `/login/?next=`; fail-soft với lỗi 5xx. `shared-nav.js` là lớp UX thứ hai. | Cao | Hoàn thành |
| FR-08.12 | Danh bạ nhân sự: tài khoản đối chiếu với `hr_employees` theo email/SĐT; nhân sự có trong danh sách thì vai trò suy từ BỘ PHẬN (trừ khi có `vaiTroOverride`). Cơ chế tự khóa `hr_removed` đã bỏ; không khớp dòng nhân sự thì giữ vai trò/quyền hiện có. Từ 2026-10-05 tài khoản **đã gắn** một dòng nhân sự (`hr_employee_id`) không tự gắn sang dòng khác khi email/SĐT đổi hoặc trỏ sang nhân sự khác: giữ ràng buộc cũ và ghi log cảnh báo. | Trung bình | Hoàn thành |
| FR-08.13 | Chuông thông báo `/api/notifications*` (danh sách, số chưa đọc, đánh dấu đã đọc, xóa): lưu ở `server/data/notifications.json`; thông báo nghỉ phép mới/duyệt và thêm/gỡ tài liệu quy định gửi tới mọi tài khoản có quyền liên quan. | Trung bình | Hoàn thành |

## 3.9. FR-09: (đã thu hồi)

Lớp hiệu ứng 3D và giám sát hiệu năng thích ứng đã gỡ bỏ vì hiệu năng; không còn yêu cầu FR-09.x.

## 3.10. FR-10: Nghỉ phép & Telegram

| **Mã** | **Mô tả** | **Ưu tiên** | **Trạng thái** |
|---|---|---|---|
| FR-10.1 | Đơn nghỉ lưu bằng `DATE` + buổi (`Sáng`/`Chiều`) cho mốc bắt đầu/kết thúc, `tong_buoi_nghi`, `tong_ngay_nghi` = buổi / 2 (cột GENERATED); `request_id` dạng `NP-YYYYMMDD-NNNN` do DB sinh. Web dựng lại chuỗi `"Sáng 22/08/2026"` khi trả API. | Cao | Hoàn thành |
| FR-10.2 | Phép tính buổi tính từ đầu buổi bắt đầu đến hết buổi kết thúc (Sáng–Sáng cùng ngày = 1 buổi; Chiều hôm trước–Sáng hôm sau = 2 buổi; Sáng–Chiều cùng ngày = 2 buổi). CHECK DB chặn kết thúc trước bắt đầu và "Chiều → Sáng" cùng ngày. | Cao | Hoàn thành |
| FR-10.3 | Nhân viên HR hoạt động tự gửi web (`/self`), danh tính lấy từ FK HR, ngày/buổi+lý do bắt buộc+bàn giao tùy chọn+tổng thời gian. Bot ngoài repo tiếp tục ghi hợp đồng cũ. Tự ý nghỉ dùng `hr.leave.absence.manage`, mặc định Quản lý. | Cao | Code hoàn thành |
| FR-10.4 | Trạng thái đơn: `Chưa duyệt`, `Đã duyệt`, `Từ chối`, `Vi phạm` (`Vi phạm` do quy định giờ gửi của CSNS-NP-01: gửi sau 07:45 ca sáng / 12:30 ca chiều ngày bắt đầu). Trạng thái `Tạm duyệt` **đã gỡ** (migration `0030`, đơn cũ về `Chưa duyệt`). Loại yêu cầu: `Xin nghỉ phép`, `Tự ý nghỉ (HR ghi nhận)`. | Cao | Hoàn thành |
| FR-10.5 | Tab Nghỉ phép (`hr.leave`): bảng có cột Thời gian gửi, lọc cơ sở/phòng ban/tên/khoảng ngày (mặc định chỉ lịch nghỉ giao với hôm nay), phân trang chọn số dòng/trang, huy hiệu cảnh báo nghỉ gấp (`HR_URGENT_LATE_NIGHT_HOUR`, `HR_URGENT_FLAG_MONTHLY_THRESHOLD`), xuất Excel. Tab Danh sách nhân sự (`hr.employees`) có xuất Excel. | Cao | Hoàn thành |
| FR-10.6 | **Lịch nghỉ phép** cạnh chuông ở mọi trang (tài khoản có `hr.leave`): chọn ngày để xem ai nghỉ buổi sáng/chiều/cả ngày; đơn `Từ chối` không hiện. | Trung bình | Hoàn thành |
| FR-10.7 | Đơn mới thông báo tất cả người duyệt đúng phạm vi hoặc senior dự phòng; thiếu dự phòng giữ chờ/cảnh báo. Nút chuông chỉ hiện khi canManage, PATCH gửi version đã hiển thị. Quyết định tăng decision_version. | Cao | Code hoàn thành |
| FR-10.8 | Bot Telegram riêng cho quản lý chạy cùng Express, chỉ hội thoại riêng tư; `POST /api/telegram/manager-leave/webhook` kiểm tra `X-Telegram-Bot-Api-Secret-Token`; gọi Telegram bằng `fetch` native, không thêm thư viện bot. Mặc định tắt (`HR_MANAGER_TELEGRAM_ENABLED`). | Cao | Hoàn thành |
| FR-10.9 | Quét DB mỗi `HR_MANAGER_TELEGRAM_SCAN_INTERVAL_MS` (mặc định 5000 ms, giới hạn 1.000–60.000): gửi mọi đơn `Xin nghỉ phép` mới kể cả `Vi phạm`, bù đơn `Chưa duyệt`/`Vi phạm` chưa gửi; không gửi `Tự ý nghỉ (HR ghi nhận)`; lịch sử kết thúc trước mốc bật lần đầu không gửi lại. | Cao | Hoàn thành |
| FR-10.10 | Người hoạt động có hr.leave.manage và grant phòng ban/cơ sở đúng, hoặc quản trị dự phòng khi không có ai phù hợp; self-approve được phép. Telegram phải có ID/Start; thiếu ID không làm đổi tuyến duyệt web. Quyền/tài khoản kiểm tra lại mỗi thao tác; phòng ban snapshot bất biến. | Cao | Code hoàn thành |
| FR-10.11 | Telegram chỉ có hai nút **Phê duyệt** (lưu `Đã duyệt`) và **Từ chối**; callback `Chưa duyệt`/`Vi phạm` của tin cũ bị từ chối; khởi động lại làm mới nút trên tin của đơn chưa kết thúc. `Đã duyệt`/`Từ chối` khóa Telegram; web vẫn đổi/mở lại. `hrLeaveDecisionService` + `decision_version` chặn nút/phiên cũ và đua web–Telegram. | Cao | Hoàn thành |
| FR-10.12 | Mini App cùng origin “Từ chối <tên nhân viên>”, OK/Hủy, lý do trim tùy chọn tối đa 500 ký tự. initData bot quản lý hợp lệ trong 15 phút + version, không login web. Lỗi giữ nội dung. Phiên reply cũ được hỗ trợ đến hết hạn. | Cao | Code hoàn thành |
| FR-10.13 | Đồng bộ người duyệt, thời điểm, trạng thái và lý do giữa web và mọi tin đã gửi. Migration `0029`: sự kiện tạo/đổi đơn, giao tin có lease/retry, phiên từ chối, inbox idempotent theo `update_id` (tuần tự trong cùng chat) và singleton mốc bật lần đầu. `decision_notified_at` chỉ phục vụ bot xin nghỉ. | Cao | Hoàn thành |
| FR-10.14 | Cầu `hrLeaveDbRealtime.js` đưa đơn tạo/đổi từ nguồn DB ngoài vào SSE HR bằng bản chụp/phiên bản dùng chung; kết nối/kết nối lại SSE làm mới danh sách; `HR_LEAVE_DB_REALTIME_ENABLED` mặc định true, độc lập công tắc bot. | Cao | Hoàn thành |
| FR-10.15 | Tab **Quy định công ty** (`hr.rules`): 2 tài liệu dựng sẵn (Giờ giấc làm việc, Quy định nghỉ phép) và PDF do Quản lý (`hr.rules.manage`) tải lên (lưu `hr_rule_documents.content BYTEA`); gỡ được mọi tài liệu, có "Khôi phục tài liệu mặc định"; mọi tài liệu có "Tải về PDF"; thêm/gỡ báo lên chuông. API `/api/hr/rules/documents*`. | Trung bình | Hoàn thành |

| FR-10.16 | `/donnghi`: đơn còn cần xử lý trong phạm vi, bộ lọc phòng ban, 10 đơn/trang; không đổi thông báo. Thẻ đồng bộ quyết định/mở lại qua sự kiện bền vững. | Cao | Code hoàn thành |
| FR-10.17 | Inbox độc lập giao tin, ACK sau enqueue bền vững; log enqueue/queue/database/telegram/ack. Nghiệm thu staging p95 tiếp nhận <1 giây, kết quả thường <2 giây và thử chậm/429/restart/dedupe. | Cao | Chờ đo môi trường thật |

## 3.11. FR-11: Quản lý công nợ

| **Mã** | **Mô tả** | **Ưu tiên** | **Trạng thái** |
|---|---|---|---|
| FR-11.1 | Parse workbook công nợ theo header/alias, bỏ hàng tổng số 2, giữ `null` cho ô trống/`#N/A`, hỗ trợ số và phần trăm Việt Nam. | Cao | Hoàn thành |
| FR-11.2 | Ghép khách với CN1/CN3/CN7 bằng tên chuẩn hóa Unicode/khoảng trắng/hoa thường, không fuzzy matching; tên trùng bị đánh `Lỗi dữ liệu` và khóa sửa trạng thái. | Cao | Hoàn thành |
| FR-11.3 | Lịch 1/3 tạo cảnh báo `Chưa thu` theo ma trận đối chiếu; mọi lịch tạo `Quá hạn` khi nợ quá hạn dương; chỉ miễn cảnh báo khi cả nợ hiện tại và nợ quá hạn đều dưới 400.000đ. | Cao | Hoàn thành |
| FR-11.4 | Thiếu bất kỳ CN1/CN3/CN7 sẽ tắt riêng cảnh báo `Chưa thu`; cảnh báo `Quá hạn` vẫn hoạt động. | Cao | Hoàn thành |
| FR-11.5 | Dashboard gồm 4 KPI, biểu đồ theo sale/lịch, top nợ hiện tại/quá hạn, bảng 10 cột; hỗ trợ lọc, tìm, click biểu đồ, sort ba trạng thái và phân trang 100 dòng. | Cao | Hoàn thành |
| FR-11.6 | Trạng thái `Chưa xử lý/Đang xử lý/Đã xử lý/Bỏ qua` lưu theo `(branch, customer_key)` trong `debt_collection_statuses`; Đã xử lý/Bỏ qua rời hàng chờ và tự hết hiệu lực khi chữ ký cảnh báo thay đổi. | Cao | Hoàn thành |
| FR-11.7 | `PATCH /api/debt-management/status`: quyền `reports.debt.edit` (mặc định Quản lý + Trợ lý). Cơ sở lấy từ `req.branch`, không nhận từ payload; vai trò khác chỉ thấy pill đọc-only. | Cao | Hoàn thành |
| FR-11.8 | Ở phạm vi `Cả hai`, một PATCH ghi trạng thái cho cả hai cơ sở vật lý trong đúng một transaction PostgreSQL (xem FR-12.6). | Cao | Hoàn thành |

## 3.12. FR-12: Phạm vi dữ liệu "Cả hai" cơ sở

| **Mã** | **Mô tả** | **Ưu tiên** | **Trạng thái** |
|---|---|---|---|
| FR-12.1 | **Cơ sở chỉ là bộ lọc xem** (từ 2026-09-29): `allowedBranches(user)` luôn trả cả hai cơ sở vật lý, `selectableBranches(user)` luôn thêm `Cả hai`; cơ sở gán cho tài khoản chỉ là cơ sở **mặc định** lúc đăng nhập (rỗng = Cả hai). `POST /api/branch` từ chối giá trị ngoài danh sách chọn được; cookie `tks_branch` chỉ là gợi ý và luôn xác thực lại. | Cao | Hoàn thành |
| FR-12.2 | Mọi lớp truy vấn dữ liệu nhận cơ sở vật lý: route quy `req.branch` qua `resolveBranchScope` trước khi gọi repository. `branchLabelToCode('Cả hai')` trả chuỗi rỗng nên `Cả hai`/`both` không bao giờ xuống cột `branch` của database (chỉ `hanoi`/`saigon`; riêng `app_users.co_so` nhận thêm `both`/rỗng). | Cao | Hoàn thành |
| FR-12.3 | `GET /api/dashboard` ở `Cả hai` cộng KPI/bucket hai cơ sở. **Hàng hóa và giao dịch cùng mã ở hai cơ sở là hai dòng riêng, khóa `(cơ sở, mã)`**; **khách gộp theo tên** (mã khách khác nhau giữa hai cơ sở, không còn cột mã khách); mọi bảng có cột "Cơ sở". Riêng bảng Cơ cấu tồn kho và Báo cáo hàng hóa gộp 1 dòng/mã. Khóa cache kết quả `Cả hai` chứa phiên bản nguồn của cả hai cơ sở. | Cao | Hoàn thành |
| FR-12.4 | `/api/customer-product-revenue`, `/api/customer-suggest`, `/api/product-report*` ở `Cả hai` chạy trên dữ liệu đã gộp theo cùng quy tắc; phản hồi ở một cơ sở giữ nguyên hình dạng, chế độ gộp chỉ **thêm** trường. | Cao | Hoàn thành |
| FR-12.5 | Xuất file ở `Cả hai` thêm cột `Cơ sở` cho worksheet giao dịch, ghép dữ liệu theo `(cơ sở, mã)`, dùng tiền tố tên file `TKS_` thay `HN_`/`SG_`. Bảng Quản lý công nợ lọc/sắp xếp trên dòng gộp rồi tách một dòng cho mỗi cơ sở. | Cao | Hoàn thành |
| FR-12.6 | PATCH trạng thái công nợ ở `Cả hai` ghi cùng `(customer_key, trạng thái)` cho mọi cơ sở trong phạm vi bằng một transaction (`BEGIN`/`COMMIT`, lỗi → `ROLLBACK` toàn bộ). Chỉ ghi cơ sở thực sự có khách trong nguồn công nợ; không cơ sở nào có → `404 DEBT_CUSTOMER_NOT_FOUND`; cơ sở không đọc được nguồn vẫn được ghi để hai cơ sở không lệch. Cache workflow/dashboard chỉ bị xóa **sau** COMMIT. | Cao | Hoàn thành |
| FR-12.7 | Mỗi cơ sở được ghi **chữ ký cảnh báo của chính nó** (tính lại bằng đúng hàm/nguồn mà `/api/dashboard` dùng); nếu chữ ký client gửi không khớp chữ ký hiện tại của dòng gộp (màn hình đã cũ) thì giữ chữ ký client cho mọi cơ sở để trạng thái tự hết hiệu lực ở lần đọc sau; cơ sở không đọc được nguồn dùng tạm chữ ký client. | Cao | Hoàn thành |
| FR-12.8 | HR hiển thị cả hai cơ sở kèm cột `Cơ sở` và bộ lọc cơ sở độc lập với bộ chọn ở thanh điều hướng; SSE và thông báo dùng cơ sở vật lý của bản ghi. | Cao | Hoàn thành |
| FR-12.9 | Quét đứt hàng ở `Cả hai` chạy tuần tự hai cơ sở như job con rồi gộp (mỗi dòng kèm cơ sở); một cơ sở lỗi thì job cha báo lỗi. | Trung bình | Hoàn thành |

**Giới hạn đã biết:** (a) dòng công nợ gộp hiển thị **trạng thái** của cơ sở xuất hiện trước (Hà Nội trước Sài Gòn) và không tính lại — nếu về sau chỉ một cơ sở đổi số nợ, trạng thái kết thúc của riêng cơ sở đó hết hiệu lực trong khi pill trên dòng gộp vẫn hiện trạng thái cũ (khách quay lại hàng chờ — an toàn); (b) quét đứt hàng ở `Cả hai` tốn gấp đôi thời gian quét so với một cơ sở.

## 3.13. FR-13: Vị trí hàng

| **Mã** | **Mô tả** | **Ưu tiên** | **Trạng thái** |
|---|---|---|---|
| FR-13.1 | `STOCK_LOCATIONS_SPREADSHEET_ID` chỉ workbook HN/SG dùng chung; service account có Viewer. Đọc `FORMATTED_VALUE`, nhận diện hàng/cột theo tiêu đề (không cố định chỉ số), không lưu Postgres, không migration. | Cao | Hoàn thành |
| FR-13.2 | `GET /api/stock-locations?branch=HN\|SG` trả `{ branch, rows: [{ code, name, totalQuantity, notes, arrivalDate, location }] }`; yêu cầu đăng nhập + quyền + cơ sở thuộc phạm vi bộ chọn. Thiếu/sai branch: 400; ngoài phạm vi/thiếu quyền: 403; thiếu cấu hình/sheet/header hoặc Google lỗi: 503 với `STOCK_LOCATIONS_NOT_CONFIGURED` / `_SHEET_MISSING` / `_HEADERS_MISSING` / `_SOURCE_UNAVAILABLE`. Thành công trả `Cache-Control: no-store`. | Cao | Hoàn thành |
| FR-13.3 | Trang `/stock-locations/#hn\|sg` và nhóm sidebar "Vị trí hàng": chọn Hà Nội/Sài Gòn chỉ hiện tab tương ứng, Cả hai hiện hai tab (mặc định HN). Bảng 6 cột (Mã hàng, Tên hàng, Tổng SL, Ghi chú hàng hóa, Ngày về, Vị trí); tìm mã/tên/vị trí không dấu; sắp xếp toàn bộ rồi phân trang 100 dòng; mỗi tab giữ trạng thái riêng; nút hiện/ẩn cột nhớ riêng điện thoại/máy tính (điện thoại mặc định Tên hàng, Tổng SL, Vị trí). Không xuất file, không tải định kỳ. | Cao | Hoàn thành |
| FR-13.4 | Giữ từng dòng có mã hoặc tên theo thứ tự sheet, không gộp mã trùng; giữ SL = 0/vị trí trống, số 0 đầu mã và xuống dòng. Chỉ gộp các lượt đọc đồng thời cùng workbook/cơ sở, không cache giá trị. | Cao | Hoàn thành |
| FR-13.5 | `stockLocations.view` mặc định cho mọi vai trò nội bộ; Khách luôn bị loại khỏi quyền hiệu lực dù có ghi đè; API cấp quyền từ chối grant cho Khách (400) và form vô hiệu hóa lựa chọn. Bản đồ cột HN/SG và nghiệm thu xem `docs/stock-locations-setup.md`. | Cao | Hoàn thành |

## 3.14. FR-14: Vòng đời đơn hàng

| **Mã** | **Mô tả** | **Ưu tiên** | **Trạng thái** |
|---|---|---|---|
| FR-14.1 | Trang `/shipment/lifecycle/` (quyền `shipment.lifecycle`) hiển thị **mọi đơn đặt hàng KiotViet** của HN + SG (Phiếu tạm, Đã xác nhận, Đang giao hàng, Hoàn thành, Đã hủy; ~60 nghìn đơn) ghép Google Sheet `DonHang_HN`/`DonHang_SG` theo (cơ sở, mã đơn). Đơn có trên sheet lấy trạng thái vòng đời của sheet; đơn chỉ có ở Kiot nhận "Đơn chưa gửi kế toán" (thấp nhất, chỉ đọc); dòng sheet không khớp đơn Kiot nào bị bỏ. Postgres lỗi → `kiot.ok = false`, trang vẫn trả đơn sheet kèm cảnh báo. | Cao | Hoàn thành |
| FR-14.2 | `GET /api/shipment/lifecycle?branch&status&kiotStatus&dateField&from&to&mode&q&sort&dir&page&pageSize`: lọc, sắp xếp, phân trang ở máy chủ (`shipment/orderLifecycleQuery.js`), trả 1 trang (mặc định 100, tối đa 200 dòng); tham số sai → 400 kèm mã. Cache đơn Kiot 2 phút kiểu stale-while-revalidate (`kiotOrdersRepository.js`). | Cao | Hoàn thành |
| FR-14.3 | Cột **Trạng thái KiotViet** (+ bộ lọc), **Ghi chú** (mô tả đơn), **Giá trị đơn** (mọi đơn) và **Giá trị có bán** (chỉ đơn Phiếu tạm) = Σ từng mặt hàng `min(SL đặt, max(0, tồn kho cơ sở của đơn)) × đơn giá sau chiết khấu` (bỏ dòng mã `VAT*`; không cộng hàng đang vận chuyển). Nút "Cột hiển thị" ẩn/hiện cột (nhớ theo trình duyệt, "Mã đơn" luôn hiện). | Cao | Hoàn thành |
| FR-14.4 | `GET /api/shipment/lifecycle/order-detail?code=&branch=HN\|SG`: chi tiết đơn + từng dòng hàng kèm tồn kho / **Điều chuyển SG** (hàng đang vận chuyển, chỉ tham khảo) / có bán (404 `ORDER_NOT_FOUND`, 400 `INVALID_CODE`/`INVALID_BRANCH`). | Cao | Hoàn thành |
| FR-14.5 | Tra cứu theo mã `GET /:orderCode` (quyền `shipment.lookup`; tra nhiều mã `POST /lookup` đã gỡ 2026-10-05), Lịch sử `GET /history` (`shipment.history`), Ghi đè `POST /:orderCode/override` (`shipment.override`, mặc định chỉ Quản lý; ghi 1 dòng vào tab `Lịch sử cập nhật`). Từ 2026-10-03 cả bốn quyền `requires: 'shipment.lifecycle'`. Tám trạng thái: 6 tính từ mốc thời gian (Đơn chưa gửi kế toán → Đã gửi kế toán → Đang được giao → Đã giao thành công → Đã nhận (Tại kho) → Đã nhận (Đi giao xong)) + `Sự cố`, `Đã hủy` (chỉ qua ghi đè). Bộ lọc trạng thái của bảng "Toàn bộ đơn hàng" và "Lịch sử cập nhật" đều có đủ tám trạng thái (bảng "Toàn bộ đơn hàng" thêm "Sự cố", "Đã hủy" từ 2026-10-05). | Cao | Hoàn thành |
| FR-14.6 | Xuất Excel `POST /api/shipment/lifecycle/export` (quyền `shipment.export`, mặc định chỉ Quản lý) nhận chính bộ lọc/sắp xếp của GET (không `page`), xuất mọi dòng khớp, tối đa 20.000 dòng (vượt → 400 `TOO_MANY_ROWS`), có cột Ghi chú và Trạng thái KiotViet. | Cao | Hoàn thành |
| FR-14.7 | Mặc định vai trò có `shipment.lifecycle`: mọi vai trò nội bộ trừ Nhân viên kho, marketing, mua hàng; Khách không có. Mục sidebar "Vòng đời đơn hàng" chỉ hiện khi có quyền này. | Cao | Hoàn thành |

## 3.15. FR-15: Sổ quỹ

| **Mã** | **Mô tả** | **Ưu tiên** | **Trạng thái** |
|---|---|---|---|
| FR-15.1 | `/cashbook/` gộp phiếu HN/SG, quỹ ngân hàng và Tiền mặt; số dư từ mốc chốt gần nhất cộng phiếu sau mốc, bỏ phiếu hủy, quỹ chưa chốt hiện `Chưa chốt`. Không dùng cookie cơ sở. | Cao | Code/kiểm thử hoàn tất, migration `0033` đã áp; chờ deploy production |
| FR-15.2 | Quản lý có `cashbook.view`/`cashbook.manage` mặc định; bộ lọc ngày giờ VN, phiếu, nhóm, trạng thái, hạch toán, người tạo, nhân viên, đối tác/SĐT; sổ chi tiết phân trang và số dư lũy kế khi đủ điều kiện. | Cao | Code/kiểm thử cục bộ hoàn tất |
| FR-15.3 | Chốt số dư trong transaction, xem lịch sử và số chênh lệch; xuất ba bảng Excel/HTML với cột chọn trước, tối đa 20.000 dòng. Migration `0033` và đồng bộ `cash_book_accounts` phải hoàn tất trước khi chốt ban đầu. | Cao | Migration `0033` đã áp; chờ deploy production |

## 3.16. FR-16: Báo cáo kinh doanh

Tab cấp 2 `#business` của `/reports/` (mục cuối nhóm Báo cáo tổng hợp trên sidebar). Thay báo cáo tăng trưởng Sale / Khách / Mã hàng trước đây làm tay trên Google Sheets. Spec: `docs/superpowers/specs/2026-10-07-business-report-design.md`.

| **Mã** | **Mô tả** | **Ưu tiên** | **Trạng thái** |
|---|---|---|---|
| FR-16.1 | Quyền xem `reports.business` (mặc định Quản lý, Trợ lý, Nhân viên sale — như các tab báo cáo khác). Số liệu **luôn gộp Hà Nội + Sài Gòn**, không theo bộ chọn cơ sở. Các tháng hiển thị từ **T3/2026** tới tháng hiện tại (bỏ T2 vì dữ liệu DB chỉ có từ 05/02). Ba mục: Tăng trưởng Sale, Tăng trưởng Khách hàng, Tăng trưởng Mã hàng; mỗi mục có KPI đầu mục (Doanh số tháng này, Quy đổi 30 ngày, Tháng trước, Tăng trưởng chung, TB 4 tháng, số sale / khách hoạt động / mã hoạt động). | Cao | Code hoàn thành |
| FR-16.2 | **Doanh số tháng** = Σ `invoices.total` (đã trừ giảm giá cả đơn) của hóa đơn `Hoàn thành` (điều kiện giống cột Trạng thái tab Hóa đơn: theo `raw->>'statusValue'`, trống thì suy từ mã trạng thái) có ngày bán trong tháng − Σ `|returns.total|` (đã trừ giảm giá trả) của phiếu trả `Đã trả` có ngày trả trong tháng. Tháng tính theo giờ Việt Nam. Hóa đơn `Đang xử lý`, `Đã hủy` không tính. | Cao | Code hoàn thành |
| FR-16.3 | **Định danh:** khách = (cơ sở, mã KH) — cùng mã ở HN và SG là hai khách khác nhau; chứng từ không có mã KH thì tìm mã theo tên khách chuẩn hóa trong danh mục khách cùng cơ sở (trùng tên lấy mã lớn nhất), không tìm thấy thì là Khách lẻ (mã rỗng). Mã hàng = mã hàng, gộp hai cơ sở. **Doanh số theo mã hàng** lấy từ dòng chi tiết: tổng chứng từ được phân bổ cho từng dòng theo tỷ lệ thành tiền dòng, nên tổng theo mã bằng tổng theo khách (lệch vài xu do làm tròn); chứng từ có tổng thành tiền dòng = 0 không phân bổ, dòng không có mã hàng không tính. | Cao | Code hoàn thành |
| FR-16.4 | **Sale = nhóm khách hàng trên KiotViet** (`customers.raw->>'groups'`), không lấy tên người bán trên hóa đơn. Toàn bộ lịch sử của khách đi theo **nhóm hiện tại**: khách đổi nhóm thì doanh số các tháng trước cũng chuyển sang sale mới. Khách không có nhóm, Khách lẻ, mã khách không có trong danh mục → dòng **"Chưa phân nhóm"** (không tính vào KPI "Số sale"). | Cao | Code hoàn thành |
| FR-16.5 | **Chỉ số mỗi dòng:** *Tháng hiện tại* = doanh số từ ngày 1 đến hôm nay; *Quy đổi 30 ngày* = tháng hiện tại × 30 / số ngày đã qua của tháng (gồm hôm nay); *Tăng trưởng* = quy đổi / doanh số tháng trước × 100%, tháng trước ≤ 0 thì hiện "—"; *TB 4 tháng* = (doanh số 3 tháng liền trước + quy đổi tháng này) / 4. **Khách hoạt động** = TB 4 tháng > 0; "SL Khách" của sale = số khách hoạt động thuộc nhóm đó. Tính ở server (`businessReport/businessMonths.js`), API trả sẵn. | Cao | Code hoàn thành |
| FR-16.6 | **Bảng:** Sale (Sale, SL Khách, TB 4 tháng, Tăng trưởng, Tháng hiện tại (đến dd/mm), rồi các tháng trước giảm dần tới T3); Khách hàng (Mã KH, Tên, Cơ sở, Sale, Level giá = `customers.raw->>'comments'`, rồi các cột số liệu); Mã hàng (Mã, Tên, rồi các cột số liệu). Sắp xếp mặc định theo TB 4 tháng giảm dần. Bảng khách mặc định chỉ hiện khách hoạt động, có tìm kiếm, lọc theo Sale, lọc theo cơ sở và công tắc "Hiện cả khách không hoạt động". Mọi bảng có tìm kiếm, sắp xếp, phân trang như FR-07.2. | Cao | Code hoàn thành |
| FR-16.7 | **Panel chi tiết** (bấm dòng): thẻ tổng quan (Tháng này, Quy đổi 30 ngày, Tháng trước, Tăng trưởng, TB 4 tháng, Tổng từ T3/26) và biểu đồ cột theo tháng; panel Sale liệt kê khách của sale (bấm khách mở panel khách); panel Khách có top mã hàng 4 tháng gần nhất; panel Mã hàng có top khách 4 tháng gần nhất (tối đa 50 dòng). **Xuất Excel/HTML** từng bảng theo bộ lọc đang chọn (cần `reports.business` và `reports.export`, tối đa 20.000 dòng). | Cao | Code hoàn thành |
| FR-16.8 | **Chốt tháng:** doanh số các tháng đã qua được chốt cứng vào bảng `business_monthly_*` (migration `0036`) bởi job FR-06.13 lúc ≥ 00:10 VN ngày mùng 1; tháng hiện tại và tháng chưa chốt tính trực tiếp bằng cùng câu SQL (cache 60 giây). Bảng sale dựng lại theo nhóm khách hiện tại ở mỗi lượt job. Nút **"Tính lại tháng"** (quyền `reports.business.refreeze`, mặc định chỉ Quản lý) chốt lại một tháng đã qua từ T3/2026 (`POST /api/business-report/refreeze`). Chưa áp migration → API trả 503 `BUSINESS_REPORT_NOT_READY`, giao diện báo "Đang dựng dữ liệu tháng cũ…". | Cao | Code hoàn thành; chưa áp migration `0036` / chưa deploy |

# 4. Yêu cầu phi chức năng (Non-functional Requirements)

| **Mã** | **Hạng mục**         | **Mô tả yêu cầu**                                                                                                                               |
|--------|----------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| NFR-01 | Hiệu năng            | Mỗi tab báo cáo tải riêng (payload Tổng quan ~10 KB thay vì ~5 MB); cache hit phản hồi tức thì; Vòng đời đơn hàng trả 1 trang (~8 KB) thay vì cả ~60K đơn. |
| NFR-02 | Khả dụng             | Render.com, mục tiêu uptime ≥ 99% trong giờ hành chính; chỉ một instance (trạng thái tiến trình).                                               |
| NFR-03 | Bảo mật              | HTTPS; secret (Service Account, DB URL, JWT, KiotViet, Telegram) chỉ ở biến môi trường; cơ sở và quyền luôn xác thực ở server; workbook công nợ/vị trí hàng chỉ Viewer; webhook xác thực bằng secret; mật khẩu bcrypt; PII nghỉ phép thu hồi `SELECT` khỏi `reporting_readonly`. |
| NFR-04 | Khả năng mở rộng     | Kiến trúc mô-đun; thêm quyền/trang theo `featureRegistry.js`; schema đổi bằng migration.                                                         |
| NFR-05 | Usability            | Thao tác lọc/tìm/sắp xếp trong 1–2 thao tác; bảng lớn phân trang không đơ UI; hỗ trợ desktop/tablet/điện thoại; Light/Dark.                     |
| NFR-06 | Bảo trì              | Mã nguồn theo mô-đun, comment tiếng Việt; tài liệu khớp code (README, SCHEMA, BRD/SRS/BPMN).                                                    |
| NFR-07 | Giới hạn IO DB       | Rollup/job tổng hợp chỉ ghi dòng thật sự đổi hoặc dựng 1 lần/đêm (bài học sự cố Disk IO Supabase 2026-09-28); `PG_POOL_MAX` mặc định 7 vì 2 instance × max ≤ 15 của session pooler. |
| NFR-08 | Nhật ký & debug      | Log chi tiết lỗi API; `/api/debug` kiểm tra kết nối Postgres, không lộ secret.                                                                  |
| NFR-09 | Độ trễ đồng bộ       | Dữ liệu KiotViet vào Postgres theo nhịp polling (fast 7 phút, slow 20 phút) + rollup nóng ngay sau lượt fast; tồn kho quét toàn bộ tối đa 10 phút/lần; báo cáo hàng hóa và chi tiết hóa đơn 90 ngày cập nhật theo đêm. |
| NFR-10 | Nhất quán thời gian  | Ngày hôm nay, bucket ngày và `updatedAt` theo Asia/Ho_Chi_Minh, độc lập timezone máy chủ.                                                       |
| NFR-11 | An toàn xuất dữ liệu | API xuất chỉ nhận khóa bảng/trường hợp lệ (`EXPORT_TABLE_NOT_ALLOWED`, `EXPORT_FIELD_NOT_ALLOWED`), kiểm tra trước khi nạp dữ liệu, mã truyền vào SQL bằng tham số, vô hiệu hóa chuỗi có thể bị Excel hiểu là công thức. |
| NFR-12 | Kiểm thử tự động     | `node:test` (177 file, 1.704 test tại 05/10/2026) bao phủ auth, HR, Telegram, dashboard, export, đồng bộ, migration (PGlite) và frontend (JSDOM); migration integration chỉ chạy với `SUPABASE_TEST_DB_URL` tách biệt. |
| NFR-13 | Tải xuất file        | Tối đa 2 file xuất đồng thời, hàng đợi tối đa 8; vượt → `503 EXPORT_BUSY`; yêu cầu bị hủy khi đang chờ bị bỏ khỏi hàng đợi.                      |
| NFR-14 | Độ trễ lấy danh sách trường | Với bảng cố định, `POST /api/export/fields` dưới 1 giây vì không truy vấn nặng.                                                           |
| NFR-15 | Chuẩn nhãn trường xuất | Nhãn theo FR-07.8, bị test (`exportFieldCatalog.test.js`, `exportService.test.js`) chặn khi vi phạm.                                         |
| NFR-16 | Bot quản lý nghỉ phép | Token/secret chỉ ở môi trường; webhook xác thực secret, quyền và cơ sở kiểm tra lại khi thao tác; quét 5 giây cần máy chủ chạy liên tục; sự kiện/inbox/giao tin bền vững tiếp tục khi máy chủ hoạt động lại; migration `0029` và `0030` phải áp trước bản web mới dù bot tắt. |

# 5. Yêu cầu giao diện người dùng (UI Requirements)

## 5.1. Bố cục tổng thể

- **Sidebar trái:** logo, nhóm điều hướng theo quyền, thu gọn được; trên điện thoại là drawer.
- **Header:** tên trang, bộ chọn cơ sở, chuông thông báo, lịch nghỉ phép, theme, hồ sơ.
- **Mỗi tab báo cáo** chia thành các mục đánh số; đầu mỗi mục có KPI then chốt; mỗi bảng có thanh công cụ gồm tìm kiếm, bộ lọc Từ–Đến (nếu có), nút Xuất.
- **Quản lý công nợ:** 4 KPI, biểu đồ sale/lịch thanh toán, top 10 nợ hiện tại/quá hạn và bảng thao tác 10 cột; mặc định lọc `Cần xử lý`; hỗ trợ bàn phím, Light/Dark, reduced motion.
- **Báo cáo kinh doanh:** 3 mục Tăng trưởng Sale / Khách hàng / Mã hàng, không có bộ lọc Từ–Đến (cột theo tháng từ T3/2026); bấm dòng mở panel chi tiết có biểu đồ cột theo tháng; nút "Tính lại tháng" chỉ hiện với người có quyền (FR-16).

## 5.2. Trạng thái giao diện cần xử lý

- **Loading** khi tải tab lần đầu; **làm mới nền** (SSE/tab quay lại) không che giao diện.
- **Lỗi API:** thông báo tiếng Việt kèm nội dung lỗi từ server; **dữ liệu trống:** empty state.
- **Không có quyền:** mục/tab bị ẩn; truy cập trực tiếp trang không có quyền bị chuyển hướng.
- **Khách:** chỉ thấy trang Tài khoản/hồ sơ.

# 6. Đặc tả API

Mọi API (trừ `health`, webhook, `auth/login`, quên mật khẩu, `google-config`) yêu cầu cookie `tks_auth`. Lỗi thường có dạng `{ "error": "...", "code": "..." }`.

## 6.1. GET /api/dashboard

**Quyền:** ít nhất một `reports.*`; mỗi tab cần quyền tương ứng (`reports.overview|products|invoices|customers|debt`), phần ngoài quyền bị cắt (`dashboardPermissionFilter.js`).

**Query:** `view` (xem FR-05.1); bộ lọc theo tiền tố — `prMode|prDays|prFrom|prTo` (Hàng hóa), `inMode…` (Hóa đơn và doanh thu theo ngày ở Tổng quan; `ov*` đã bỏ 2026-10-05), `cuMode…` (Khách hàng, mặc định `all`), `npMode…` (Mã mới tạo), `niMode…` (Hàng mới nhập, không gửi thì dùng bộ lọc Hàng hóa); `mode` ∈ `days` | `range` | `all`; `days` dự phòng cho client cũ.

**Response (HTTP 200, rút gọn — mỗi `view` chỉ trả lát cắt tương ứng, khai báo ở `dashboardViews.js` `VIEW_PAYLOAD`):**
```json
{
  "updatedAt": "05/10/2026 15:30:00",
  "filters": { "products": {}, "invoices": {}, "customers": {}, "newProducts": {}, "newlyImported": {} },
  "kpi": {
    "totalProducts": 0, "totalStock": 0, "inStockCodes": 0, "lowStockCount": 0, "totalInventoryValue": 0,
    "totalCustomers": 0, "customersWithDebt": 0, "totalDebt": 0
  },
  "overview":  { "revenueByDay": [], "periodRevenue": 0, "periodGrossRevenue": 0, "periodReturnAmount": 0, "periodInvoices": 0, "periodCancelledInvoices": 0 },
  "products":  { "newProducts": {}, "topSellingProducts": [], "topSellingParentCategories": [], "allSellingProducts": [], "allSellingParentCategories": [],
                 "newlyImported": { "label": "", "count": 0, "products": [], "salesRevenue": 0, "salesQty": 0 } },
  "invoices":  { "revenueByDay": [], "periodRevenue": 0, "periodReturnAmount": 0, "periodInvoices": 0, "periodCancelledInvoices": 0, "transactionsReport": {} },
  "customers": { "topDebt": [], "topRevenue": [] },
  "allProducts": [],
  "debtManagement": { "available": true, "sourceSheet": "Công nợ HN", "dataWarnings": [], "kpi": {}, "bySale": [], "byPaymentSchedule": [], "topCurrentDebt": [], "topOverdueDebt": [], "customers": [] }
}
```
Đã gỡ khỏi payload 2026-10-05 (giao diện không dùng): `kpi.revenueToday`/`invoicesToday`/`cancelledToday`/`activeProducts`/`inventoryValueCategoryCount`, `filters.overview`, `invoices.returnsCount`/`totalReturns`/`periodGrossRevenue` (`overview.periodGrossRevenue` vẫn còn), `stockByCategory`, `stockValueByCategory`, `products.newlyImported.topByRevenue`/`salesByCategory`/`countByCategory`.

`debtManagement.customers[]` gồm `customerKey`, `customerName`, `sale`, `paymentSchedule`, `openingDebt`, `currentDebt`, `overdueDebt`, các tỷ lệ, `alertCodes` (`uncollected`/`overdue`), `dataIssues`, `workflowStatus`, `needsAction`, `canEditStatus`, `alertSignature`, `updatedBy`, `updatedAt`.

**Lỗi:** 400 `INVALID_VIEW`; 500 `{ error, detail, code }`.

`GET /api/dashboard/events` — SSE, sự kiện `dashboard-updated`, heartbeat `:heartbeat` mỗi 25 giây (xem FR-05.3).

## 6.2. Các API báo cáo phụ

| **Endpoint** | **Quyền** | **Mô tả** |
|---|---|---|
| `GET /api/customer-suggest?q&limit` | `reports.customers` hoặc `reports.overview` | Gợi ý mã/tên khách (bảng `customers` nhẹ). |
| `GET /api/customer-product-revenue?code&name` | `reports.customers` hoặc `reports.overview` | Doanh thu 90 ngày theo sản phẩm của 1 khách (`customer_invoice_lines_90d`, đã trừ hàng trả). |
| `GET /api/product-report`, `GET /api/product-report/customers?code=` | `reports.products` hoặc `reports.overview` | Bảng Báo cáo hàng hóa và khung Chi tiết doanh số khách theo mã. |
| `GET /api/inventory-value-history?from&to` | `reports.overview` | Giá trị tồn kho theo ngày theo cơ sở đang xem; bảng chưa migrate → trả rỗng. |
| `GET /api/invoice-detail?code&branch` | `reports.invoices` | Chi tiết hóa đơn; `branch` bắt buộc khi đang xem "Cả hai" và phải thuộc phạm vi đang xem. |
| `PATCH /api/debt-management/status` | `reports.debt.edit` | Body `{ customerKey, status, alertSignature }`; ở "Cả hai" ghi cả hai cơ sở trong 1 transaction, phản hồi thêm `branches`; lỗi `503 DEBT_STATUS_UNAVAILABLE`, `404 DEBT_CUSTOMER_NOT_FOUND`. |
| `GET /api/business-report/sales`, `/customers`, `/products` | `reports.business` | Ba bảng Báo cáo kinh doanh, gộp HN + SG: `months`, `kpis`, `rows` (mỗi dòng có `series` theo tháng, `current`, `normalized`, `prev`, `growth`, `avg4`, `active`) — FR-16. |
| `GET /api/business-report/detail?kind=sale\|customer\|product&key=` | `reports.business` | Panel chi tiết; `key` = tên sale / `<branch>:<mã KH>` / mã hàng; 404 khi không tìm thấy, 400 khi `kind` sai. |
| `POST /api/business-report/refreeze` | `reports.business.refreeze` | Body `{ month: 'YYYY-MM' }`; chốt lại một tháng đã qua (từ T3/2026), 400 nếu tháng không hợp lệ hoặc là tháng hiện tại. |
| `GET /api/business-report/export?kind&format=xlsx\|html&q&sale&branch&inactive` | `reports.business` + `reports.export` | Xuất bảng theo bộ lọc, tối đa 20.000 dòng (400 `TOO_MANY_ROWS`). Mọi API `/api/business-report/*` trả 503 `BUSINESS_REPORT_NOT_READY` khi chưa áp migration `0036`. |
| `GET /api/debug`, `GET /health` | `reports.*` / công khai | Kiểm tra kết nối Postgres / health check. |

`GET /api/search` và `GET /api/customer-product-top` đã gỡ 2026-10-05 (FR-07.9).

## 6.3. Xuất file — `POST /api/export/fields` và `POST /api/export`

**Quyền:** `reports.export`. **Body:** `tableKey` (một trong các khóa ở FR-07.5), `filters`, `context`, `tableSearch`, `columns` (ánh xạ khóa worksheet → danh sách khóa trường; chỉ `/api/export`), `format` (`xlsx` mặc định | `html`).

- `/api/export/fields` trả `{ tableKey, title, selectionMode: 'custom'|'all-only', worksheets: [{ key, name, rowCount, fields: [{ key, label, type, description, selected }] }] }`.
- `/api/export` trả file kèm `Content-Disposition` (`<HN|SG|TKS>_<tên bảng không dấu>_<yyyymmdd_hhmm>.xlsx`). Luồng: kiểm tra hợp lệ → xin chỗ xuất (2 đồng thời, hàng đợi 8) → mã dòng từ `getDashboardData()` → `readRowsByCodes()` → ExcelJS/HTML.
- **Lỗi:** `400 EXPORT_TABLE_NOT_ALLOWED | EXPORT_FIELD_NOT_ALLOWED | EXPORT_FIELDS_REQUIRED | EXPORT_NO_FIELDS_SELECTED | EXPORT_NO_CUSTOMER_SELECTED | EXPORT_SOURCE_NOT_ALLOWED`; `404 EXPORT_NO_DATA`; `503 EXPORT_BUSY`; `499 EXPORT_ABORTED`.

## 6.4. Kiểm tra đứt hàng & Trả NCC (`/api/products/*`, quyền `reports.products`)

`POST /api/products/supplier-returns/import` (multipart, file Excel + cơ sở), `GET /api/products/supplier-returns/import-status`; `POST /api/products/stockout-{recent|30d|90d}/scan` → `{ jobId }`, `GET …/:jobId/progress`, `GET …/:jobId/result`.

## 6.5. API xác thực & tài khoản

| **Endpoint** | **Mô tả** |
|---|---|
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` | Đăng nhập (xem FR-08.1) / đăng xuất / thông tin phiên: `permissions`, `pageFeatures`, `branches`, `isSeniorAdmin`. |
| `POST /api/auth/google`, `GET /api/auth/google-config` | Đăng nhập Google; cấu hình công khai `{ clientId, registrationOpen }`. |
| `POST /api/auth/register` | Tự đăng ký — hiện trả 403 `REGISTRATION_DISABLED` (FR-08.3). `/register/channels`, `/register/send-otp`, `/register/verify` đã gỡ 2026-10-05. |
| `POST /api/auth/forgot-password/channels`, `/send-otp`, `/verify` | Quên mật khẩu bằng OTP (FR-08.4). |
| `GET/POST /api/auth/profile` | Xem hồ sơ (`hrManaged`, `telegramEditable`…) / đổi họ tên (+ ID Telegram nếu là Quản lý); không đổi email: 403 `EMAIL_CHANGE_LOCKED` (TK nhân sự) hoặc 409 `EMAIL_CHANGE_REQUIRES_OTP` (TK thường) (FR-08.5, FR-08.6). |
| `POST /api/auth/profile/contact-change` `{ field: 'email', value }`, `POST /api/auth/profile/contact-change/verify` `{ challengeId, otp }` | Đổi email tài khoản thường bằng OTP gửi tới email mới; TK nhân sự 403 `EMAIL_CHANGE_LOCKED`; `field: 'phone'` 403 `PHONE_CHANGE_LOCKED`; vượt giới hạn gửi/nhập sai → 429 (FR-08.5). |
| `POST /api/auth/recovery`, `POST /api/auth/change-password` | Đổi email khôi phục (body có `soDienThoai` → 400 `PHONE_CHANGE_NOT_ALLOWED`) / đổi mật khẩu (FR-08.5). |
| `GET/POST /api/admin/users`, `PUT/DELETE /api/admin/users/:id`, `POST /api/admin/users/:id/reset-password`, `GET /api/admin/permissions/catalog`, `GET/PUT /api/admin/users/:id/permissions` | Quản lý người dùng và phân quyền (FR-08.7, FR-08.8). |
| `POST/GET /api/role-requests`, `GET /api/role-requests/:id`, `PATCH /api/role-requests/:id/status` | Yêu cầu đổi vai trò (FR-08.9). |
| `GET/POST /api/branch` | Xem/đổi cơ sở đang xem (cookie `tks_branch`). |
| `GET /api/notifications`, `/unread-count`; `PATCH /api/notifications/:id/read`, `/read-all`; `DELETE /api/notifications/:id`, `DELETE /api/notifications` | Chuông thông báo. |

## 6.6. API Nhân sự (`/api/hr/*`)

| **Endpoint** | **Quyền** | **Mô tả** |
|---|---|---|
| `GET /api/hr/leave-requests` (+ `/:id`, `/summary/urgent-flags`) | `hr.leave` | Danh sách/chi tiết đơn nghỉ, bộ lọc cơ sở/phòng ban/tên/ngày; tổng hợp nghỉ gấp. |
| `GET /api/hr/leave-requests/stream` | `hr.leave` | SSE đơn nghỉ phép theo thời gian thực. |
| `POST /api/hr/leave-requests/export` | `hr.leave` | Xuất Excel đơn nghỉ phép. |
| `POST /api/hr/leave-requests` | `hr.leave.absence.manage` | Nhập tay "Tự ý nghỉ (HR ghi nhận)". |
| `PATCH /api/hr/leave-requests/:id/status` | `hr.leave.manage` + phạm vi | Đổi trạng thái kèm `expectedVersion`, xung đột 409; web sửa/mở lại. |
| `GET /api/hr/leave-requests/self/context`, `POST /api/hr/leave-requests/self` | Tài khoản + HR hoạt động | Hồ sơ tin cậy và tự gửi đơn. |
| `POST /api/telegram/manager-leave/miniapp/context`, `/reject` | Telegram initData | Hạn15 phút và phiên bản hiện tại. |
| `GET /api/hr/employees`, `GET /api/hr/employees/export` | `hr.employees` | Danh sách nhân sự và xuất Excel. |
| `POST /api/hr/telegram/link-code[/assign]` | `hr.leave` (`/assign`: `hr.leave.manage`) | Trả 410 `TELEGRAM_SHEET_LINK_DISABLED`. `GET /api/hr/telegram/link-status` đã gỡ 2026-10-05 (ID Telegram xem ở hồ sơ, FR-08.6). |
| `GET /api/hr/rules/documents`, `GET …/:id/file` | `hr.rules` | Danh sách và tải tài liệu quy định. |
| `POST /api/hr/rules/documents`, `POST …/restore-defaults`, `DELETE …/:id` | `hr.rules.manage` | Tải PDF lên, khôi phục mặc định, gỡ. |
| `POST /api/telegram/manager-leave/webhook` | secret | Webhook bot quản lý (xem FR-10.8); không dùng phiên JWT. |

## 6.7. API Vòng đời đơn hàng, Vị trí hàng, Đồng bộ

- `/api/shipment/lifecycle/*` — xem FR-14 (GET `/`, GET `/history`, GET `/order-detail`, GET `/:orderCode`, POST `/:orderCode/override`, POST `/export`).
- `/api/cashbook/*` — xem FR-15 (GET `summary`, `entries`, `filter-options`, `checkpoints`, `export`; POST `checkpoints`).
- `GET /api/stock-locations?branch=HN|SG` — xem FR-13.2.
- `POST /api/kiotviet/webhook/:secret` (và đường dẫn cũ không secret) — xem FR-06.2; `GET /api/internal/kiotviet-sync/status` (`system.syncStatus`).
- `POST /api/client-log` — nhận log lỗi từ trình duyệt.

# 7. Đặc tả dữ liệu

## 7.1. Postgres là nguồn chính

Schema chi tiết, khóa chính, ràng buộc và quy tắc từng migration nằm ở `server/db/SCHEMA.md` — tài liệu bắt buộc đọc trước khi đụng DB. Quy ước chính: `branch` ∈ `hanoi`/`saigon` đứng đầu khóa chính; tiền và số lượng `NUMERIC`; bảng KiotViet giữ `raw JSONB`; **không lọc theo số `status`** mà theo `raw->>'statusValue'` (chuỗi thật từ KiotViet); bảng chứa PII/nội dung nội bộ phải `REVOKE SELECT` khỏi `reporting_readonly`.

## 7.2. Rollup và bảng tổng hợp

| Bảng | Nguồn / công thức chính | Làm mới |
|---|---|---|
| `daily_invoice_summary` | Doanh thu/số hóa đơn theo ngày (`statusValue` = `Hoàn thành`/`Đã hủy`); doanh thu thực tế trừ phiếu trả lúc đọc | rollup nóng/đầy đủ |
| `daily_product_sales` | SL/doanh thu theo ngày từng mã (mọi hóa đơn ≠ `Đã hủy`), đã **trừ** dòng hàng khách trả | như trên |
| `product_first_purchase` | Ngày nhập đầu tiên của mã (cho "Hàng mới nhập") | quét đầy đủ lúc khởi động và mỗi 6 giờ |
| `customer_debt_activity_periods` | Khách có phát sinh trong 1/3/7 ngày (CN1/CN3/CN7) | 5 phút |
| `product_report`, `product_report_customers` | Báo cáo hàng hóa gộp 2 cơ sở và doanh số 90 ngày từng khách | 1 lần/đêm |
| `customer_invoice_lines_90d` (+`_state`) | Chi tiết hóa đơn 90 ngày gắn mã khách, cộng dòng âm của phiếu trả | 1 lần/đêm sau 00:10 VN |
| `inventory_value_snapshots` | Giá trị tồn kho mỗi cơ sở mỗi ngày | chụp 23:59 VN |
| `business_monthly_customer_sales`, `business_monthly_customer_product_sales`, `business_monthly_product_sales` (+`business_monthly_state`) | Doanh số tháng đã chốt theo khách / khách × mã hàng / mã hàng (FR-16.2–16.3); 1 dòng state cho mỗi tháng đã chốt | chốt tháng vừa qua ≥ 00:10 VN ngày mùng 1 |
| `business_monthly_sale_sales` | Doanh số tháng theo sale = nhóm khách hiện tại, dựng lại từ bảng khách | mỗi 5 phút, chỉ ghi dòng đổi |

## 7.3. Định dạng ngày

Ngày hiển thị `dd/MM/yyyy HH:mm` hoặc `dd/MM/yyyy` theo Asia/Ho_Chi_Minh (UTC+07:00). Cột TIMESTAMPTZ của KiotViet giữ "giờ treo tường VN mang nhãn UTC"; mọi mốc "hôm nay", bucket ngày và `updatedAt` tính theo giờ Việt Nam, không dùng múi giờ máy chủ. Bộ sắp xếp phía client đọc `dd/MM/yyyy[ HH:mm[:ss]]` và `yyyy-MM-dd[ HH:mm[:ss]]`.

## 7.4. Google Sheets còn dùng

- **Bảng Công nợ:** tab `Công nợ HN`/`Công nợ SG` (cột Khách hàng, Lịch thanh toán, Nợ đầu kỳ, Nợ hiện tại, Nợ quá hạn, các tỷ lệ…), nhận diện theo header/alias.
- **Vòng đời đơn hàng:** `DonHang_HN`, `DonHang_SG` (mã đơn, các mốc gửi kế toán/giao/nhận/ký nhận…) và tab `Lịch sử cập nhật` do server ghi khi ghi đè.
- **Vị trí hàng:** `Vị trí HN`, `Vị trí SG` — bản đồ cột ở `docs/stock-locations-setup.md`.

# 8. Ma trận truy vết yêu cầu (Traceability Matrix)

| **Yêu cầu BRD**                          | **Yêu cầu SRS liên quan**           |
|------------------------------------------|-------------------------------------|
| Nguồn dữ liệu & cache (5.1)              | FR-01.x                             |
| KPI (5.2)                                | FR-02.x                             |
| Biểu đồ & bảng chi tiết (5.3)            | FR-03.x                             |
| Bộ lọc thời gian (5.4)                   | FR-04.x                             |
| Cập nhật dữ liệu (5.5)                   | FR-05.x, FR-06.x                    |
| Truy cập & bảo mật (5.6)                 | FR-08.x, NFR-03                     |
| Phạm vi theo cơ sở (5.7)                 | FR-12.x                             |
| Bot Telegram quản lý nghỉ phép (5.8)     | FR-10.x, NFR-16                     |
| Vị trí hàng (5.9)                        | FR-13.x                             |
| Vòng đời đơn hàng (5.10)                 | FR-14.x                             |
| Giao diện, phân trang & xuất file        | FR-07.x                             |
| Quản lý công nợ theo cơ sở               | FR-11.x                             |
| Báo cáo kinh doanh (tăng trưởng Sale/Khách/Mã hàng) | FR-16.x, FR-06.13              |
| ~~Lớp hiệu ứng 3D~~                      | FR-09 đã thu hồi                    |

# 9. Rủi ro kỹ thuật & phương án giảm thiểu

| **Rủi ro**                                                                           | **Phương án giảm thiểu**                                                                                            |
|--------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| Cạn Disk IO Budget Supabase do job ghi đè hàng loạt (sự cố 2026-09-28)               | Rollup/CN1/3/7 chỉ ghi dòng đổi; job nặng dựng 1 lần/đêm; không đổi lại thành `ON CONFLICT DO UPDATE` vô điều kiện. |
| KiotViet `modifiedDate` không bump theo biến động tồn kho/phiếu nhập                 | Snapshot tồn kho toàn bộ mỗi 10 phút; `purchases`/`order_suppliers` đối soát toàn bộ danh sách (API_ENDPOINTS.md).   |
| Webhook KiotViet không cập nhật dữ liệu nghiệp vụ (chỉ lưu thô)                     | Dựa vào polling; theo dõi `GET /api/internal/kiotviet-sync/status`; chạy `reconcile` khi nghi ngờ lệch.            |
| Google Sheets lỗi/hết hạn mức/đổi tên tab hoặc header                                | Lỗi ảnh hưởng đúng tính năng (công nợ, vòng đời, vị trí hàng) và báo mã lỗi rõ ràng; nhận diện cột theo header.     |
| Service Account mất quyền trên workbook                                              | Kiểm tra share Viewer/Editor đúng workbook; đặt lại `GOOGLE_SERVICE_ACCOUNT_JSON`.                                  |
| Trạng thái trong tiến trình (OTP, job đứt hàng, SSE, bộ đếm đăng nhập) mất khi restart hoặc chạy nhiều instance | Chỉ chạy một instance; người dùng yêu cầu lại OTP/quét lại khi restart.                                  |
| File JSON cục bộ (`notifications.json`, `roleChangeRequests.json`) mất khi container Render ephemeral | Dùng volume bền (VPS) hoặc chấp nhận mất lịch sử thông báo/yêu cầu đổi vai trò.                                |
| Migration áp sai thứ tự (0026 phải sau code mới; 0029/0030 phải trước bản web mới)   | Làm theo thứ tự trong `server/README.md` và hướng dẫn thiết lập bot.                                                |
| Tài khoản dự phòng in-memory khi Postgres không kết nối được                         | Rủi ro đã biết; cấu hình đúng `SUPABASE_DB_URL`, không dùng cấu hình dự phòng ở production.                         |
| Múi giờ máy chủ khác Việt Nam làm lệch mốc ngày lọc/bucket ngày                      | Mọi phép tính ngày dùng `Asia/Ho_Chi_Minh`.                                                                         |
| Render.com free tier ngủ → cold start                                                | `/health` được ping định kỳ; prewarm cache lúc khởi động; bot quản lý chỉ gần thời gian thực khi máy chủ chạy liên tục. |

*— Hết tài liệu SRS v3.0 —*


## Bổ sung 05/10/2026 — nghỉ phép và tài khoản

Người duyệt đang hoạt động, có `hr.leave.manage`, phòng ban được cấp và cơ sở được gán phù hợp với đơn; nhân viên được cấp quyền cũng được duyệt và được tự duyệt. Gửi tất cả người phù hợp, một quyết định thành công chốt phiên bản. Nếu không có người phù hợp, dùng quản trị cao nhất đang hoạt động; thiếu cả dự phòng thì giữ chờ và cảnh báo. Telegram ID/Start chỉ quyết định khả năng giao tin, không quyết định có người duyệt web.

Nhân viên HR hoạt động tự gửi đơn web bằng danh tính server, giữ phòng ban lúc gửi, tính thời gian Việt Nam. Quản lý mới chọn phòng ban; quản lý cũ mọi phòng ban một lần; cấp nhân viên lần đầu mặc định phòng ban mình, grant không đổi theo chuyển phòng ban. Tự ý nghỉ có quyền riêng. Web/Telegram version chống ghi đè; web sửa/mở lại. Mini App có tên nhân viên,lý do tùy chọn500 ký tự,OK/Hủy; `/donnghi`10 đơn/trang. Bảng người dùng chọn trường theo danh mục Excel,tên cố định,lưu riêng tài khoản,mặc định lọc hoạt động. [Hợp đồng](../hr-leave-upgrade.md). Migration `0031` và staging trước production.
