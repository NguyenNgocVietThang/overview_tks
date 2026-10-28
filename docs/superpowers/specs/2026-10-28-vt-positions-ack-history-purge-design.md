# VT Hà Nội / VT Sài Gòn: "Đã sửa", lịch sử tự động theo mã đơn, xóa lịch sử

Ngày: 2026-10-28. Module: `server/stockPositions/`, `server/pickAssignments/`, `server/public/vt-positions/`.

## 1. "Đã sửa" cho dòng có cảnh báo

- Migration mới (0099): cột `stock_positions.format_ack BOOLEAN NOT NULL DEFAULT false`.
- Cờ giữ mãi: sửa ghi chú không tự bỏ cờ; chỉ người có quyền bỏ tay.
- Áp cho **mọi** cảnh báo (`multi`, `loose`, `unreadable`, `badnumber`, `unknowncode`).
- `shape()` trả thêm `acknowledged`; dòng `acknowledged = true` có `warnings = []` ở phía hiển thị và đếm (không còn trong bộ lọc Cảnh báo, số đếm giảm); danh sách cảnh báo gốc vẫn trả ở `rawWarnings` để bỏ cờ xem lại được.
- API: `POST /api/stock-positions/:id/ack` body `{version, acknowledged}`, cần `stockLocationsV2.edit`, tăng `version`, kiểm khóa dòng như `update`.
- Lịch sử: action `ack` / `unack` (mở rộng CHECK trong migration), ghi người bấm.
- Giao diện: nút "Đánh dấu Đã sửa" / "Bỏ đánh dấu Đã sửa" chỉ nằm trong **hộp chi tiết** (ẩn nếu không có quyền sửa); bảng chỉ hiện nhãn xanh "Đã sửa" không bấm được (bấm dòng đã mở hộp chi tiết).
- Import "thay toàn bộ" và sửa tay không đụng vào cờ (dòng cập nhật giữ cờ; dòng mới mặc định false).

## 2. Lịch sử cho lượt trừ tồn tự động theo đơn

- `pickAssignmentsService.confirm()` (job Kiot và người bấm tay) ghi `actor_name = mã đơn` cho `stock_position_history` (`pick`, `auto_delete` trong luồng đơn) và `stock_positions.updated_by_name`.
- Tên người bấm thật lưu vào `summary.confirmedBy` (job tự động: rỗng); không mất dấu vết.
- `actor_user_id` giữ nguyên người bấm (hoặc null khi job).
- Giao diện lịch sử đã hiển thị `actorName`, không cần đổi.

## 3. Xóa lịch sử

- Quyền mới `stockLocationsV2.historyDelete` (`requires: stockLocationsV2.view`), mặc định `MANAGER_ONLY`, Quản lý cấp thêm từng người.
- API: `DELETE /api/stock-positions/history?branch=&from=&to=` (from/to dạng `YYYY-MM-DD` giờ Việt Nam, đều tùy chọn; trống cả hai = xóa toàn bộ cơ sở). Phạm vi: chỉ cơ sở được chỉ định, kiểm scope.
- Chạy trong 1 giao dịch có `lockBranch`; đặt `SET LOCAL app.history_purge = 'on'`; trả `{deleted: N}`.
- Trigger `stock_position_history_guard` (migration 0099): UPDATE luôn bị chặn; DELETE chỉ cho khi `current_setting('app.history_purge', true) = 'on'`.
- Sau khi xóa ghi 1 dòng mới `history_purged` (người xóa, khoảng ngày, số dòng đã xóa, cơ sở); dòng này nằm ngoài lượt xóa vừa rồi và xóa được ở lần sau.
- Giao diện: nút "Xóa lịch sử" trong hộp Lịch sử cập nhật (chỉ hiện khi có quyền); hộp thoại có 2 ô Từ ngày / Đến ngày (dd/mm/yyyy, trống = tất cả) và cảnh báo "Bạn có chắc chắn muốn xóa? Hãy lưu dữ liệu lịch sử trước khi xóa." với Hủy / OK; chỉ OK mới gọi API. Gợi ý bấm Xuất Excel trước. Sau khi xóa tải lại danh sách.
- Nhãn tiếng Việt thêm vào `stockPositionsHistoryLabels.js` và `vt-positions.js`: `ack` "Đánh dấu Đã sửa", `unack` "Bỏ Đã sửa", `history_purged` "Xóa lịch sử".

## Kiểm thử

- Service: ack/unack (cờ giữ khi sửa ghi chú, version, scope); actor = mã đơn ở confirm/hoàn tác/auto_delete; xóa lịch sử theo khoảng ngày và toàn bộ, dòng `history_purged`, từ chối thiếu quyền.
- Route: quyền `edit` / `historyDelete`, validate ngày.
- Migration: UPDATE lịch sử vẫn bị chặn; DELETE chỉ qua khi có cờ.
- Cập nhật `README.md`, `server/README.md`, `server/db/SCHEMA.md`, `CURRENT.md`.

## Ngoài phạm vi

Xóa lịch sử từng dòng; lưu trữ/backup lịch sử tự động (người dùng tự xuất Excel trước).
