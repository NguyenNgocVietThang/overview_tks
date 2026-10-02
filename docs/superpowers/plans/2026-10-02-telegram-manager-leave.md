# Kế hoạch bot Telegram quản lý nghỉ phép

Ngày: 02/10/2026. Trạng thái: đã triển khai code và xác minh toàn bộ bộ kiểm thử trên Node 22 (1.622 thành công, 3 bỏ qua, 0 thất bại); chờ cấu hình và bật môi trường production.

## Mục tiêu và phạm vi đã duyệt

Tạo **bot riêng cho quản lý**, chạy cùng Express. Bot xin nghỉ của nhân viên hiện có chạy ngoài repo, tiếp tục ghi trực tiếp `hr_leave_requests` và báo kết quả cho nhân viên qua `decision_notified_at`. Không thay bot, webhook, liên kết hay phiên xin nghỉ của nhân viên.

- Gửi mọi đơn **Xin nghỉ phép** mới (kể cả Vi phạm); quét đầu bù đơn Chưa duyệt/Tạm duyệt chưa gửi. Không gửi **Tự ý nghỉ (HR ghi nhận)**.
- Người nhận/thao tác: vai trò Quản lý, hoạt động, Telegram ID, quyền `hr.leave.manage`. Cơ sở Hà Nội/Sài Gòn/Cả hai tương ứng HN/SG/cả hai; cơ sở trống bị loại. Mỗi quản lý phải Start bot mới.
- Có 5 trạng thái: Chưa duyệt, Tạm duyệt, Đã duyệt, Từ chối, Vi phạm. Đã duyệt/Từ chối khóa Telegram; web vẫn sửa được và chuyển về trạng thái khác để mở lại.
- Từ chối: reply đúng tin nhắc, lý do trim tối đa 500 ký tự, Bỏ qua lưu rỗng, Hủy không quyết định; phiên 15 phút.
- Tin Telegram và web phản ánh cùng quyết định; nút/phiên cũ và quyết định đồng thời không ghi đè phiên bản mới.

## Thiết kế

- Webhook `POST /api/telegram/manager-leave/webhook` kiểm tra `X-Telegram-Bot-Api-Secret-Token`. Telegram API dùng native `fetch`.
- Migration `0029_hr_manager_telegram.sql` thêm `decision_version` và năm bảng: `hr_leave_change_events`, `hr_leave_manager_messages`, `hr_manager_telegram_sessions`, `hr_manager_telegram_updates`, `hr_manager_telegram_state`. Lưu sự kiện/lease/retry/inbox và hiệu ứng để tiếp tục sau restart; thu hồi SELECT của `reporting_readonly` trên cả năm bảng kỹ thuật. Bảng singleton lưu `first_enabled_at`, không chứa dữ liệu nghiệp vụ người dùng.
- `hrLeaveDecisionService.js` là service quyết định dùng chung cho web và Telegram; xác minh quyền/cơ sở/phiên bản trong luồng quyết định. `decision_notified_at` giữ hợp đồng cũ.
- Runtime quét mỗi 5000 ms mặc định, xử lý đơn/sự kiện từ nguồn ghi bên ngoài và đồng bộ các bản tin quản lý đã gửi. Mốc bật lần đầu loại các đơn đã kết thúc trong lịch sử cũ; đơn mới sau mốc vẫn gửi quyết định hiện tại nếu web đã duyệt trước lượt quét. Inbox dùng `chat_key` và index hàng pending để update sau không vượt update trước cùng chat đang retry/leased; webhook đăng ký `max_connections=1`.
- `hrLeaveDbRealtime.js` đưa thay đổi DB vào SSE qua bản chụp/phiên bản dùng chung, tránh cursor event ID vì thứ tự commit có thể khác. Connect/reconnect làm mới danh sách.
- `HR_MANAGER_TELEGRAM_ENABLED=false` mặc định; token, secret, HTTPS origin và scan interval cấu hình qua môi trường. `HR_LEAVE_DB_REALTIME_ENABLED=true` mặc định, độc lập công tắc bot.

## Các bước triển khai và xác minh

1. **Schema và quyết định chung:** thêm migration, version và dữ liệu kỹ thuật; triển khai service quyết định; kiểm tra race, nút cũ, khóa final trên Telegram và mở lại bằng web.
2. **Bot và webhook:** thêm `server/telegram/{telegramApi,managerLeaveMessage,managerLeaveBot,managerLeaveWebhook,managerLeaveStore,managerLeaveRuntime}.js`; kiểm tra secret, private chat, quyền hiện tại, cơ sở, reply đúng prompt, Bỏ qua/Hủy/expiry.
3. **Cầu DB → web:** thêm `server/hr/hrLeaveDbRealtime.js`, dùng cùng nguồn version/snapshot; phát sự kiện và reload khi SSE connect/reconnect; kiểm tra đơn do bot ngoài repo ghi.
4. **Vận hành:** thêm `telegram/setManagerLeaveWebhook.js` và `npm run telegram-manager:set-webhook`, cấu hình runtime trong server; cập nhật README, SCHEMA, env example, BRD/SRS và implementation plan.
5. **Kiểm tra:** chạy test phù hợp và bộ `npm test`; test migration chỉ dùng database test tách biệt. `@electric-sql/pglite` chỉ dùng ở devDependency cho kiểm thử SQL/migration. Mock Telegram trong kiểm thử tự động; kiểm tra retry/restart, inbox trùng và đồng bộ nhiều quản lý. Không gửi tin thật hay đổi webhook production trong quá trình kiểm thử code.
6. **Bật môi trường:** áp migration trước bản web mới → cấu hình bot → khởi động server → đăng ký webhook → từng quản lý Start bot → kiểm tra bằng đơn được phép trong môi trường triển khai. Theo [hướng dẫn thiết lập](../../telegram-manager-leave-setup.md).

## Điều kiện vận hành và quay lại

Migration 0029 phải có **trước khi chạy bản web mới**, kể cả bot tắt vì repository đọc `decision_version`. Thông báo gần thời gian thực cần server chạy liên tục; ngủ/tắt sẽ trì hoãn quét/giao tin, tiếp tục công việc bền vững khi chạy lại.

Tắt `HR_MANAGER_TELEGRAM_ENABLED` và khởi động lại để dừng bot quản lý. Giữ migration và các bảng; duyệt trên web và bot nhân viên vẫn vận hành. Có thể tắt riêng `HR_LEAVE_DB_REALTIME_ENABLED` để dừng cầu DB → SSE khi xử lý lỗi.
