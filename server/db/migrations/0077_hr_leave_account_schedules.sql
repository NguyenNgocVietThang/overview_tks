-- Lịch làm việc dùng định danh tài khoản cho các đơn nghỉ mới.
-- employee_id được giữ nguyên để đọc lịch sử và đối chiếu dữ liệu cũ.
ALTER TABLE hr_leave_work_schedules
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES app_users(id);

-- Khóa chính cũ bắt employee_id luôn có giá trị. Chuyển thành hai khóa duy nhất
-- riêng để hỗ trợ cả lịch lịch sử theo nhân sự và lịch mới theo tài khoản.
ALTER TABLE hr_leave_work_schedules
  DROP CONSTRAINT IF EXISTS hr_leave_work_schedules_pkey;
ALTER TABLE hr_leave_work_schedules
  ALTER COLUMN employee_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS hr_leave_work_schedules_employee_date_idx
  ON hr_leave_work_schedules (employee_id, work_date)
  WHERE employee_id IS NOT NULL;

-- Một hồ sơ HR có thể đã có lịch riêng. Sao chép lịch đó sang từng tài khoản
-- liên kết hiện hữu; không sửa hay xóa dòng lịch sử theo employee_id.
UPDATE hr_leave_work_schedules s
SET user_id = u.id
FROM app_users u
WHERE u.hr_employee_id = s.employee_id
  AND u.trang_thai = 'Đang hoạt động'
  AND NOT u.is_deleted
  AND s.user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS hr_leave_work_schedules_user_date_idx
  ON hr_leave_work_schedules (user_id, work_date)
  WHERE user_id IS NOT NULL;

-- Trigger được thay ở migration kế tiếp sau khi chạy kiểm thử đầy đủ trên PGlite.
