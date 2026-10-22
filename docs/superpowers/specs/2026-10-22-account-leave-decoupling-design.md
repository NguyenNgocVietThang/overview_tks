# Thiết kế hoàn thiện tách Tài khoản khỏi Nhân sự cho phân quyền và nghỉ phép

**Ngày:** 22/10/2026  
**Trạng thái:** Đã được người dùng chấp thuận về hướng triển khai  
**Phạm vi:** Quản lý tài khoản, phân quyền, bộ phận/cơ sở công tác, gửi và duyệt nghỉ phép, lịch làm việc, Telegram nghỉ phép

## 1. Mục tiêu

Tài khoản ứng dụng (`app_users`) là nguồn dữ liệu duy nhất cho:

- Vai trò và quyền tính năng.
- Cơ sở công tác.
- Bộ phận trực thuộc.
- Phạm vi cơ sở và bộ phận được duyệt nghỉ.
- Danh tính của người gửi đơn nghỉ và lịch làm việc dùng khi tính hạn nộp.

Danh sách nhân sự (`hr_employees`) chỉ quản lý hồ sơ nhân sự. Thay đổi hồ sơ nhân sự không được ghi đè vai trò, quyền, cơ sở công tác hoặc bộ phận của tài khoản. Liên kết `hr_employee_id` được giữ để đối chiếu hồ sơ, đồng bộ thông tin liên hệ hiện hữu và tự khóa/mở khóa tài khoản khi trạng thái làm việc đổi giữa `active`/`resigned`; liên kết này không tham gia giải quyền hoặc định tuyến nghỉ phép.

## 2. Mô hình dữ liệu và thuật ngữ

### 2.1. Tài khoản

- `vai_tro`: mẫu quyền mặc định.
- `feature_permissions`: phần ghi đè quyền riêng theo tài khoản.
- `co_so`: phạm vi nghiệp vụ mà tài khoản được xem/phụ trách; có thể là Hà Nội, Sài Gòn hoặc Cả hai.
- `work_branch`: cơ sở công tác thực tế; bắt buộc là `hanoi` hoặc `saigon` đối với tài khoản nội bộ.
- `bo_phan`: bộ phận trực thuộc tại `work_branch`; bắt buộc đối với tài khoản nội bộ và phải thuộc danh mục bộ phận của cơ sở đó.
- `leave_approval_departments`: các bộ phận mà tài khoản được duyệt nghỉ. Trường này chỉ có hiệu lực khi tài khoản có quyền `hr.leave.manage`; nó không phải bộ phận trực thuộc.

### 2.2. Nhân sự

`hr_employees.branch` và `hr_employees.bo_phan` chỉ mô tả hồ sơ nhân sự. Chúng không còn là đầu vào của `featureRegistry`, gửi đơn nghỉ, lịch làm việc hoặc định tuyến người duyệt.

## 3. Luồng tạo và sửa tài khoản

Form Thêm/Sửa tài khoản có các trường độc lập:

1. **Vai trò** — chọn mẫu quyền.
2. **Phạm vi phụ trách** — giá trị `co_so` hiện hữu.
3. **Cơ sở công tác** — Hà Nội hoặc Sài Gòn.
4. **Bộ phận trực thuộc** — danh sách phụ thuộc Cơ sở công tác.
5. **Bộ phận được duyệt nghỉ** — chỉ là phạm vi duyệt, hiển thị khi vai trò/quyền hiệu lực có `hr.leave.manage`.

Quy tắc:

- Tài khoản nội bộ (mọi vai trò trừ `Khách`) bắt buộc chọn cơ sở công tác và bộ phận.
- `Khách` không bắt buộc và mặc định xóa `work_branch`, `bo_phan`, `leave_approval_departments`.
- Bộ phận phải lấy từ danh mục cố định của cơ sở; server luôn xác thực lại, không tin dữ liệu giao diện.
- Vai trò và bộ phận được chọn độc lập, không có ánh xạ bắt buộc giữa hai trường. Ví dụ tài khoản có thể mang vai trò `Trợ lý` để nhận mẫu quyền Trợ lý nhưng trực thuộc bộ phận `Kế toán` để định tuyến nghỉ phép. Không tạo các vai trò ghép như “Trợ lý kế toán”.
- Tạo tài khoản lưu `feature_permissions = {}` nên nhận quyền mặc định theo vai trò.
- Đổi vai trò không tự đổi bộ phận; đổi cơ sở công tác bắt buộc chọn lại bộ phận hợp lệ.
- Đổi vai trò/bộ phận tài khoản không ghi ngược sang `hr_employees`.
- Mọi thay đổi được ghi vào nhật ký tài khoản, bổ sung nhãn cho `workBranch` và `boPhan`.

## 4. Giải quyền

Quyền hiệu lực giữ công thức hiện tại:

`quyền mặc định theo vai trò + feature_permissions + quyền động hợp lệ - quyền phụ thuộc bị thiếu`.

`bo_phan`, `work_branch` và mọi trường từ `hr_employees` không tham gia giải quyền tính năng. Quyền tự gửi nghỉ chỉ được cấp khi tài khoản nội bộ đang hoạt động, không bị xóa/khóa và có đủ `work_branch` + `bo_phan` hợp lệ.

## 5. Gửi và duyệt nghỉ phép

### 5.1. Gửi đơn

Đơn web và Telegram mới đều phải xác định một `app_users.id` đang hoạt động. Snapshot đơn lấy từ tài khoản:

- `user_id` từ tài khoản.
- `ho_ten` từ tài khoản.
- `chuc_vu` từ vai trò tài khoản.
- `branch` từ `work_branch`.
- `bo_phan` từ `bo_phan` tài khoản.
- Lịch làm việc từ `hr_leave_work_schedules.user_id`.

`hr_employee_id` trong đơn và lịch sử cũ được giữ để tương thích/đối chiếu, nhưng đơn mới không sử dụng nó để xác thực, chọn bộ phận, chọn cơ sở hoặc chọn lịch.

Trigger database phải được thay hoàn chỉnh để:

- Không tự khôi phục `hr_employee_id` rồi ghi đè snapshot từ `hr_employees`.
- Kiểm tra tài khoản gửi đơn đang hoạt động và có cơ sở/bộ phận hợp lệ.
- Lấy lịch theo `user_id` và ghi lịch sử chấp nhận `hr_employee_id = NULL`.
- Giữ nguyên bất biến lịch sử, phiên bản quyết định và cách tính hạn nộp hiện hữu.

### 5.2. Duyệt đơn

Một tài khoản là người duyệt hợp lệ khi đồng thời:

- Đang hoạt động và không bị xóa.
- Có quyền hiệu lực `hr.leave.manage`.
- `co_so`/phạm vi phụ trách khớp cơ sở của đơn hoặc là `Cả hai`.
- `leave_approval_departments` chứa đúng bộ phận snapshot của đơn.

Nếu không có người duyệt thường, dùng quản trị viên cấp cao làm fallback như hiện tại. Telegram manager runtime phải đọc hoàn toàn từ `app_users`, không `JOIN hr_employees` để quyết định tính hợp lệ hoặc phạm vi.

## 6. Lịch làm việc

- Mọi lịch mới ghi theo `user_id`.
- Giao diện/API cấu hình lịch chọn tài khoản theo cơ sở công tác và bộ phận của tài khoản.
- Dòng lịch cũ theo `employee_id` vẫn đọc được cho lịch sử nhưng không dùng cho đơn mới.
- Không tự sao chép tiếp lịch từ hồ sơ nhân sự sau migration ban đầu.

## 7. Di trú và tương thích

Tạo migration kế tiếp, không sửa migration đã có:

- Hoàn thiện trigger nghỉ phép theo `user_id`.
- Bổ sung ràng buộc/index cần thiết mà vẫn bảo toàn dữ liệu cũ.
- Backfill `work_branch`/`bo_phan` từ dữ liệu hiện có chỉ một lần cho tài khoản còn trống; sau đó không đồng bộ ngược hoặc đồng bộ định kỳ.
- Không làm hỏng đơn nghỉ và lịch sử cũ có `hr_employee_id`.
- Không xóa `hr_employee_id`, các cột `sheet_*` hoặc `*_override` trong đợt này; ngừng sử dụng chúng trong đường quyền/nghỉ trước, dọn schema ở đợt riêng sau khi đo an toàn.

## 8. Xử lý lỗi

- Tạo/sửa tài khoản nội bộ thiếu cơ sở công tác hoặc bộ phận: HTTP 400 với mã lỗi ổn định.
- Bộ phận không thuộc cơ sở: HTTP 400.
- Tài khoản thiếu dữ liệu công tác không được nhận quyền `hr.leave.submit`; API gửi đơn cũng chặn lại ở server.
- Telegram chưa liên kết tài khoản hợp lệ: từ chối rõ ràng, không dò hồ sơ nhân sự để gửi thay.
- Không có người duyệt phù hợp: giữ đơn chờ và cảnh báo/fallback hiện hữu.

## 9. Phạm vi thay đổi

- Backend: repository tài khoản, route quản trị, giải quyền, leave self-service, leave authorization, work schedule, Telegram runtime và trigger migration.
- Frontend: modal tạo/sửa tài khoản, danh mục bộ phận phụ thuộc cơ sở, đổi thuật ngữ “Phòng ban” thành “Bộ phận” trong phạm vi duyệt nghỉ.
- Tài liệu: README, server/README, SCHEMA, CURRENT và tài liệu nghiệp vụ liên quan theo quy định repo.

Không thay đổi thuật toán hạn nộp, trạng thái đơn, cơ chế chống tranh chấp quyết định hoặc quyền mặc định của từng vai trò ngoài điều kiện đủ dữ liệu để tự gửi nghỉ.

## 10. Kiểm thử chấp nhận

- Tạo tài khoản `Trợ lý`, cơ sở công tác Hà Nội, bộ phận `Kho HN`: nhận đúng quyền Trợ lý và đơn nghỉ snapshot `Kho HN`/Hà Nội.
- Sửa hồ sơ nhân sự liên kết sang bộ phận khác không làm đổi quyền hoặc bộ phận đơn nghỉ của tài khoản.
- Đổi vai trò tài khoản không sửa bộ phận trong Danh sách nhân sự.
- Đổi cơ sở công tác làm danh mục bộ phận cập nhật và server từ chối bộ phận sai cơ sở.
- Người duyệt chỉ thấy/quyết định đơn thuộc đúng cơ sở và bộ phận được giao.
- Telegram gửi/duyệt dựa trên tài khoản, không dựa trên `hr_employees`.
- Chuyển hồ sơ nhân sự liên kết sang `resigned` vẫn khóa tài khoản; kích hoạt lại vẫn mở khóa theo chính sách hiện hữu, nhưng không đổi vai trò/quyền/cơ sở/bộ phận.
- Đơn và lịch sử cũ vẫn đọc/xuất được.
- Toàn bộ unit/integration/frontend tests xanh.

## 11. Tự rà soát

- Không còn điểm mơ hồ giữa “Bộ phận trực thuộc” và “Bộ phận được duyệt nghỉ”.
- Không mở rộng sang xóa liên kết nhân sự hoặc thay đổi đồng bộ email/SĐT.
- Không yêu cầu migration phá dữ liệu cũ.
- Phân quyền và định tuyến nghỉ có một nguồn dữ liệu rõ ràng, kiểm tra cả ở API lẫn database.
