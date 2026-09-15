# Page Design Notes — `register/index.html`

> Kế thừa toàn bộ `MASTER.md`. Audit gần nhất: 2026-09-15.

## Vai trò trang
Đăng ký tài khoản mới (email/số điện thoại).

## Component đặc thù của trang
- `.register-card` — bản triển khai thứ hai của **Auth Card** (MASTER §5.10), cùng kích thước/bo góc
  với `.login-card`. Trang này đạt "buộc sáng" bằng cách đơn giản hơn: gắn `data-theme="light"` ngay
  trên `<html>` thay vì ghi đè từng biến — **đây là cách nên nhân rộng** sang `login/index.html`
  thay vì chiều ngược lại.
- Tái sử dụng đúng `.auth-nav-tabs`/`.auth-nav-tab` và `.password-wrap`/`.password-toggle-btn` từ
  `shared.css` — không có vấn đề, giữ nguyên làm ví dụ mẫu.

## Nợ thiết kế riêng của trang
1. **`.form-error` hardcode `rgba(239,68,68,.12)`/`.3`** thay vì `var(--alert-error-bg)`/
   `var(--alert-error-border)` đã có sẵn — cùng lỗi lặp lại như `login-error` (MASTER §12.2).
2. Không có sai lệch nào khác đáng kể — trang này tương đối sạch so với các trang còn lại.
