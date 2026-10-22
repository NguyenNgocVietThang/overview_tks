-- Tách thông tin công tác của tài khoản khỏi hồ sơ nhân sự.
-- Chỉ sao chép một lần dữ liệu hiện hữu; sau migration, code không đồng bộ ngược lại.
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS work_branch TEXT NOT NULL DEFAULT ''
    CHECK (work_branch IN ('hanoi', 'saigon', '')),
  ADD COLUMN IF NOT EXISTS bo_phan TEXT NOT NULL DEFAULT '';

-- Chốt lại vai trò/cơ sở ĐANG có hiệu lực trên web trước khi bỏ cơ chế
-- resolver đọc hồ sơ HR. Quyền cấp/tắt riêng trong feature_permissions giữ nguyên.
UPDATE app_users u
SET vai_tro = COALESCE(NULLIF(u.vai_tro_override, ''), NULLIF(u.sheet_vai_tro, ''), u.vai_tro),
    co_so = CASE COALESCE(NULLIF(u.co_so_override, ''), NULLIF(u.sheet_co_so, ''), '')
      WHEN 'Hà Nội' THEN 'hanoi'
      WHEN 'Sài Gòn' THEN 'saigon'
      WHEN 'Cả hai' THEN 'both'
      WHEN 'hanoi' THEN 'hanoi'
      WHEN 'saigon' THEN 'saigon'
      WHEN 'both' THEN 'both'
      ELSE u.co_so
    END,
    updated_at = now()
WHERE u.hr_managed;

UPDATE app_users u
SET work_branch = CASE
      WHEN u.work_branch <> '' THEN u.work_branch
      WHEN e.branch IN ('hanoi', 'saigon') THEN e.branch
      WHEN u.co_so IN ('hanoi', 'saigon') THEN u.co_so
      ELSE ''
    END,
    bo_phan = CASE WHEN u.bo_phan <> '' THEN u.bo_phan ELSE e.bo_phan END,
    updated_at = now()
FROM hr_employees e
WHERE u.hr_employee_id = e.id
  AND (u.work_branch = '' OR u.bo_phan = '');

-- Tài khoản không có hồ sơ HR vẫn dùng cơ sở tài khoản nếu đã là một cơ sở vật lý.
UPDATE app_users
SET work_branch = co_so, updated_at = now()
WHERE work_branch = '' AND co_so IN ('hanoi', 'saigon');

CREATE INDEX IF NOT EXISTS app_users_work_scope_idx
  ON app_users (work_branch, bo_phan) WHERE NOT is_deleted;
