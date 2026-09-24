-- Them vai tro "Nhan vien marketing" (quyen mac dinh bang "Nhan vien sale").
-- CHECK cua cot vai_tro duoc khai bao inline trong 0009 nen Postgres tu dat
-- ten app_users_vai_tro_check — phai xoa roi tao lai voi danh sach moi.
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_vai_tro_check;

ALTER TABLE app_users ADD CONSTRAINT app_users_vai_tro_check
  CHECK (vai_tro IN (
    'Quản lý', 'Kế toán', 'Trưởng kho', 'Trợ lý', 'Lái xe',
    'Nhân viên kho', 'Nhân viên sale', 'Nhân viên marketing',
    'Nhân viên mua hàng', 'Khách'
  ));
