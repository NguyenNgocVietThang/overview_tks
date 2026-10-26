# Own Leave Cancellation Implementation Plan

**Goal:** Chủ đơn tự xóa vĩnh viễn đơn xin nghỉ trước buổi nghỉ đầu tiên, đồng bộ chuông, Telegram và các màn hình đang mở.

**Architecture:** Express service gọi hàm PostgreSQL giao dịch nguyên tử. Hàng đợi độc lập giao thông báo hủy qua worker Telegram hiện có; advisory lock phối hợp gửi thẻ và xóa đơn. SSE API và bridge DB thông báo xóa giữa các tiến trình.

**Tech Stack:** Node.js/Express, PostgreSQL, Telegram Bot API, JavaScript DOM, node:test/PGlite/JSDOM. Không thêm dependency.

## Công việc

- [x] Thêm kiểm thử điều kiện chủ đơn/loại/thời hạn và phiên bản; service/API trả mã lỗi rõ ràng.
- [x] Migration `0094`: giao dịch xóa, cascade có kiểm soát, định danh người duyệt, chặn chuông trễ, hàng đợi hủy độc lập.
- [x] Worker claim/retry/complete hàng đợi; cập nhật thẻ và gửi thông báo; dùng chung khóa theo đơn khi gửi và ghi message ID.
- [x] Thêm capabilities danh sách/chi tiết, sự kiện xóa, bridge DB và SSE giới hạn dữ liệu cá nhân.
- [x] Hộp xác nhận web, chống gửi lặp, xử lý conflict và xóa từ phiên khác.
- [x] Kiểm thử SQL, route/service, queue, runtime và hai phiên giao diện giả lập; cập nhật schema/hướng dẫn.
- [ ] Kiểm tra trực quan hai phiên trên staging và Telegram thật (trình duyệt cục bộ của phiên này không truy cập được).
- [ ] Áp migration, triển khai ứng dụng và theo dõi queue trên môi trường đích.

## Nghiệm thu

Đơn mọi trạng thái từ cả hai nguồn được chủ đơn hoạt động xóa trước giờ nghỉ; người khác và đơn HR ghi nhận bị từ chối. Giao dịch lỗi không để lại tác vụ hoặc chuông hủy. Lịch sử trực tiếp vẫn bất biến. Phiên bản cũ trả 409, xóa lặp trả 404. Telegram lỗi không làm thất bại giao dịch xóa, được retry, payload hoàn tất được dọn. Màn hình khác bỏ đơn khi nhận SSE và sau reconnect.

## Vận hành

Trong `server`, chạy `npm run db:migrate` trước bản backend/worker/frontend mới. Kiểm tra queue `hr_leave_cancellation_jobs` theo `attempts`, `available_at`, `lease_until`, `last_error`. Không rollback migration khi vẫn còn worker mới hoạt động. Không phục hồi đơn bằng cách tạo lại cùng request ID. DB production chưa được sửa trong đợt phát triển này.
