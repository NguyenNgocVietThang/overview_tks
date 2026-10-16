-- Durable manager-bot inbox, leave change outbox, message ownership and reply sessions.
ALTER TABLE hr_leave_requests ADD COLUMN decision_version BIGINT NOT NULL DEFAULT 0
  CHECK (decision_version >= 0);

CREATE OR REPLACE FUNCTION hr_leave_requests_before_update() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  -- Preserve the employee bot's existing status-only notification reset.
  IF NEW.trang_thai IS DISTINCT FROM OLD.trang_thai
     AND NEW.decision_notified_at IS NOT DISTINCT FROM OLD.decision_notified_at THEN
    NEW.decision_notified_at := NULL;
  END IF;
  IF ROW(NEW.trang_thai, NEW.nguoi_duyet, NEW.approver_user_id, NEW.thoi_diem_duyet, NEW.ghi_chu_duyet)
     IS DISTINCT FROM ROW(OLD.trang_thai, OLD.nguoi_duyet, OLD.approver_user_id, OLD.thoi_diem_duyet, OLD.ghi_chu_duyet) THEN
    NEW.decision_version := OLD.decision_version + 1;
  ELSE
    NEW.decision_version := OLD.decision_version;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE hr_leave_change_events (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES hr_leave_requests(request_id) ON DELETE CASCADE,
  decision_version BIGINT NOT NULL CHECK (decision_version >= 0),
  event_type TEXT NOT NULL CHECK (event_type IN ('CREATE', 'DECISION')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  UNIQUE (request_id, decision_version)
);
CREATE INDEX hr_leave_change_events_ready_idx ON hr_leave_change_events (available_at, id)
  WHERE completed_at IS NULL;

CREATE FUNCTION hr_leave_requests_manager_event() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO hr_leave_change_events(request_id, decision_version, event_type)
      VALUES (NEW.request_id, NEW.decision_version, 'CREATE');
  ELSIF NEW.decision_version IS DISTINCT FROM OLD.decision_version THEN
    INSERT INTO hr_leave_change_events(request_id, decision_version, event_type)
      VALUES (NEW.request_id, NEW.decision_version, 'DECISION');
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER hr_leave_requests_manager_event
  AFTER INSERT OR UPDATE ON hr_leave_requests
  FOR EACH ROW EXECUTE FUNCTION hr_leave_requests_manager_event();

-- Existing closed decisions are not replayed when the bot is first enabled.
INSERT INTO hr_leave_change_events(request_id, decision_version, event_type)
SELECT request_id, decision_version, 'CREATE' FROM hr_leave_requests
 WHERE loai_yeu_cau = 'Xin nghỉ phép' AND trang_thai IN ('Chưa duyệt', 'Tạm duyệt')
ON CONFLICT (request_id, decision_version) DO NOTHING;

CREATE TABLE hr_leave_manager_messages (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES hr_leave_requests(request_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  telegram_chat_id TEXT NOT NULL,
  message_id BIGINT,
  desired_version BIGINT NOT NULL DEFAULT 0 CHECK (desired_version >= 0),
  sent_version BIGINT NOT NULL DEFAULT -1 CHECK (sent_version >= -1),
  blocked BOOLEAN NOT NULL DEFAULT false,
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id, user_id, telegram_chat_id)
);
CREATE INDEX hr_leave_manager_messages_ready_idx ON hr_leave_manager_messages (available_at, id)
  WHERE NOT blocked AND desired_version > sent_version;

CREATE TABLE hr_manager_telegram_sessions (
  telegram_chat_id TEXT PRIMARY KEY,
  session_id UUID NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL REFERENCES hr_leave_requests(request_id) ON DELETE CASCADE,
  expected_version BIGINT NOT NULL CHECK (expected_version >= 0),
  prompt_message_id BIGINT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hr_manager_telegram_sessions_expiry_idx ON hr_manager_telegram_sessions (expires_at);

CREATE TABLE hr_manager_telegram_updates (
  update_id BIGINT PRIMARY KEY,
  payload JSONB NOT NULL,
  chat_key TEXT GENERATED ALWAYS AS (COALESCE(payload #>> '{callback_query,message,chat,id}',
    payload #>> '{message,chat,id}', update_id::text)) STORED,
  effects JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(effects) = 'array'),
  effects_done INTEGER NOT NULL DEFAULT 0 CHECK (effects_done >= 0),
  handled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effects_done <= jsonb_array_length(effects))
);
CREATE INDEX hr_manager_telegram_updates_ready_idx ON hr_manager_telegram_updates (available_at, update_id)
  WHERE completed_at IS NULL;
CREATE INDEX hr_manager_telegram_updates_chat_idx ON hr_manager_telegram_updates (chat_key, update_id)
  WHERE completed_at IS NULL;

CREATE TABLE hr_manager_telegram_state (
  singleton BOOLEAN PRIMARY KEY CHECK (singleton),
  first_enabled_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

REVOKE SELECT ON hr_leave_change_events, hr_leave_manager_messages,
  hr_manager_telegram_sessions, hr_manager_telegram_updates, hr_manager_telegram_state FROM reporting_readonly;
