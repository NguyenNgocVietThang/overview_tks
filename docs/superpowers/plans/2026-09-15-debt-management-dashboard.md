# Quản lý công nợ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay thế tab Công nợ theo kỳ bằng màn hình Quản lý công nợ theo cơ sở, kết hợp workbook Bảng Công nợ, HN1/HN3/HN7 và trạng thái xử lý lưu trong PostgreSQL.

**Architecture:** `/api/dashboard` đọc song song spreadsheet vận hành theo cơ sở và workbook Bảng Công nợ dùng chung, cache riêng 90 giây rồi ghép dữ liệu bằng tên khách chuẩn hóa. Cảnh báo tự động là dữ liệu chỉ đọc; trạng thái xử lý do Quản lý/Trợ lý cập nhật qua PATCH và lưu PostgreSQL.

**Tech Stack:** Node.js 22, Express 4, Google Sheets API, PostgreSQL/Supabase, Vanilla HTML/CSS/JS, Chart.js, ExcelJS, `node:test`.

## Global Constraints

- Workbook Bảng Công nợ chỉ đọc; không sửa cấu trúc hoặc công thức Google Sheet.
- Cơ sở luôn lấy từ `req.branch`, không nhận từ payload client.
- Ghép tên chuẩn hóa chính xác, không fuzzy matching.
- Ngưỡng miễn cảnh báo: cả Nợ hiện tại và Nợ quá hạn đều nhỏ hơn 400.000đ; đúng 400.000đ vẫn cảnh báo.
- Chỉ Quản lý và Trợ lý được sửa trạng thái.
- UI tuân thủ `design-system/tks-dashboard/MASTER.md` và `pages/index.md`.
- Không hardcode spreadsheet ID; cấu hình bằng `DEBT_MANAGEMENT_SPREADSHEET_ID`.

---

## Task 1: Parser và bộ máy cảnh báo

**Files:**
- Create: `server/dashboard/debtManagement.js`
- Create: `server/dashboard/debtManagement.test.js`

**Interfaces:**
- Produces: `normalizeCustomerKey(value)`, `parseDebtManagementRows(rows, branch)`, `buildDebtManagementReport({ managementRows, debtPeriodRows, statuses, branch })`.

- [x] Viết test thất bại cho header HN/SG, bỏ hàng tổng, tiền/phần trăm Việt Nam, `#N/A`, lịch thanh toán và tên chuẩn hóa.
- [x] Viết test thất bại cho ma trận cảnh báo lịch 1/3/7/Hàng tuần, thiếu source sheet, biên 399.999/400.000 và tên trùng.
- [x] Chạy test và xác nhận thất bại do module/chức năng chưa tồn tại.
- [x] Cài đặt parser thuần, KPI, dữ liệu biểu đồ, chữ ký SHA-256 và quy tắc trạng thái hết hiệu lực.
- [x] Chạy test module và refactor khi đã xanh.
- [x] Commit: `feat(debt): parse management sheet and derive alerts`.

## Task 2: Nguồn Google Sheets và dashboard

**Files:**
- Create: `server/sheets/debtManagementSheetsClient.js`
- Modify: `server/config.js`, `server/apphosting.yaml`, `server/dashboard/dashboardData.js`
- Test: `server/sheets/debtManagementSheetsClient.test.js`, `server/dashboard/dashboardData.test.js`

**Interfaces:**
- Produces: `getDebtManagementSheet(branch)` và cache snapshot/version 90 giây.
- Extends: `getDashboardData(filters, branch)` trả `debtManagement`.

- [x] Viết test thất bại cho ánh xạ Hà Nội/Sài Gòn, fail-soft, cache và cách ly cơ sở.
- [x] Thêm cấu hình optional và client Sheets read-only.
- [x] Tải hai nguồn song song, đưa cả hai version vào cache key và ghép report.
- [x] Loại payload `debt` cũ khỏi response nhưng giữ HN1/HN3/HN7 làm nguồn đối chiếu.
- [x] Chạy test Sheets/dashboard và commit `feat(debt): integrate branch-aware debt management source`.

## Task 3: PostgreSQL và API trạng thái

**Files:**
- Create: `server/db/migrations/0011_debt_collection_statuses.sql`
- Create: `server/dashboard/debtCollectionStatusRepository.js`, `server/dashboard/debtCollectionStatusRepository.test.js`
- Modify: `server/routes.js`
- Test: `server/dashboard/debtManagementRoutes.test.js`, migration tests

**Interfaces:**
- Produces: `listDebtStatuses(branch)`, `upsertDebtStatus({ branch, customerKey, status, alertSignature, user })`.
- Adds: `PATCH /api/debt-management/status` với body `{ customerKey, status, alertSignature }`.

- [x] Viết test thất bại cho schema, đọc hàng loạt, upsert, allowlist, 401/403, branch isolation và 503.
- [x] Thêm migration với PK `(branch, customer_key)`, status check, chữ ký, người sửa và thời điểm.
- [x] Cài repository và route chỉ cho Quản lý/Trợ lý.
- [x] Ghép trạng thái vào dashboard; Đã xử lý/Bỏ qua bị vô hiệu khi alert signature đổi.
- [x] Chạy test và commit `feat(debt): persist collection workflow statuses`.

## Task 4: Giao diện theo design system

**Files:**
- Modify: `server/public/index.html`, `server/public/shared/shared.css`, `server/public/shared/shared-nav.js`
- Test: `server/test/frontend/debt-management-ui.test.js`

**Interfaces:**
- Consumes: `debtManagement` response và PATCH status.

- [x] Viết test thất bại cho nhãn mới, KPI/chart/table/filter, editable status theo role và việc bỏ UI kỳ cũ.
- [x] Dựng bố cục A: 4 KPI; chart sale/lịch; top 10 hiện tại/quá hạn; bảng 10 cột.
- [x] Thêm lọc Cần xử lý/Còn nợ/Quá hạn/Tất cả, sale, lịch TT, tìm khách/sale; phân trang 100 và sort ba trạng thái.
- [x] Tái sử dụng status-select của nghỉ phép, semantic tokens, grid/chart heights/sticky header chuẩn; hỗ trợ Light/Dark, keyboard và reduced motion.
- [x] PATCH trạng thái với disable/rollback/toast/row flash.
- [x] Chạy test frontend và commit `feat(debt): replace period report with management dashboard`.

## Task 5: Xuất Excel

**Files:**
- Modify: `server/dashboard/exportService.js`
- Test: `server/dashboard/exportService.test.js`, `server/test/frontend/export-ui.test.js`

**Interfaces:**
- Replaces: `debt.period` bằng `debt.management`.

- [x] Viết test thất bại cho export theo branch, filter/search/sort/status và không có dữ liệu.
- [x] Xuất một worksheet Công nợ HN/SG; 10 cột mặc định và 2 cột audit tùy chọn.
- [x] Giữ money/percent là numeric, freeze header, AutoFilter, formula neutralization và tên file HN_/SG_.
- [x] Chạy test export và commit `feat(debt): export filtered management report`.

## Task 6: Tài liệu và xác minh

**Files:**
- Modify: `README.md`, `server/README.md`, `docs/02-srs/SRS_Dashboard_GoogleSheets.md`
- Modify: `docs/superpowers/specs/2026-08-05-debt-dashboard-design.md`

- [x] Cập nhật cây thư mục, cấu hình, API, phân quyền và đánh dấu thiết kế cũ bị thay thế.
- [x] Xác nhận service account chỉ cần Viewer trên workbook công nợ.
- [x] Chạy test module, `npm test`, build và kiểm tra git diff.
- [ ] Sau khi cấu hình migration/secret trên môi trường thật: kiểm thử thủ công cả hai cơ sở, quyền, status reset và responsive.
- [x] Commit: `docs(debt): document debt management workflow`.

## Acceptance Criteria

- HN/SG chỉ thấy tab công nợ thuộc cơ sở được phép.
- Cảnh báo lịch 1/3 và quá hạn đúng ma trận; 399.999/400.000 đúng biên.
- Đã xử lý/Bỏ qua ra khỏi hàng chờ và tự mở lại khi khoản nợ thay đổi.
- Vai trò ngoài Quản lý/Trợ lý không sửa được status.
- Dashboard, bộ lọc, sort và Excel dùng cùng tập dữ liệu.
- Thiếu Sheets/Postgres fail-soft và không làm sập các tab dashboard khác.
- Dark/Light và viewport 375/768/1024/1440px không vỡ bố cục.
