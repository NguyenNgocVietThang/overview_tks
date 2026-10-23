-- Cau hinh bang (do rong cot, cot an/hien) ghi nho lau dai theo tai khoan.
-- Nguon: server/public/shared/table-controls.js; API: server/userTablePrefs/routes.js.
-- user_id la TEXT, khong FK toi app_users (tai khoan co the nam o kho JSON noi bo).
-- prefs = {"columns": {"<colKey>": {"width": number, "hidden": boolean}}}; chi luu cot da doi.

CREATE TABLE IF NOT EXISTS user_table_prefs (
  user_id     TEXT NOT NULL,
  table_key   TEXT NOT NULL,
  screen_mode TEXT NOT NULL CHECK (screen_mode IN ('desktop', 'mobile')),
  prefs       JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(prefs) = 'object'),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, table_key, screen_mode)
);

-- Cau hinh giao dien cua tung nguoi dung, khong phuc vu bao cao.
REVOKE SELECT ON user_table_prefs FROM reporting_readonly;
