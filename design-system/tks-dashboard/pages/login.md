# Page Design Notes — `login/index.html`

> Kế thừa toàn bộ `MASTER.md`. Audit gần nhất: 2026-09-15.

## Vai trò trang
Đăng nhập (email/số điện thoại), xác thực OTP, đăng nhập Google.

## Component đặc thù của trang
- `.login-card` — bản triển khai gốc của **Auth Card** (MASTER §5.10), bo góc `--radius-2xl` (20px).
  Trang này dùng cách "buộc sáng" phức tạp hơn `register` (ghi đè thủ công ~25 biến trên chính
  `.login-card` thay vì gắn `data-theme="light"` ở gốc trang) — **không nhân rộng cách này**, xem
  khuyến nghị hợp nhất ở MASTER §5.10.
- `.field`/`.field input` — biến thể input riêng của trang, gần giống nhưng không dùng chung với
  `.form-input` chuẩn (MASTER §5.4). Không bắt buộc đổi ngay, nhưng input mới nên dùng `.form-input`.
- `.otp-code-input` — bản gốc của mẫu chuẩn OTP (MASTER §5.11), giữ nguyên.
- `.google-btn-shell/.google-btn-fake` — hardcode màu thương hiệu Google (`#FFFFFF`, `#DADCE0`,
  `#3C4043`) là **ngoại lệ chấp nhận được** (phải khớp brand Google, không phải bảng màu app).
- `.login-divider` — mẫu "đường kẻ + chữ ở giữa", đáng chuẩn hoá thành `.divider-text` dùng chung.
- Modal OTP dùng khung `.modal-overlay/.modal-box` — cần sửa theo §12.1.

## Nợ thiết kế riêng của trang
1. **`backdrop-filter: blur(3px)` trên `.modal-overlay`** (modal OTP) — vi phạm MASTER §7.1.
2. **`.login-error`/`.login-pending` hardcode `rgba(239,68,68,.12)`/`rgba(59,130,246,.12)`** thay vì
   `var(--alert-error-bg)`/`var(--alert-warning-bg)` đã có sẵn — đây là lỗi lặp lại nhiều nhất trong
   toàn bộ audit (xem MASTER §12.2), ưu tiên sửa khi chạm vào khu vực này.
3. `.login-brand .brand-mark` tự set shadow riêng (`0 4px 14px rgba(0,0,0,.14)`) thay vì
   `var(--shadow-brand)`.
4. Focus ring của `.field input` dùng `rgba(59,130,246,.22)`, lệch nhẹ so với spec `.form-input`
   (`rgba(59,130,246,.2)`, MASTER §5.4) — nên hợp nhất về một token dùng chung.
