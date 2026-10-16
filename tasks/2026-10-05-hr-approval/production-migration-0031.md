# Migration0031 — Production tokosi

Người dùng xác nhận áp Production sau khi gửi ảnh lỗi thiếu bo_phan (42703).

- Migration:0031_hr_leave_approval_scope.sql; applied_at:2026-10-05T06:54:25.971Z (13:54:25 giờ Việt Nam).
- SHA256:70197cef45ba94cfd9a9b51394cbb3ba11b793750d71586071b175c4e0d252bb.
- Áp riêng0031 trong transaction, advisory lock, lock_timeout5s và statement_timeout120s; COMMIT thành công và đã ghi schema_migrations.
- Trước chuyển đổi:5 quản lý chưa xóa,96 đơn; không có đơn Tạm duyệt. Migration0030 chưa có trong sổ; không áp thêm migration ngoài0031 được xác nhận.
- Sau chuyển đổi:5/5 quản lý có phòng ban;95/96 đơn lịch sử có phòng ban,1 đơn thiếu dùng tuyến dự phòng.
- Trigger snapshot và index pending đã có; reporting_readonly không đọc được bảng card Telegram.
- Kiểm tra INSERT hợp đồng bot nhân viên từ hr_employee_id hoặc user_id:điền snapshot đúng; UPDATE không đổi phòng ban/decision_version. Toàn bộ đơn kiểm tra đã ROLLBACK, không gửi bot.
- Truy vấn thật của hrLeaveRepository.getLeaveRequests và appUsersRepository.selectAllRows đọc thành công sau migration.
- Chưa gửi Telegram thật hoặc thao tác bot nhân viên ngoài repo; cần chỉ định tài khoản/chat thử. Chưa đo p95 thật và không đổi webhook.
