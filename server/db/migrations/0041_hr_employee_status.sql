-- Trang thai lam viec cua nhan su (tab "Danh sach nhan su" trang Quan ly nhan su).
-- 'active' = Dang lam viec, 'resigned' = Da nghi viec. Tach khoi is_active: is_active
-- van la xoa mem (nhan su da nghi viec VAN hien trong danh sach va van chiem email/SDT
-- nen khong the them trung). Khi chuyen sang 'resigned', server khoa tai khoan dang nhap
-- lien ket voi lock_reason = 'hr_resigned' (khac 'hr_removed' cu vi resolver tu mo khoa
-- 'hr_removed' moi lan dang nhap). Xem server/hr/hrEmployeeAdminService.js.

ALTER TABLE hr_employees
  ADD COLUMN employment_status TEXT NOT NULL DEFAULT 'active'
  CHECK (employment_status IN ('active', 'resigned'));
