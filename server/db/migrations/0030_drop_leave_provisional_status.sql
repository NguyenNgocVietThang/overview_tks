-- Gỡ trạng thái "Tạm duyệt" của đơn nghỉ phép: đơn đang ở trạng thái này quay về
-- "Chưa duyệt" (vẫn chờ quản lý kết luận). Trigger hiện có tự bump decision_version
-- và xóa decision_notified_at nên bot quản lý/nhân viên nhận lại đúng trạng thái.
UPDATE hr_leave_requests SET trang_thai = 'Chưa duyệt' WHERE trang_thai = 'Tạm duyệt';

ALTER TABLE hr_leave_requests DROP CONSTRAINT IF EXISTS hr_leave_requests_trang_thai_check;
ALTER TABLE hr_leave_requests ADD CONSTRAINT hr_leave_requests_trang_thai_check
  CHECK (trang_thai IN ('Chưa duyệt', 'Đã duyệt', 'Từ chối', 'Vi phạm'));
