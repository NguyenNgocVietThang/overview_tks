# Page Design Notes — `shipment/index.html` (Tra Cứu Vòng Đời Đơn Hàng)

> Kế thừa toàn bộ `MASTER.md`. Audit gần nhất: 2026-09-15.

## Vai trò trang
Tra cứu trạng thái/vòng đời đơn hàng theo mã, hiển thị kết quả dạng bảng + điều hướng nội bộ.

## Component đặc thù của trang
- `.lookup-hero` — khối tiêu đề, đã tích hợp đúng hệ thống `--canvas-text` (không phải pattern mới,
  chỉ là cách dùng đúng của mục "Chữ trực tiếp trên nền" trong `shared.css`).
- `.lookup-panel textarea` — cần thay bằng `.form-textarea` chuẩn ở MASTER §5.12 thay vì tự định
  nghĩa `border-radius:12px` (lệch thang bo góc).
- `.int-nav-card` — thẻ điều hướng nội bộ, `shared.css` đã có sẵn hover chuẩn (box-shadow/border,
  không transform) cho selector này ở dòng ~866–891.

## Nợ thiết kế riêng của trang
1. **`.lookup-message.error` hardcode màu đỏ** thay vì `var(--alert-error-bg)` — cùng lỗi lặp ở
   MASTER §12.2.
2. **`.status-found`/`.status-missing` là bản tự chế của `.badge`/`.badge-success`** (MASTER §5.3)
   với padding hơi khác (`4px 10px` thay vì `3px 10px`) — nên đổi sang dùng thẳng `.badge`/
   `.badge-success`/`.badge` (danger) thay vì giữ tên riêng.
3. **`.int-nav-card:hover` tự thêm `transform:translateY(-2px)` cục bộ** — xung đột với quy ước "card
   hover chỉ box-shadow/border-color, không transform" đã ghi rõ trong `shared.css` (dòng ~863). Nên
   bỏ dòng transform này để nhất quán với các trang khác dùng cùng class.
4. `.lookup-panel textarea` dùng `border-radius:12px` — không khớp bậc nào trong thang MASTER §4.4;
   nên đổi thành `var(--radius-sm)` khi áp dụng `.form-textarea` chuẩn.
