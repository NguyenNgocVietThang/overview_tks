# Chế độ cơ sở “Cả hai” Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Biến “Cả hai” thành phạm vi dữ liệu thực trên toàn hệ thống cho người dùng được cấp quyền hai cơ sở.

**Architecture:** Tách cơ sở vật lý được cấp quyền khỏi lựa chọn hiển thị, quy đổi “Cả hai” thành phạm vi Hà Nội + Sài Gòn tại biên service/repository. Dữ liệu tổng hợp gộp thực thể theo mã nhưng giữ giao dịch theo `(branch, code)`; thao tác ghi gắn với thực thể dùng cơ sở của thực thể, riêng công nợ cập nhật hai cơ sở trong một transaction.

**Tech Stack:** Node.js 22, Express 4, PostgreSQL/pg, Google Sheets API, HTML/vanilla JavaScript, node:test, JSDOM, ExcelJS.

## Global Constraints

- Chỉ tài khoản có quyền cả Hà Nội và Sài Gòn mới được chọn `Cả hai`.
- `allowedBranches(user)` chỉ trả cơ sở vật lý; `selectableBranches(user)` có thể thêm `Cả hai`.
- Không lưu `Cả hai` vào cột nghiệp vụ chỉ chấp nhận `hanoi` hoặc `saigon`.
- Thực thể trùng mã được gộp theo mã; giao dịch riêng lẻ giữ khóa `(branch, code)` và nhãn cơ sở.
- Không thêm migration hoặc dependency mới.
- Tất cả thay đổi hành vi phải theo TDD: test đỏ, triển khai tối thiểu, test xanh.

---

### Task 1: Phân quyền và bộ chọn cơ sở

**Files:**
- Modify: `server/branch/branches.js`, `server/branch/branchMiddleware.js`, `server/branch/branchRoutes.js`
- Modify: `server/auth/authRoutes.js`, `server/public/shared/shared-nav.js`
- Test: `server/branch/*.test.js`, `server/auth/authRoutes.test.js`, `server/test/frontend/branch-switcher.test.js`

**Interfaces:**
- Produces: `selectableBranches(user): string[]`, `resolveBranchScope(branch): string[]`, cookie `tks_branch=Cả hai` khi hợp lệ.

- [ ] Viết test đỏ cho lựa chọn Cả hai, quyền một/hai cơ sở và cookie bị thu hồi quyền.
- [ ] Chạy test mục tiêu và xác nhận thất bại do API mới chưa tồn tại.
- [ ] Triển khai helper, middleware, route, `/api/auth/me` và bộ chọn frontend.
- [ ] Chạy test mục tiêu và toàn bộ test branch/auth/frontend.
- [ ] Commit `feat: add authorized both-branch selection`.

### Task 2: Tổng hợp sáu màn hình Báo cáo tổng hợp

**Files:**
- Modify: `server/dashboard/dashboardData.js`, `server/dashboard/dashboardPgReader.js`, `server/dashboard/dashboardRollupRepository.js`
- Modify: repository công nợ liên quan
- Test: `server/dashboard/dashboardData.test.js`, `server/dashboard/dashboardPgReader.test.js`, `server/dashboard/dashboardRollupRepository.test.js`

**Interfaces:**
- Consumes: `resolveBranchScope(branch)`.
- Produces: dashboard tổng hợp hai cơ sở, bản ghi chi tiết có `branch`, cache theo phạm vi ổn định.

- [ ] Viết test đỏ cho KPI, bucket ngày, gộp mã và giữ giao dịch cùng mã khác cơ sở.
- [ ] Chạy test mục tiêu và xác nhận lỗi đúng nguyên nhân.
- [ ] Mở rộng PostgreSQL/Sheets/cache và công nợ để nhận phạm vi hai cơ sở.
- [ ] Chạy test dashboard mục tiêu và refactor khi xanh.
- [ ] Commit `feat: aggregate dashboard data across branches`.

### Task 3: Tìm kiếm, chi tiết và xuất Excel

**Files:**
- Modify: `server/routes.js`, `server/dashboard/dashboardData.js`, `server/dashboard/exportService.js`
- Test: `server/dashboard/dashboardData.test.js`, `server/dashboard/exportService.test.js`, frontend export tests

**Interfaces:**
- Consumes: dashboard/repository hỗ trợ `Cả hai`.
- Produces: tìm kiếm, báo cáo chi tiết và Excel tổng hợp, các dòng giao dịch có cột cơ sở.

- [ ] Viết test đỏ cho search, customer/product detail và export ở phạm vi Cả hai.
- [ ] Chạy test mục tiêu và xác nhận thất bại.
- [ ] Triển khai gộp danh mục theo mã, giữ giao dịch theo `(branch, code)`, thêm cột cơ sở khi cần.
- [ ] Chạy test mục tiêu và test export frontend.
- [ ] Commit `feat: support both branches in search and exports`.

### Task 4: Các phân hệ ngoài Báo cáo tổng hợp

**Files:**
- Modify: `server/hr/*`, `server/shipment/*`, `server/dashboard/stockoutCheck/*` và frontend liên quan
- Test: test route/service/frontend tương ứng

**Interfaces:**
- Consumes: `resolveBranchScope(branch)`.
- Produces: HR, vòng đời/đơn hàng và đứt hàng đọc hai cơ sở; thao tác thực thể lấy cơ sở từ bản ghi.

- [ ] Viết test đỏ cho các luồng đọc hai cơ sở và nhãn nguồn.
- [ ] Chạy test mục tiêu và xác nhận thất bại.
- [ ] Triển khai HR đọc hai cơ sở nhưng tạo đơn theo hồ sơ nhân viên; vòng đời trả HN+SG; stockout chạy job con hai cơ sở.
- [ ] Chạy test route/service/frontend mục tiêu.
- [ ] Commit `feat: support both branches across operational modules`.

### Task 5: Ghi công nợ nguyên tử, tài liệu và xác minh tổng thể

**Files:**
- Modify: `server/dashboard/debtManagementRoutes.js`, repository trạng thái công nợ
- Modify: `docs/01-brd/BRD_Dashboard_GoogleSheets.md`, `docs/02-srs/SRS_Dashboard_GoogleSheets.md`, README nếu bị ảnh hưởng
- Test: test repository/route công nợ

**Interfaces:**
- Produces: cập nhật cùng `customer_key` cho hai cơ sở trong một transaction, rollback toàn bộ khi lỗi.

- [ ] Viết test đỏ cho commit/rollback, quyền và chống ghi `both` vào database.
- [ ] Chạy test mục tiêu và xác nhận thất bại.
- [ ] Triển khai transaction, invalidation sau commit và đồng bộ tài liệu.
- [ ] Chạy `npm test` và `npm run build` từ `server`.
- [ ] Commit `feat: make both-branch writes consistent`.
