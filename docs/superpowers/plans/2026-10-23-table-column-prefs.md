# Ghi nhớ cột theo tài khoản — Kế hoạch triển khai

> Spec: `docs/superpowers/specs/2026-10-23-table-column-prefs-design.md`

**Goal:** Lưu độ rộng cột và cột ẩn/hiện theo tài khoản trong Postgres.
**Architecture:** Bảng `user_table_prefs` + module `server/userTablePrefs/` (repository, routes) + nạp/lưu trong `table-controls.js`.
**Tech Stack:** Node 22, Express, pg, PGlite (test), jsdom (test frontend).

## Global Constraints
- CommonJS, không thêm thư viện. `user_id` là TEXT, không FK (tài khoản có thể ở kho JSON). `user_id` chỉ lấy từ `req.user.id`.
- Width trong [24, 2000]; tối đa 200 cột/bảng; `mode` thuộc {desktop, mobile}.

### Task 1: Migration 0085
Files: `server/db/migrations/0085_user_table_prefs.sql`, `server/db/userTablePrefsMigration.test.js`.
- [ ] Viết test PGlite: chạy SQL, upsert hai dòng, kiểm khóa chính chặn trùng và CHECK mode.
- [ ] Viết SQL, chạy test.

### Task 2: Repository + routes
Files: `server/userTablePrefs/repository.js`, `routes.js`, `routes.test.js`; sửa `server/routes.js`.
Interfaces: `sanitizePrefs(input) -> {columns}|throws {statusCode:400}`, `listForUser(pool,userId) -> {[tableKey]:{[mode]:prefs}}`, `savePrefs(pool,userId,tableKey,mode,prefs)`.
- [ ] Test sanitize + route (PGlite adapter), chạy thấy fail.
- [ ] Cài đặt, mount `router.use('/api/me/table-prefs', ...)`, chạy test.

### Task 3: Client
Files: `server/public/shared/table-controls.js`, `server/test/frontend/table-controls.test.js`.
- [ ] Test: áp prefs đã nạp; debounce lưu sau kéo cột/toggle; cột locked không ẩn.
- [ ] Cài đặt `TKSTables.loadPrefs`, lưu debounce 800ms, áp vào `session.columns` khi tạo cột.

### Task 4: Docs, chạy migration, kiểm tra
- [ ] Cập nhật SCHEMA.md, server/README.md, README.md, CURRENT.md.
- [ ] `npm test`, `npm run db:migrate`, xác nhận bảng tồn tại.
