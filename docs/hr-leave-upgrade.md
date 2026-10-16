# Nghỉ phép và Quản lý người dùng — 05/10/2026

Người duyệt đang hoạt động, có `hr.leave.manage`, phòng ban được cấp và cơ sở được gán phù hợp với đơn; nhân viên được cấp quyền cũng được duyệt và được tự duyệt. Gửi tất cả người phù hợp, một quyết định thành công chốt phiên bản. Nếu không có người phù hợp, dùng quản trị cao nhất đang hoạt động; thiếu cả dự phòng thì giữ chờ và cảnh báo. Telegram ID/Start chỉ quyết định khả năng giao tin, không quyết định có người duyệt web.

Quản lý mới/nâng vai trò phải chọn ít nhất một phòng ban. Nhân viên lần đầu được cấp duyệt mặc định chọn phòng ban của mình và được chỉnh. Các lần sửa quyền sau cho phép bỏ tất cả. Quyền duyệt không cấp quyền quản trị tài khoản; quyền `hr.leave.absence.manage` riêng mặc định Quản lý. Bộ lọc cơ sở web chỉ phục vụ xem.

Tài khoản hoạt động gắn hồ sơ nhân sự hoạt động có nút Xin nghỉ phép: ngày/buổi bắt đầu và kết thúc, lý do bắt buộc, bàn giao tùy chọn, tổng buổi/ngày. Server lấy danh tính từ liên kết HR thật, tính nghỉ gấp/gửi muộn theo Asia/Ho_Chi_Minh. POST `/api/hr/leave-requests/self` lưu vào DB trước khi giao Telegram. Người chỉ có quyền tự gửi xem đơn của mình. GET `/api/hr/leave-requests/self/context` trả điều kiện và hồ sơ hiển thị.

PATCH trạng thái nhận `{status,note,expectedVersion}`; quyền và tài khoản được kiểm tra lại, xung đột trả 409. Web cho sửa/mở lại, Telegram khóa đơn kết thúc. Snapshot phòng ban không đổi theo chuyển phòng ban. Không có người duyệt thì có cảnh báo trong dữ liệu đơn.

Telegram Từ chối mở Mini App cùng origin, tiêu đề tên người xin nghỉ, OK/Hủy. Lý do trim 0–500 ký tự; trống lưu không có lý do nhưng vẫn lưu người/thời điểm. Hủy/đóng không đổi trạng thái, lỗi giữ nội dung. initData xác thực bot quản lý trong 15 phút, không JWT web. `/donnghi` lọc phòng ban trong phạm vi, 10 đơn/trang. Inbox độc lập vòng giao tin, giữ retry/restart/dedupe và thứ tự từng chat.

Quản lý người dùng: mặc định Họ và tên, Vai trò, Cơ sở, Trạng thái; bộ chọn dùng toàn bộ danh mục xuất Excel. Họ và tên luôn hiện; có hiện tất cả/khôi phục mặc định. localStorage riêng tài khoản/trình duyệt, lựa chọn Excel độc lập. Ẩn cột đang sắp xếp bỏ sắp xếp đó. Mỗi lần mở trang lọc Đang hoạt động; chọn Tất cả mới hiện đầy đủ.

## Triển khai và nghiệm thu

Áp migration 0031 trên staging trước ứng dụng mới, kể cả bot đang tắt; không sửa hợp đồng INSERT bot nhân viên. Rà grant quản lý hiện có, dự phòng senior, thiếu senior hoạt động, staff tự duyệt, sai phạm vi/khóa/thu hồi, cạnh tranh web/Telegram, mở lại, giả danh, Mini App giả/hết hạn và cột/trạng thái/Excel. Xem [checklist thực hiện](../tasks/2026-10-05-hr-approval/todo.md), [schema](../server/db/SCHEMA.md), [vận hành bot](telegram-manager-leave-setup.md).

Đo p95 tiếp nhận <1 giây, kết quả thường <2 giây trên staging đang chạy; kiểm thử giả không thay thế Telegram thật. Chưa áp migration hoặc deploy production trong đợt thực hiện này.
