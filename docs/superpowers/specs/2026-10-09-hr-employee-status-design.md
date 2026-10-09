# Kế hoạch: Trạng thái, thêm và sửa nhân sự ở tab Danh sách nhân sự

## Context
Tab "Danh sách nhân sự" (`server/public/humanresources/index.html`, panel `#hrSubtab-danhsach`) hiện chỉ đọc, 5 cột (Họ tên, Chức vụ, Cơ sở, SĐT, Email). Nó chỉ liệt kê `hr_employees` có `is_active = true`.

Cần thêm:
- Cột Trạng thái: "Đang làm việc" (chữ xanh lá) / "Đã nghỉ việc" (chữ đỏ).
- Nút "Thêm nhân sự" mở form.
- Bấm một dòng thì mở hộp chi tiết dạng modal, giống `#editUserModal` ở trang tài khoản. Hộp này sửa thông tin và có dropdown trạng thái.
- Cột/trường "Ngày thêm".

Quyết định đã chốt với người dùng:
- **Ngày thêm**: tự động (lấy `created_at`), không ai sửa được, chỉ hiện cho Quản lý hoặc người được phân quyền.
- **Đã nghỉ việc**: tự khóa tài khoản đăng nhập liên kết. Đây là đảo lại quyết định cũ: cơ chế tự khóa `hr_removed` từng bị gỡ. Vì vậy phải dùng `lock_reason` mới, **`hr_resigned`**.
  - Không dùng `hr_removed`, vì `effectiveUserResolver.js:156,200` tự mở khóa giá trị đó mỗi lần đăng nhập.

Mặc định đã giả định (người dùng không phản đối khi chốt):
- Mọi người có `hr.employees` đều xem được danh sách.
- Quyền sửa gộp một khóa mới `hr.employees.manage` (Quản lý mặc định, có thể cấp riêng), dùng cho: thêm, sửa thông tin, đổi trạng thái.

## Thiết kế

### 1. DB (migration `0041_hr_employee_status.sql`, số kế tiếp sau 0040)
- Thêm `hr_employees.employment_status TEXT NOT NULL DEFAULT 'active' CHECK (IN ('active','resigned'))`.
- `is_active` giữ nguyên nghĩa "chưa bị xóa mềm". Tất cả code hiện có dùng `selectAllActive` vẫn chạy như cũ.
- Hai unique index email và SĐT đang áp dụng khi `is_active` và giá trị khác rỗng. Người nghỉ việc vẫn chiếm email/SĐT của họ, nên không thể thêm trùng. Đó là hành vi mong muốn.
- Cập nhật `db/SCHEMA.md` và thêm test regex migration, theo mẫu `db/accountAuditLogMigration.test.js`.

### 2. Backend
- `hr/hrEmployeesRepository.js`
  - `rowToEmployee` trả thêm `employmentStatus` và `createdAt`.
  - Thêm `updateEmployeeById` (họ tên, bộ phận, cơ sở, SĐT, email, trạng thái).
  - `insertEmployee` đã có; kiểm tra nó nhận đủ trường.
  - Thêm `setEmploymentStatus`.
- `hr/employeeDirectory.js`: `mapEmployeeRow` mang theo `employmentStatus` và `createdAt`. Dùng lại `updateEmployeeContact` (đã có kiểm tra trùng) và `writeDepartmentForRole`. Gọi `clearCache()` sau mỗi lần ghi.
- `hr/hrLeaveRoutes.js` (cạnh `GET /api/hr/employees`, dòng ~394-412)
  - `GET /api/hr/employees` trả thêm `trangThai` ("Đang làm việc" / "Đã nghỉ việc").
  - `ngayThem` chỉ được trả khi `req.user` có `hr.employees.manage`. Người khác không nhận trường này.
  - Mới:
    - `POST /api/hr/employees` (thêm)
    - `PUT /api/hr/employees/:id` (sửa thông tin và trạng thái)
    - Cả hai dùng `requireFeature('hr.employees.manage')` và `resolveBranchScope` để kiểm tra cơ sở. Lỗi trùng email/SĐT trả 409 như `updateEmployeeContact`.
- Khóa/mở khóa tài khoản: khi trạng thái chuyển `resigned`, tìm `app_users` có `hr_employee_id = id`.
  - Với tài khoản đó, đặt `trangThai = 'Khóa'` và `lock_reason = 'hr_resigned'`.
  - Bỏ qua và báo cảnh báo trong response nếu tài khoản là admin cứng / Quản lý được bảo vệ (xem `account-protected-manager-ui`), tránh khóa nhầm admin.
  - Khi chuyển về `active`, chỉ mở khóa tài khoản có `lock_reason = 'hr_resigned'`. Không đụng khóa thủ công (`manual`).
  - Việc khóa/mở khóa này cũng ghi vào `auth/accountAuditLog.js` (`record()`, `action: 'update'`, field `trangThai`) để lịch sử tài khoản thấy được.
  - `authRoutes.js` login: đã có nhánh cho `lockReason`; thêm thông báo riêng cho `hr_resigned` (mã `ACCOUNT_HR_RESIGNED`, "Bạn đã nghỉ việc…"). Đây là bước nhỏ, không bắt buộc.
- `auth/featureRegistry.js`: thêm `{ key:'hr.employees.manage', groupKey:'hr', roles: MANAGER_ONLY, requires:'hr.employees', label:'Quản lý nhân sự' }` dưới dòng 84. Cập nhật `featureRegistry.test.js`.
- Export Excel (`hrEmployeeExportService.js`): thêm cột Trạng thái. Ngày thêm chỉ khi người xuất có quyền manage.

### 3. Frontend (`humanresources/index.html`)
- Bảng: thêm cột Trạng thái (class chữ xanh `#16a34a` / đỏ `#dc2626`, theo token CSS đang dùng trong trang). Thêm cột Ngày thêm, ẩn bằng `hrCan('hr.employees.manage')`. Dropdown lọc nhóm "Trạng thái" cạnh bộ lọc Cơ sở/Bộ phận, với 3 lựa chọn: "Đang làm việc", "Đã nghỉ việc", "Tất cả". **Mặc định là "Đang làm việc" cho mọi người** (kể cả người chỉ xem), nên lúc mở tab chỉ thấy nhân sự đang làm. Việc lọc làm phía client trong `renderEmployeeDirectoryTable()`. Xuất Excel theo đúng nhóm đang lọc.
- Dòng bấm được (`row-clickable`):
  - Người có quyền manage: mở modal chi tiết `#employeeEditModal`.
  - Người chỉ xem: không mở gì (hoặc modal chỉ đọc; chọn không mở cho gọn).
- Modal chi tiết, dựng theo `#editUserModal` (`public/account/index.html` dòng ~758-825, CSS `.modal-overlay/.modal-box` dòng 270-293). Gồm: Họ tên, Chức vụ (bộ phận), Cơ sở, SĐT, Email, dropdown Trạng thái, Ngày thêm (chỉ đọc), hộp lỗi, nút Hủy/Lưu. Hai hàm `openModal`/`closeModal` toggle thuộc tính `hidden`, và bổ sung Escape.
- Nút "Thêm nhân sự" (chỉ hiện với quyền manage) mở cùng modal ở chế độ tạo, trạng thái mặc định "Đang làm việc".
- Khi chọn "Đã nghỉ việc", hiện dòng cảnh báo: "Tài khoản đăng nhập liên kết sẽ bị khóa."
- Sau khi lưu: `loadEmployeeDirectory()` tải lại, hiện toast.
- `HR_SUBTAB_FEATURE` / `hrCan` không đổi; thêm `hrCan('hr.employees.manage')` cho nút và cột.

## Tệp chính cần sửa
- `server/db/migrations/0041_hr_employee_status.sql` (mới), `server/db/SCHEMA.md`
- `server/hr/hrEmployeesRepository.js`, `server/hr/employeeDirectory.js`, `server/hr/hrLeaveRoutes.js`, `server/hr/hrEmployeeExportService.js`
- `server/auth/featureRegistry.js` (+ test), `server/auth/authRoutes.js` (thông báo đăng nhập)
- `server/public/humanresources/index.html`

## Kiểm thử
- Backend (`node --test`):
  - Sửa `hrLeaveRoutes.test.js`: danh sách khóa key hiện pin cứng, nay thêm `trangThai`; `ngayThem` chỉ có với quyền manage.
  - Test mới cho POST/PUT: quyền 403, trùng email/SĐT 409, phạm vi cơ sở.
  - Test khóa/mở khóa: `hr_resigned` khóa tài khoản; mở lại chỉ gỡ `hr_resigned`; không đụng khóa `manual`; bỏ qua admin được bảo vệ.
  - Test `employeeDirectory`, test migration.
- Frontend JSDOM (mẫu `test/frontend/hr-branch-department-filters.test.js`): màu xanh/đỏ, cột Ngày thêm ẩn với người thường, bấm dòng mở modal chỉ với quyền manage, form thêm gửi đúng payload.
- Chạy toàn bộ `npm test` (hiện ~1700 test) rồi xem trang thật qua harness trong `reference-tokosi-view-pages-without-login` để kiểm giao diện.
- Sau triển khai: phải chạy `npm run db:migrate` trước khi deploy.
