-- Chuong thong bao chuyen tu file server/data/notifications.json sang Postgres (2026-10-24).
-- File JSON nam tren dia tam cua Render nen moi lan deploy / khoi dong lai la mat het lich su
-- chuong cua moi tai khoan. Du lieu cu trong file KHONG chuyen sang (file da mat theo moi lan deploy).
--
-- recipient_user_id la app_users.id dang TEXT, KHONG FK: tai khoan admin cung co id khong phai UUID
-- (tien le 0080/0090). id UUID do server sinh (crypto.randomUUID), khong DEFAULT (tien le 0009).
-- seq: thu tu chen, phan xu hai thong bao cung created_at (moi nhat truoc).
-- Chi them bang moi, idempotent.

CREATE TABLE IF NOT EXISTS notifications (
  id                UUID PRIMARY KEY,
  seq               BIGINT GENERATED ALWAYS AS IDENTITY,
  recipient_user_id TEXT NOT NULL,
  type              TEXT NOT NULL CHECK (btrim(type) <> ''),
  title             TEXT NOT NULL DEFAULT '',
  message           TEXT NOT NULL DEFAULT '',
  related_type      TEXT,
  related_id        TEXT,
  is_read           BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications(recipient_user_id, created_at DESC, seq DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications(recipient_user_id) WHERE NOT is_read;

-- 0010 cap SELECT mac dinh cho reporting_readonly; noi dung chuong la noi bo, chi doc qua API.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_readonly') THEN
    REVOKE ALL ON notifications FROM reporting_readonly;
  END IF;
END $$;
