-- Chi dinh vi tri hang cho don (trang Vong doi don hang, 2026-10-27).
-- Don "Da gui ke toan" duoc chi dinh lay hang tai cac dong cua VT Ha Noi / VT Sai Gon (stock_positions, 0095):
--   picking   = Dang nhat: GIU CHO (khong doi ghi chu thung); ton kha dung cua vi tri = SL tu ghi chu - tong giu cho cua don khac.
--   confirmed = Xac nhan nhat: da TRU thung that trong stock_positions (stock_position_history action 'pick').
--   cancelled = Huy nhat: tra giu cho; neu da xac nhan thi HOAN TAC (action 'pick_revert').
-- Moi (co so, ma don) chi co 1 chi dinh dang hoat dong (picking/confirmed); chi dinh lai = huy roi chi dinh moi.
-- Chi dinh theo MA HANG (dong don Kiot khong co id; nhieu dong cung ma duoc gop). Khong khoa ngoai toi stock_positions:
-- dong vi tri bi xoa (het hang) van con ban ghi, position_snapshot de tao lai khi hoan tac.

CREATE TABLE IF NOT EXISTS order_pick_assignments (
  id                  BIGSERIAL PRIMARY KEY,
  branch              TEXT        NOT NULL CHECK (branch IN ('HN', 'SG')),
  order_code          TEXT        NOT NULL CHECK (btrim(order_code) <> ''),
  status              TEXT        NOT NULL CHECK (status IN ('picking', 'confirmed', 'cancelled')),
  version             INTEGER     NOT NULL DEFAULT 1, -- khoa lac quan: moi doi trang thai +1
  order_snapshot      JSONB       NOT NULL DEFAULT '{}'::jsonb, -- khach, sale, ID Telegram, dong don, gia: in lai phieu dung noi dung
  assigned_by_user_id TEXT,
  assigned_by_name    TEXT        NOT NULL DEFAULT '',
  assigned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_by_user_id TEXT,
  confirmed_by_name   TEXT        NOT NULL DEFAULT '',
  confirmed_at        TIMESTAMPTZ,
  cancelled_by_user_id TEXT,
  cancelled_by_name   TEXT        NOT NULL DEFAULT '',
  cancelled_at        TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Toi da 1 chi dinh hoat dong cho moi (co so, ma don) (khong phan biet hoa/thuong, khoang trang dau/cuoi).
CREATE UNIQUE INDEX IF NOT EXISTS order_pick_assignments_active_uidx
  ON order_pick_assignments (branch, lower(btrim(order_code))) WHERE status IN ('picking', 'confirmed');
CREATE INDEX IF NOT EXISTS order_pick_assignments_order_idx
  ON order_pick_assignments (branch, lower(btrim(order_code)), id DESC);

CREATE TABLE IF NOT EXISTS order_pick_lines (
  id                BIGSERIAL PRIMARY KEY,
  assignment_id     BIGINT      NOT NULL REFERENCES order_pick_assignments(id) ON DELETE CASCADE,
  product_code      TEXT        NOT NULL,
  position_id       BIGINT      NOT NULL, -- stock_positions.id (khong FK: dong co the bi xoa khi het hang)
  location          TEXT        NOT NULL DEFAULT '',
  planned_qty       NUMERIC     NOT NULL CHECK (planned_qty > 0),
  reserved_qty      NUMERIC     NOT NULL CHECK (reserved_qty >= 0), -- chi tinh vao giu cho khi chi dinh dang 'picking'
  st_cartons        NUMERIC,    -- ST (so thung) tinh luc chi dinh, giu nguyen sau xac nhan
  st_text           TEXT,       -- dang in phieu: 2Tx60-20
  picked_qty        NUMERIC,    -- NULL toi khi xac nhan nhat
  spec_before       TEXT,       -- ghi chu vi tri ngay truoc khi tru (xac nhan nhat)
  spec_after        TEXT,       -- ghi chu vi tri ngay sau khi tru
  position_snapshot JSONB,      -- {code, name, notes, arrivalDate, location} luc xac nhan: tao lai dong neu bi tu xoa
  UNIQUE (assignment_id, position_id)
);
CREATE INDEX IF NOT EXISTS order_pick_lines_position_idx ON order_pick_lines (position_id);

-- Lich su chi them cua chi dinh (ai chi dinh / xac nhan / huy, luc nao); trigger chan sua/xoa nhu stock_position_history.
CREATE TABLE IF NOT EXISTS order_pick_history (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  assignment_id BIGINT      NOT NULL,
  branch        TEXT        NOT NULL CHECK (branch IN ('HN', 'SG')),
  order_code    TEXT        NOT NULL,
  action        TEXT        NOT NULL CHECK (action IN ('assign', 'confirm', 'cancel')),
  summary       JSONB,
  actor_user_id TEXT,
  actor_name    TEXT        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS order_pick_history_assignment_idx ON order_pick_history (assignment_id, id);

CREATE OR REPLACE FUNCTION order_pick_history_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Order pick history is immutable';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS order_pick_history_guard ON order_pick_history;
CREATE TRIGGER order_pick_history_guard BEFORE UPDATE OR DELETE ON order_pick_history
  FOR EACH ROW EXECUTE FUNCTION order_pick_history_guard();

-- Lich su VT: them 2 hanh dong nhat hang theo don (pick = tru thung khi xac nhan, pick_revert = hoan tac khi huy).
ALTER TABLE stock_position_history DROP CONSTRAINT IF EXISTS stock_position_history_action_check;
ALTER TABLE stock_position_history ADD CONSTRAINT stock_position_history_action_check
  CHECK (action IN ('seed', 'create', 'edit', 'delete', 'auto_delete', 'deduct', 'import_replace', 'import_add', 'pick', 'pick_revert'));

-- Cac bang co ten nguoi dung / noi dung don nen chi doc qua API (0010 cap SELECT mac dinh cho reporting_readonly).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_readonly') THEN
    REVOKE ALL ON order_pick_assignments FROM reporting_readonly;
    REVOKE ALL ON order_pick_lines FROM reporting_readonly;
    REVOKE ALL ON order_pick_history FROM reporting_readonly;
  END IF;
END $$;
