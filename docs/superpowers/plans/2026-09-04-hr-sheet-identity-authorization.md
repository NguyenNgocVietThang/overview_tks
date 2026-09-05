# Kế hoạch triển khai HR Sheet identity

> **Trạng thái hiện tại (05/09/2026):** Đã triển khai. Hệ thống hiện không còn module/test PostgreSQL; snapshot `npm test` là 612 test, 608 pass, 4 fail do kỳ vọng test/UI chưa đồng bộ.

1. [x] Đọc và chuẩn hóa directory hai cơ sở, kiểm tra schema/duplicate, cache 10 giây và stale snapshot 15 phút.
2. [x] Resolve user hiệu lực ở middleware; hỗ trợ khóa/xóa/khôi phục HR, hardcoded admin, override và legacy account.
3. [x] Bổ sung đăng ký nhân sự qua challenge và OTP email/SMS; merge Google và đa định danh vào một user.
4. [x] Ghi xuyên email/SĐT từ hồ sơ và trang quản trị, với Sheet-first transaction semantics.
5. [x] Mở rộng Telegram link bằng User ID và tự liên kết/định tuyến theo HR home.
6. [x] Cập nhật giao diện đăng ký, hồ sơ và quản trị; bổ sung test cho backend và frontend.
7. [x] Chạy 174 test mục tiêu, build và kiểm tra diff.
8. [ ] Nghiệm thu thay đổi dữ liệu thật với hai spreadsheet sau deploy.

## Tiêu chí hoàn tất

- Thay bộ phận/override/thu hồi quyền phản ánh trong tối đa 10 giây.
- Google lỗi ngắn hạn dùng snapshot; quá 15 phút fail closed cho quyền nội bộ.
- Email/SĐT/Google của cùng dòng không tạo account trùng.
- Ghi Sheet thất bại không đổi local.
- Telegram ID trùng hoặc trỏ user khác không bị tự ghi đè.

## Vận hành sau deploy

```bash
cd server
npm run setup:hr-sheet
npm run setup:hr-sheet:sg
```

Hai lệnh cập nhật `_HR_TELEGRAM_LINKS` để có cột `User ID`. Service account phải có quyền Editor trên cả hai spreadsheet. Full `npm test` cần môi trường PostgreSQL test khả dụng; lần xác minh sandbox phát hiện 745 test nhưng nhóm DB/KiotViet không thể kết nối DB ngoài sandbox.
