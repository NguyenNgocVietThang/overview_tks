# Ghi nhớ độ rộng cột và cột hiển thị theo tài khoản

Ngày: 2026-10-23. Trạng thái: đã duyệt thiết kế (phương án A), chờ duyệt spec.

## Mục tiêu
Độ rộng cột và cột ẩn/hiện mà người dùng chọn trên mọi bảng dùng `table-controls.js` được nhớ lâu dài theo tài khoản, đi theo mọi thiết bị và trình duyệt. Hiện tại trạng thái chỉ nằm trong `sessions` (bộ nhớ trang) nên mất khi tải lại.

Ngoài phạm vi: nút "Đặt lại mặc định" (đã quyết định không làm), lưu sắp xếp, lưu phân trang.

## Dữ liệu
Migration `0085_user_table_prefs.sql`:
- `user_table_prefs(user_id, table_key, screen_mode, prefs jsonb, updated_at timestamptz)`
- Khóa chính `(user_id, table_key, screen_mode)`; `screen_mode` là `desktop` hoặc `mobile`.
- `prefs = { "columns": { "<colKey>": { "width": number, "hidden": boolean } } }`. Chỉ lưu cột người dùng đã đổi so với mặc định.

## API (chỉ cần đăng nhập)
- `GET /api/me/table-prefs`: trả mọi cấu hình của tài khoản đang đăng nhập.
- `PUT /api/me/table-prefs/:tableKey/:mode`: ghi đè cấu hình một bảng (upsert).
- `user_id` luôn lấy từ phiên, không nhận từ client.
- Kiểm tra đầu vào: `mode` thuộc {desktop, mobile}; độ dài `tableKey` và `colKey` có giới hạn; tối đa 200 cột/bảng; `width` là số hữu hạn trong [24, 2000]; `hidden` là boolean; giới hạn kích thước body.

## Client (`server/public/shared/table-controls.js`)
- Khi tải trang, nạp một lần `GET` rồi đổ vào `sessions` trước lần `refreshAll()` đầu tiên. Cấu hình đã lưu thắng `data-default-width` và `data-column-default-hidden`.
- Lưu sau `finishDrag` và `setHidden`, debounce khoảng 800 ms, mỗi (bảng, mode) một bộ hẹn giờ.
- Cột `locked` không bao giờ được lưu là ẩn. Cột mới (không có trong cấu hình) dùng mặc định. Cột không còn tồn tại bị bỏ qua.
- Nếu tất cả cột bị ẩn, vẫn giữ quy tắc hiện tại (cột đầu luôn hiện).
- Độ rộng đã lưu thắng việc tự co giãn lần đầu; chỉ co lại khi tổng độ rộng vượt khung (giữ hành vi `dp-table`/`fill`).
- Lỗi GET/PUT chỉ ghi log, bảng chạy theo mặc định, không chặn giao diện.

## Kiểm thử
- Repository/route với PGlite: upsert, đọc, cô lập giữa tài khoản, từ chối đầu vào sai.
- Frontend trong `table-controls.test.js`: áp cấu hình đã lưu, debounce lưu, bỏ qua cột đã xóa, cột locked không ẩn.

## Tài liệu cần cập nhật
`server/db/SCHEMA.md`, `server/README.md`, `README.md`, `CURRENT.md` (theo skill `update-file`).
