# Thiết kế đồng bộ danh tính và phân quyền từ HR Sheet

> **Trạng thái hiện tại (05/09/2026):** Đã triển khai trong auth middleware/services, employee directory và Telegram identity service.

## Mục tiêu

Tab `Danh sách nhân sự` của hai spreadsheet HR là nguồn danh tính và quyền của nhân sự. `users.json` tiếp tục giữ mật khẩu, trạng thái bảo mật, định danh đã xác minh và các ghi đè do quản lý thiết lập.

Mỗi dòng HR đại diện một người. Email và SĐT trên cùng dòng đăng nhập vào cùng một user; Google Sign-In xác minh email. Nguồn HR (`Hà Nội`/`Sài Gòn`) chỉ dùng để định tuyến nghiệp vụ nhân sự, còn cơ sở web mặc định là `Cả hai`.

## Quy tắc quyền

Thứ tự hiệu lực là tài khoản quản trị khóa cứng, ghi đè quản lý, vai trò suy ra từ bộ phận, rồi `Khách`.

| Bộ phận chuẩn hóa | Role |
|---|---|
| `BAN QUẢN LÝ`, `TRƯỞNG CHI NHÁNH` | `Quản lý` |
| `KẾ TOÁN` | `Kế toán` |
| `TRƯỞNG KHO` | `Trưởng kho` |
| `KHO` | `Nhân viên kho` |
| `TRỢ LÝ` | `Trợ lý` |
| `LÁI XE` | `Lái xe` |
| `SALE` | `Nhân viên sale` |
| `MUA HÀNG`, `ĐẶT HÀNG` | `Nhân viên mua hàng` |
| `MARKETING`, `HẬU CẦN`, `BẢO VỆ`, giá trị lạ | `Khách` |

`admin`, `admin@tokosi.vn` và `thangnnv2003@gmail.com` luôn là `Quản lý`/`Cả hai`; không tạo role cấp cao mới.

JWT chỉ xác định user ID. Middleware tải tài khoản local và resolve lại quyền qua directory tối đa mỗi request, với cache mới 10 giây. Khi Google lỗi, snapshot tốt gần nhất được dùng tối đa 15 phút; sau đó tài khoản HR-managed bị chặn với `HR_DIRECTORY_UNAVAILABLE`.

## An toàn dữ liệu

- Thiếu tab/header hoặc lỗi đọc không được xem là nhân sự bị xóa.
- Nhân sự HR-managed thật sự biến mất bị khóa bằng `hr_removed`; chỉ khóa này được tự mở khi dòng xuất hiện lại.
- Duplicate dòng, định danh chéo hoặc nhiều local account cùng khớp một người đều dừng với `HR_IDENTITY_CONFLICT`.
- Thay email/SĐT ghi đúng Sheet trước, sau đó mới cập nhật local và xóa cache.
- Tài khoản nội bộ cũ không khớp Sheet được giữ bằng legacy override.

## Telegram

`_HR_TELEGRAM_LINKS` có thêm `User ID` bất biến. Telegram ID trong dòng HR tự tạo liên kết một-một; đổi ID đánh dấu liên kết cũ là đã thay thế. `/lienket` chỉ là fallback khi Sheet chưa chỉ định ID. Yêu cầu nghỉ luôn ghi về spreadsheet HR nguồn của nhân sự.

## API và module triển khai

- Đăng ký HR: `/api/auth/register/channels`, `/send-otp`, `/verify`.
- Đổi contact HR: `/api/auth/profile/contact-change` và `/verify`.
- Quản trị: `PUT /api/admin/users/:id` nhận `vaiTroOverride`/`coSoOverride`; `null` xóa override.
- Module chính: `employeeDirectory.js`, `effectiveUserResolver.js`, `employeeRegistrationService.js`, `contactChangeService.js`, `telegramIdentityService.js`.

## Trạng thái

Đã triển khai ngày 04/09/2026. Nhóm xác minh liên quan đạt 174/174 test; nghiệm thu thay đổi dữ liệu thật trên hai HR Sheet thực hiện sau deploy có kiểm soát.
