-- Consolidate HR department names and existing leave approval grants.
-- Account roles and feature overrides retain their existing permissions.
CREATE FUNCTION pg_temp.canonical_hr_department(value TEXT) RETURNS TEXT AS $$
  SELECT CASE upper(regexp_replace(btrim(value), '\s+', ' ', 'g'))
    WHEN 'BAN QUẢN LÝ' THEN 'BAN QUẢN TRỊ'
    WHEN 'TRƯỞNG CHI NHÁNH' THEN 'BAN QUẢN TRỊ'
    WHEN 'BAN QUẢN TRỊ' THEN 'BAN QUẢN TRỊ'
    WHEN 'HẬU CẦN' THEN 'HẬU CẦN - BẢO VỆ'
    WHEN 'BẢO VỆ' THEN 'HẬU CẦN - BẢO VỆ'
    WHEN 'HẬU CẦN - BẢO VỆ' THEN 'HẬU CẦN - BẢO VỆ'
    ELSE value
  END;
$$ LANGUAGE SQL IMMUTABLE;

UPDATE hr_employees SET bo_phan = pg_temp.canonical_hr_department(bo_phan), updated_at = now()
WHERE bo_phan IS DISTINCT FROM pg_temp.canonical_hr_department(bo_phan);

UPDATE app_users u SET leave_approval_departments = (
  SELECT COALESCE(array_agg(department ORDER BY first_position), '{}'::text[])
  FROM (
    SELECT pg_temp.canonical_hr_department(value) AS department, min(position) AS first_position
    FROM unnest(u.leave_approval_departments) WITH ORDINALITY AS grants(value, position)
    GROUP BY pg_temp.canonical_hr_department(value)
  ) merged
), updated_at = now();

-- Rename existing snapshots so old requests match the merged approval scopes.
-- Temporarily bypass only the snapshot freeze, inside the migration transaction.
ALTER TABLE hr_leave_requests DISABLE TRIGGER hr_leave_department_snapshot;
UPDATE hr_leave_requests SET bo_phan = pg_temp.canonical_hr_department(bo_phan)
WHERE bo_phan IS DISTINCT FROM pg_temp.canonical_hr_department(bo_phan);
ALTER TABLE hr_leave_requests ENABLE TRIGGER hr_leave_department_snapshot;
DROP FUNCTION pg_temp.canonical_hr_department(TEXT);
