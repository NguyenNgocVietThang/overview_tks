# Nâng cấp nghỉ phép và quản trị tài khoản

Thiết kế được người dùng duyệt ngày 2026-10-05. Express hiện tại, PostgreSQL, JavaScript thuần.

## Quy tắc
- Duyệt: tài khoản hoạt động + hr.leave.manage + phòng ban đã cấp + cơ sở DB của tài khoản. Được tự duyệt.
- Thiếu người đúng phạm vi: quản trị cao nhất hoạt động xử lý dự phòng. Không có dự phòng: giữ chờ, cảnh báo.
- Quản lý cũ được cấp mọi phòng ban hiện có; Quản lý mới/nâng vai trò phải chọn. Nhân viên mới cấp duyệt mặc định phòng ban mình; phạm vi đã lưu không tự đổi.
- Snapshot phòng ban trên đơn, backfill đơn cũ từ hồ sơ hiện tại; trigger hỗ trợ bot bên ngoài.
- Web cho mở lại/sửa kết quả đúng phạm vi, mọi PATCH phải có expectedVersion. Telegram chỉ quyết định đơn chưa kết thúc.
- Ghi nhận tự ý nghỉ dùng quyền hr.leave.absence.manage riêng, mặc định Quản lý.
- Nhân sự có tài khoản hoạt động tự gửi đơn trên web, lấy danh tính server; lý do bắt buộc; ngày/buổi, bàn giao tùy chọn; tính nghỉ gấp/gửi muộn giờ Việt Nam.
- Mini App từ chối cùng Express, xác thực initData 15 phút, lý do rỗng được chấp nhận, 500 ký tự tối đa, Hủy không ghi. Giữ phiên chat cũ đến hết hạn.
- /donnghi lọc phòng ban trong quyền, 10 đơn/trang, chỉ đơn cần xử lý; không đổi thông báo tự động.
- Callback phản hồi sớm sau enqueue bền vững; xử lý thao tác không chờ delivery dài, giữ thứ tự từng chat, retry/dedupe. Đo p95 ack <1s, kết quả <2s trên môi trường hoạt động.
- Bảng người dùng chọn toàn bộ trường Excel, 4 cột cũ mặc định, Họ tên cố định; lưu localStorage theo tài khoản. Mặc định Đang hoạt động mỗi lần mở trang.

## Tasks
1. Migration + authorization + decision service + repository snapshot.
2. Auth/admin backend + phân quyền phòng ban + bảng người dùng.
3. API tự xin nghỉ + giao diện HR + expectedVersion/per-row authorization.
4. Telegram routing, Mini App, filter, callback latency and durability.
5. Integration tests, reviews, documents, full npm test.

## Hợp đồng tích hợp
- User: leaveApprovalDepartments: string[], boPhan: string, assignedCoSo: string (DB co_so, independent of display default).
- hrLeaveAuthorization exports normalizeDepartments, isActiveApprover, matchesApprovalScope, selectApprovers(users, request) -> {users,fallback,missing}, createHrLeaveAuthorization({loadUsers?}) -> {authorize(user,request),routingFor(request),canDecide(user,request)}. authorize reloads account and returns authorized current user, throws 403 on denial.
- Request: bo_phan is persisted snapshot; authorization uses row co_so/branch and bo_phan.
- createHrLeaveDecisionService accepts authorization injection; requires expectedVersion for every channel and authorizes prior to update.
- New POST /api/hr/leave-requests/self, GET /api/hr/leave-requests/self/context; context includes trusted profile and eligibility.
- GET /api/hr/leave-requests includes per-row canManage and routingWarning.

## Verification
Focused node --test for auth/hr/telegram/frontend, PGlite migration+race tests, full npm test. No production migrations/deploy or real bot messages during implementation. Existing tasks/plan.md and tasks/todo.md remain untouched.
