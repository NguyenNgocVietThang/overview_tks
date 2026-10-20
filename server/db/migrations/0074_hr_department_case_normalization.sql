-- Gộp dữ liệu Bộ phận cũ chỉ khác cách viết hoa/thường hoặc khoảng trắng.
-- Ưu tiên tên chuẩn của danh mục theo cơ sở; tên ngoài danh mục chọn một cách viết
-- hiện có (ưu tiên dạng không viết HOA TOÀN BỘ) để không tự ý đổi tên nghiệp vụ.
CREATE FUNCTION pg_temp.canonical_hr_department_case(branch TEXT, value TEXT) RETURNS TEXT AS $$
  SELECT CASE branch
    WHEN 'hanoi' THEN CASE lower(regexp_replace(btrim(value), '\s+', ' ', 'g'))
      WHEN 'ban quản trị' THEN 'Ban quản trị'
      WHEN 'trợ lý' THEN 'Trợ lý'
      WHEN 'đặt hàng' THEN 'Đặt hàng'
      WHEN 'kế toán' THEN 'Kế toán'
      WHEN 'marketing' THEN 'Marketing'
      WHEN 'sale' THEN 'Sale HN'
      WHEN 'sale hn' THEN 'Sale HN'
      WHEN 'kho' THEN 'Kho HN'
      WHEN 'kho hn' THEN 'Kho HN'
      WHEN 'lái xe' THEN 'Lái xe HN'
      WHEN 'lái xe hn' THEN 'Lái xe HN'
      ELSE regexp_replace(btrim(value), '\s+', ' ', 'g') END
    WHEN 'saigon' THEN CASE lower(regexp_replace(btrim(value), '\s+', ' ', 'g'))
      WHEN 'quản lý-kt sg' THEN 'Quản lý-KT SG'
      WHEN 'quản lý - kt sg' THEN 'Quản lý-KT SG'
      WHEN 'sale' THEN 'Sale SG'
      WHEN 'sale sg' THEN 'Sale SG'
      WHEN 'kho' THEN 'Kho SG'
      WHEN 'kho sg' THEN 'Kho SG'
      WHEN 'lái xe' THEN 'Lái xe SG'
      WHEN 'lái xe sg' THEN 'Lái xe SG'
      ELSE regexp_replace(btrim(value), '\s+', ' ', 'g') END
    ELSE regexp_replace(btrim(value), '\s+', ' ', 'g')
  END;
$$ LANGUAGE SQL IMMUTABLE;

WITH normalized AS (
  SELECT id, branch, bo_phan,
    pg_temp.canonical_hr_department_case(branch, bo_phan) AS canonical,
    first_value(pg_temp.canonical_hr_department_case(branch, bo_phan)) OVER (
      PARTITION BY branch, lower(regexp_replace(btrim(bo_phan), '\s+', ' ', 'g'))
      ORDER BY (pg_temp.canonical_hr_department_case(branch, bo_phan) = upper(pg_temp.canonical_hr_department_case(branch, bo_phan))),
        pg_temp.canonical_hr_department_case(branch, bo_phan)
    ) AS preferred
  FROM hr_employees
  WHERE btrim(COALESCE(bo_phan, '')) <> ''
)
UPDATE hr_employees e SET bo_phan = normalized.preferred, updated_at = now()
FROM normalized
WHERE e.id = normalized.id AND e.bo_phan IS DISTINCT FROM normalized.preferred;

-- Đơn nghỉ đã lưu snapshot Bộ phận cũng dùng cùng tên sau khi gộp.
WITH normalized AS (
  SELECT id, branch, bo_phan,
    first_value(pg_temp.canonical_hr_department_case(branch, bo_phan)) OVER (
      PARTITION BY branch, lower(regexp_replace(btrim(bo_phan), '\s+', ' ', 'g'))
      ORDER BY (pg_temp.canonical_hr_department_case(branch, bo_phan) = upper(pg_temp.canonical_hr_department_case(branch, bo_phan))),
        pg_temp.canonical_hr_department_case(branch, bo_phan)
    ) AS preferred
  FROM hr_leave_requests
  WHERE btrim(COALESCE(bo_phan, '')) <> ''
)
UPDATE hr_leave_requests r SET bo_phan = normalized.preferred
FROM normalized
WHERE r.id = normalized.id AND r.bo_phan IS DISTINCT FROM normalized.preferred;

DROP FUNCTION pg_temp.canonical_hr_department_case(TEXT, TEXT);
