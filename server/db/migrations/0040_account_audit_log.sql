-- Lich su chinh sua tai khoan (tab "Lich su chinh sua" o /account/#history).
-- Chi ghi thao tac QUAN TRI tai adminUserRoutes.js: tao, sua thong tin, dat lai mat khau,
-- xoa, sua phan quyen chi tiet. Xem server/auth/accountAuditLog.js.
--
-- Khong FK toi app_users: lich su phai con sau khi tai khoan bi xoa; ten/username cua
-- nguoi sua va tai khoan bi sua duoc chup lai luc ghi. changes = mang
-- [{field, label, before, after}] (quyen: {field:'permissions', added, removed}).
-- Khong bao gio chua mat khau / password hash.

CREATE TABLE account_audit_log (
  id               BIGSERIAL PRIMARY KEY,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  action           TEXT NOT NULL CHECK (action IN ('create', 'update', 'reset_password', 'delete', 'permissions')),
  actor_user_id    TEXT,
  actor_username   TEXT NOT NULL DEFAULT '',
  actor_name       TEXT NOT NULL DEFAULT '',
  target_user_id   TEXT,
  target_username  TEXT NOT NULL DEFAULT '',
  target_name      TEXT NOT NULL DEFAULT '',
  changes          JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(changes) = 'array')
);

CREATE INDEX account_audit_log_created_idx ON account_audit_log (created_at DESC, id DESC);
CREATE INDEX account_audit_log_target_idx ON account_audit_log (target_user_id, created_at DESC);

-- Nhat ky chi THEM, khong sua/xoa.
CREATE FUNCTION account_audit_log_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Account audit log is immutable';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER account_audit_log_guard BEFORE UPDATE OR DELETE ON account_audit_log
  FOR EACH ROW EXECUTE FUNCTION account_audit_log_guard();

-- Migration 0010 tu cap SELECT cho reporting_readonly tren moi bang tao sau no;
-- bang nay chua email/SĐT tai khoan nen thu hoi.
REVOKE SELECT ON account_audit_log FROM reporting_readonly;
