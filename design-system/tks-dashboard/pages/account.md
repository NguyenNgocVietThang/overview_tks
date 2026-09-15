# Page Design Notes — `account/index.html` (Tài Khoản & Quản Trị Người Dùng)

> Kế thừa toàn bộ `MASTER.md`. Audit gần nhất: 2026-09-15.

## Vai trò trang
Hồ sơ cá nhân + màn quản trị người dùng (admin): danh sách user, phân quyền vai trò, đặt lại mật
khẩu, duyệt yêu cầu đổi vai trò.

## Component đặc thù của trang
- Sub-nav gạch chân (`.account-subnav-item`) — bản triển khai đầu tiên của mẫu chuẩn ở MASTER §5.9,
  dùng tên `subnav-tab` khi viết mới.
- Grid thẻ hồ sơ 12 cột (`.profile-grid`, `.profile-card.col-6/col-12`).
- Role badges (9 biến thể) + Status pills (4 biến thể) — bản triển khai gốc của MASTER §5.6; các
  token màu (`--role-*`, `--status-*`) đã ở `shared.css`, chỉ thiếu phần class component dùng chung.
- Bảng quản trị user (`.users-table-panel`, `.users-table`) + avatar tròn (`.user-avatar`).
- 4 modal (tạo user / sửa user / đổi mật khẩu / yêu cầu vai trò) dùng chung 1 khung
  `.modal-overlay/.modal-box` — bản triển khai gốc của MASTER §5.7, **cần sửa theo §12.1**.
- Alert box + toast — dùng đúng token `--alert-*`/`--toast-*` đã có sẵn, không có vấn đề.

## Nợ thiết kế riêng của trang (ưu tiên xử lý khi chạm vào file này)
1. **`backdrop-filter: blur(3px)` trên `.modal-overlay`** (cả 4 modal) — vi phạm MASTER §7.1. Sửa
   theo mẫu §5.7 (chỉ `background: var(--overlay-bg)`).
2. **`.action-icon-btn` chỉ 32×32px** — dưới ngưỡng bắt buộc 40×40px desktop (MASTER §5.5). Tăng lên
   40×40px cho mọi nút thao tác trong `.users-table`.
3. **`.users-table` thiếu `position:sticky` trên `<th>` và thiếu `tbody tr:hover`** — cả hai đều là
   yêu cầu bắt buộc ở MASTER §5.5 cho bảng dữ liệu dày đặc. Thêm `background: var(--panel-2)` khi
   hover dòng, và `position:sticky; top:0; z-index:10` cho header.
4. **`.profile-card` không có `:hover`** — vi phạm nguyên tắc "mọi thẻ phải có phản hồi hover" ở
   MASTER §2.2. Thêm `border-color`/`box-shadow` khi hover, không dùng transform.
5. `.status-inactive` dùng `rgba(148,163,184,.12)` rời — nên thêm `--status-inactive-bg` vào
   `shared.css :root` rồi tham chiếu lại.
6. `.form-control` là tên riêng của trang, khác `.form-input` chuẩn ở MASTER §5.4 — không bắt buộc
   đổi tên code cũ, nhưng component mới nên dùng `.form-input`.
7. `.profile-card` dùng `--radius-xl` (14px) trong khi `.card` chuẩn dùng `--radius-lg` (12px) — lưu
   ý khi mở rộng thêm card cùng loại để không tạo thêm biến thể bo góc thứ ba.
