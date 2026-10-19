-- Thông tin hồ sơ mở rộng từ file "DS nhân sự". Các cột này chỉ được API
-- trả về cho tài khoản có quyền hr.employees.manage.
ALTER TABLE hr_employees
  ADD COLUMN chuc_vu TEXT NOT NULL DEFAULT '',
  ADD COLUMN ngay_vao_lam DATE,
  ADD COLUMN ngay_sinh DATE,
  ADD COLUMN so_cccd TEXT NOT NULL DEFAULT '',
  ADD COLUMN dia_chi_hien_tai TEXT NOT NULL DEFAULT '',
  ADD COLUMN nguoi_than_quan_he TEXT NOT NULL DEFAULT '',
  ADD COLUMN nguoi_than_ho_ten TEXT NOT NULL DEFAULT '',
  ADD COLUMN nguoi_than_so_dien_thoai TEXT NOT NULL DEFAULT '',
  ADD COLUMN gioi_tinh TEXT NOT NULL DEFAULT '',
  ADD COLUMN ho_so_day_du BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN van_tay_da_dang_ky BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN ngay_nghi_viec DATE;

CREATE INDEX hr_employees_cccd_idx ON hr_employees (so_cccd) WHERE so_cccd <> '';
