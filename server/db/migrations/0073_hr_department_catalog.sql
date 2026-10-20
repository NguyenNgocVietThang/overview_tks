-- Chuan hoa Bo phan theo danh sach co dinh tung co so (file PHONG BAN.xlsx).
-- Ha Noi: Ban quan tri, Tro ly, Dat hang, Ke toan, Marketing, Sale HN, Kho HN, Lai xe HN.
-- Sai Gon: Quan ly-KT SG, Sale SG, Kho SG, Lai xe SG.
-- Bo phan ngoai danh sach (Truc page, Hau can - Bao ve, Tro ly SG...) giu nguyen.
-- QUAN TRONG: sao luu DB truoc khi ap. Quyen duyet nghi phep theo phong ban duoc nhan doi cho 2 co so.
CREATE FUNCTION pg_temp.canonical_hr_department(branch TEXT, value TEXT) RETURNS TEXT AS $$
  SELECT CASE branch
    WHEN 'hanoi' THEN CASE upper(regexp_replace(btrim(value), '\s+', ' ', 'g'))
      WHEN 'BAN QUẢN TRỊ' THEN 'Ban quản trị'
      WHEN 'TRỢ LÝ' THEN 'Trợ lý'
      WHEN 'ĐẶT HÀNG' THEN 'Đặt hàng'
      WHEN 'KẾ TOÁN' THEN 'Kế toán'
      WHEN 'MARKETING' THEN 'Marketing'
      WHEN 'SALE' THEN 'Sale HN'
      WHEN 'KHO' THEN 'Kho HN'
      WHEN 'LÁI XE' THEN 'Lái xe HN'
      ELSE value END
    WHEN 'saigon' THEN CASE upper(regexp_replace(btrim(value), '\s+', ' ', 'g'))
      WHEN 'BAN QUẢN TRỊ' THEN 'Quản lý-KT SG'
      WHEN 'TRƯỞNG CHI NHÁNH' THEN 'Quản lý-KT SG'
      WHEN 'KẾ TOÁN' THEN 'Quản lý-KT SG'
      WHEN 'SALE' THEN 'Sale SG'
      WHEN 'KHO' THEN 'Kho SG'
      WHEN 'LÁI XE' THEN 'Lái xe SG'
      ELSE value END
    ELSE value
  END;
$$ LANGUAGE SQL IMMUTABLE;

-- Quyen duyet theo phong ban khong gan co so: ten cu chung cho ca hai co so thi mo rong thanh ten chuan cua ca hai.
CREATE FUNCTION pg_temp.expand_grant(value TEXT) RETURNS TEXT[] AS $$
  SELECT CASE upper(regexp_replace(btrim(value), '\s+', ' ', 'g'))
    WHEN 'SALE' THEN ARRAY['Sale HN', 'Sale SG']
    WHEN 'KHO' THEN ARRAY['Kho HN', 'Kho SG']
    WHEN 'LÁI XE' THEN ARRAY['Lái xe HN', 'Lái xe SG']
    WHEN 'BAN QUẢN TRỊ' THEN ARRAY['Ban quản trị', 'Quản lý-KT SG']
    WHEN 'KẾ TOÁN' THEN ARRAY['Kế toán', 'Quản lý-KT SG']
    WHEN 'TRƯỞNG CHI NHÁNH' THEN ARRAY['Quản lý-KT SG']
    WHEN 'TRỢ LÝ' THEN ARRAY['Trợ lý']
    WHEN 'ĐẶT HÀNG' THEN ARRAY['Đặt hàng']
    WHEN 'MARKETING' THEN ARRAY['Marketing']
    ELSE ARRAY[value]
  END;
$$ LANGUAGE SQL IMMUTABLE;

UPDATE hr_employees SET bo_phan = pg_temp.canonical_hr_department(branch, bo_phan), updated_at = now()
WHERE bo_phan IS DISTINCT FROM pg_temp.canonical_hr_department(branch, bo_phan);

UPDATE app_users u SET leave_approval_departments = (
  SELECT COALESCE(array_agg(department ORDER BY first_position), '{}'::text[])
  FROM (
    SELECT department, min(position) AS first_position
    FROM unnest(u.leave_approval_departments) WITH ORDINALITY AS grants(value, position),
         unnest(pg_temp.expand_grant(value)) AS department
    GROUP BY department
  ) merged
), updated_at = now()
WHERE cardinality(u.leave_approval_departments) > 0;

-- Don nghi cu: doi ten snapshot theo co so cua don, bo qua trigger dong bang snapshot trong giao dich nay.
ALTER TABLE hr_leave_requests DISABLE TRIGGER hr_leave_department_snapshot;
UPDATE hr_leave_requests SET bo_phan = pg_temp.canonical_hr_department(branch, bo_phan)
WHERE bo_phan IS DISTINCT FROM pg_temp.canonical_hr_department(branch, bo_phan);
ALTER TABLE hr_leave_requests ENABLE TRIGGER hr_leave_department_snapshot;
DROP FUNCTION pg_temp.canonical_hr_department(TEXT, TEXT);
DROP FUNCTION pg_temp.expand_grant(TEXT);
