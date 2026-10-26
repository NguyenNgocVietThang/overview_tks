# Cá nhân hủy và xóa vĩnh viễn đơn nghỉ phép

Thiết kế được người dùng xác nhận ngày 26/10/2026.

## Hành vi

Chỉ chủ đơn đang hoạt động được tự hủy đơn xin nghỉ từ web hoặc Telegram. Mọi trạng thái duyệt đều được hủy, nhưng thời gian server phải nhỏ hơn `first_session_start_at` đã lưu. Đúng thời điểm bắt đầu buổi nghỉ đầu tiên thì từ chối. Đơn cũ thiếu snapshot hợp lệ bị chặn. Quản lý không hủy thay; bản ghi `Tự ý nghỉ (HR ghi nhận)` nằm ngoài phạm vi.

Web đặt nút Hủy đơn trong chi tiết; xác nhận mã đơn, lịch nghỉ, cảnh báo xóa vĩnh viễn với hai nút Quay lại / Xóa vĩnh viễn. Không yêu cầu lý do hoặc duyệt lại. Không bổ sung trạng thái Đã hủy. Lỗi phiên bản phải tải lại và xác nhận mới; không tự gửi lại DELETE.

## Giao dịch và đồng bộ

`DELETE /api/hr/leave-requests/self/:id` nhận `{expectedVersion}`, lấy chủ đơn từ phiên đăng nhập. Thành công trả `{deleted:true,requestId}`. Danh sách/chi tiết thêm `canCancel` và `cancelBlockedReason`.

SQL khóa advisory theo request ID và khóa dòng; kiểm tra chủ đơn hoạt động, loại, phiên bản, snapshot và thời hạn. Trong cùng giao dịch: tạo thông báo hủy, lưu tác vụ Telegram tối thiểu, dọn chuông cũ, xóa đơn cùng lịch sử và dữ liệu phụ thuộc. Mọi lỗi phải rollback. Bảo vệ lịch sử chỉ cho phép xóa cascade từ parent đã qua kiểm tra; sửa/xóa lịch sử trực tiếp vẫn bị chặn.

Người nhận là hợp của người duyệt hiện tại, người từng xử lý và người từng nhận thẻ/thông báo; loại trùng, thông báo mới chỉ cho tài khoản đang hoạt động. Định danh người duyệt được nhớ từ migration mới, không lưu nội dung quyết định; với dữ liệu cũ chỉ khôi phục được người liên quan còn lưu trên đơn/thẻ/chuông. Bảng định danh cũng bị xóa cùng đơn.

Thông báo hủy không có đường dẫn đến đơn đã xóa. Hàng đợi không có FK đến đơn, giữ text hủy, chat/message ID và metadata retry; hoàn tất thì xóa payload. Thẻ cũ đổi thành “Đã hủy bởi người xin nghỉ”, bỏ nút duyệt. Worker gửi thẻ dùng cùng advisory lock và lưu message ID trước khi nhả khóa; callback cũ luôn đọc lại đơn. Chuông tạo trễ bị DB chặn nếu đơn không còn tồn tại.

Inbox Telegram giữ update ID chống trùng, dọn payload/effects khi hoàn tất. Hủy đơn cũng dọn các job gắn với mã đơn/bản chụp quyết định hoặc thẻ đang chờ; job bị khóa tạm được bỏ qua để tránh đảo thứ tự khóa và sẽ dọn khi worker hoàn tất. Không giữ bản chụp đầy đủ của đơn trong inbox đã hoàn thành.

API phát `LEAVE_REQUEST_DELETED`; bridge DB phát cho tiến trình khác từ snapshot phiên bản trước đó. SSE cá nhân lọc theo chủ đơn tại server. Các màn hình đóng chi tiết đơn mất, cập nhật bảng/thống kê; lịch đang có SSE sẽ tải lại dữ liệu.

## Kiểm thử và giới hạn vận hành

Kiểm thử SQL thật qua PGlite, API/service, worker và giao diện JSDOM: nguồn/trạng thái, quyền chủ đơn, thời hạn độc quyền, legacy, phiên bản cũ, rollback, trigger bảo vệ, người nhận, lease/retry và hai phiên SSE. Không sử dụng DB production trong test.

Áp migration `0094` trước backend/worker/frontend. Bot quản lý phải được cấu hình và chạy để giao Telegram; chuông web được ghi cùng giao dịch xóa. Telegram có cơ chế giao ít nhất một lần: mất phản hồi sau khi Telegram đã nhận tin có thể dẫn đến thông báo gửi lặp khi thử lại; cập nhật thẻ có tính lặp an toàn. Không thể khôi phục đơn qua ứng dụng sau khi xóa.
