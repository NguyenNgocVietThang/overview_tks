-- Additive migration: external employee bot INSERTs remain compatible.
ALTER TABLE app_users ADD COLUMN leave_approval_departments TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE hr_leave_requests ADD COLUMN bo_phan TEXT NOT NULL DEFAULT '';

-- Existing records have no historical department log: capture current linked HR.
UPDATE hr_leave_requests r SET bo_phan = e.bo_phan
FROM hr_employees e
WHERE e.id = COALESCE(r.hr_employee_id, (SELECT u.hr_employee_id FROM app_users u WHERE u.id = r.user_id));

-- Explicit grants are initialized once, never automatically extended by role changes.
UPDATE app_users u SET leave_approval_departments = COALESCE((
  SELECT array_agg(department ORDER BY department) FROM (
    SELECT DISTINCT btrim(e.bo_phan) AS department FROM hr_employees e WHERE btrim(e.bo_phan) <> ''
  ) departments
), '{}'::text[]) WHERE u.vai_tro = 'Quản lý' AND NOT u.is_deleted;
UPDATE app_users u SET leave_approval_departments = ARRAY[btrim(e.bo_phan)]
FROM hr_employees e WHERE u.hr_employee_id = e.id AND u.vai_tro <> 'Quản lý'
  AND u.feature_permissions->>'hr.leave.manage' = 'true' AND btrim(e.bo_phan) <> '';

CREATE FUNCTION hr_leave_department_snapshot() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.bo_phan := OLD.bo_phan;
  ELSIF NEW.bo_phan = '' THEN
    SELECT COALESCE(e.bo_phan, '') INTO NEW.bo_phan FROM hr_employees e
    WHERE e.id = COALESCE(NEW.hr_employee_id, (SELECT u.hr_employee_id FROM app_users u WHERE u.id = NEW.user_id));
    NEW.bo_phan := COALESCE(NEW.bo_phan, '');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER hr_leave_department_snapshot BEFORE INSERT OR UPDATE ON hr_leave_requests
FOR EACH ROW EXECUTE FUNCTION hr_leave_department_snapshot();
CREATE INDEX hr_leave_requests_department_pending_idx ON hr_leave_requests(branch,bo_phan,thoi_gian_gui DESC)
WHERE trang_thai IN ('Chưa duyệt','Vi phạm');

-- Cards opened from /donnghi keep their own identity and never overwrite delivery leases.
CREATE TABLE hr_manager_telegram_cards (
  request_id TEXT NOT NULL REFERENCES hr_leave_requests(request_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  telegram_chat_id TEXT NOT NULL,
  message_id BIGINT NOT NULL,
  expected_version BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (telegram_chat_id, message_id)
);
CREATE INDEX hr_manager_telegram_cards_request_idx ON hr_manager_telegram_cards(request_id);
REVOKE SELECT ON hr_manager_telegram_cards FROM reporting_readonly;
