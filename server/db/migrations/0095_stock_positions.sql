-- Co so du lieu Vi tri hang moi (tab "VT Ha Noi" / "VT Sai Gon", 2026-10-27).
-- Chay song song voi 2 tab cu "Vi tri HN/SG" (van doc Google Sheets qua stock_location_lines).
-- Du lieu dau SAO CHEP MOT LAN tu stock_location_lines roi NGAT: tu day sua/them/xoa/import
-- truc tiep tren web, khong con dong bo tu Google Sheets.
--
-- So luong (SL kho) va canh bao KHONG luu: luon tinh tu ghi chu bang public/shared/carton.js.
-- Ten SP + SL KiotViet doc theo ma tu `products` luc xem (name o day chi la du phong khi
-- products chua co ma). Ngay ve luu dang TEXT (co the "KK 4.10", "16/10" hoac de trong).
-- Khong rang buoc UNIQUE (branch, ma, vi tri): du lieu dau co dong trung; ung dung chan
-- khi nhap moi, dong trung san co gan canh bao "Trung vi tri".

CREATE TABLE IF NOT EXISTS stock_positions (
  id                 BIGSERIAL PRIMARY KEY,
  branch             TEXT        NOT NULL CHECK (branch IN ('HN', 'SG')),
  code               TEXT        NOT NULL CHECK (btrim(code) <> ''),
  name               TEXT        NOT NULL DEFAULT '',
  notes              TEXT        NOT NULL DEFAULT '',
  arrival_date       TEXT        NOT NULL DEFAULT '',
  location           TEXT        NOT NULL DEFAULT '',
  version            INTEGER     NOT NULL DEFAULT 1,
  updated_by_user_id TEXT,
  updated_by_name    TEXT        NOT NULL DEFAULT '',
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_positions_code_idx ON stock_positions (branch, lower(btrim(code)));
CREATE INDEX IF NOT EXISTS stock_positions_location_idx ON stock_positions (branch, location);

-- Lich su chi them (ai doi gi, luc nao), trigger chan sua/xoa giong account_audit_log (0040) va 0076.
-- Khong khoa ngoai: dong vi tri bi xoa van con lich su.
-- action: seed | create | edit | delete | auto_delete | deduct | import_replace | import_add.
-- Dong import_* la ban tom tat (summary = so dong them/doi/xoa/bo qua); tung dong doi ghi them dong create/edit/delete.
CREATE TABLE IF NOT EXISTS stock_position_history (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  branch        TEXT        NOT NULL CHECK (branch IN ('HN', 'SG')),
  position_id   BIGINT,
  code          TEXT        NOT NULL DEFAULT '',
  location      TEXT        NOT NULL DEFAULT '',
  action        TEXT        NOT NULL CHECK (action IN ('seed', 'create', 'edit', 'delete', 'auto_delete', 'deduct', 'import_replace', 'import_add')),
  field         TEXT,
  old_value     TEXT,
  new_value     TEXT,
  summary       JSONB,
  actor_user_id TEXT,
  actor_name    TEXT        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS stock_position_history_branch_idx ON stock_position_history (branch, id DESC);

CREATE OR REPLACE FUNCTION stock_position_history_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Stock position history is immutable';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS stock_position_history_guard ON stock_position_history;
CREATE TRIGGER stock_position_history_guard BEFORE UPDATE OR DELETE ON stock_position_history
  FOR EACH ROW EXECUTE FUNCTION stock_position_history_guard();

-- Du lieu dau (chay mot lan: bang dang rong). Bo dong thieu ma va dong het hang (ghi chu rong / "Het hang")
-- vi quy tac tu xoa khi SL = 0 se xoa chung o lan luu ke tiep. HN co dong ghi chu bat dau bang "T x " thua
-- (mau cua sheet, vd "T x 4T*100"): go tien to do khi phan sau la "<so>T..." de ghi chu doc duoc.
-- Ghi chu con lai giu nguyen (se duoc chuan hoa khi sua), dong sai dinh dang chi bi canh bao.
INSERT INTO stock_positions (branch, code, name, notes, arrival_date, location, updated_by_name, updated_at, created_at)
SELECT s.branch, btrim(s.code), btrim(s.name), s.notes, btrim(s.arrival_date), btrim(s.location), 'Nhập dữ liệu đầu', now(), now()
FROM (
  SELECT branch, source_row, code, name, arrival_date, location,
         btrim(regexp_replace(btrim(notes), '^[Tt]\s*[xX×*]\s*(?=\d+([.,]\d+)?\s*[Tt])', '')) AS notes
  FROM stock_location_lines
) s
WHERE btrim(s.code) <> ''
  AND s.notes <> ''
  AND lower(s.notes) <> lower('Hết hàng')
  AND NOT EXISTS (SELECT 1 FROM stock_positions)
ORDER BY s.branch, s.source_row;

INSERT INTO stock_position_history (branch, action, summary, actor_name)
SELECT branch, 'seed', jsonb_build_object('rows', count(*), 'source', 'stock_location_lines'), 'Nhập dữ liệu đầu'
FROM stock_positions
WHERE updated_by_name = 'Nhập dữ liệu đầu'
  AND NOT EXISTS (SELECT 1 FROM stock_position_history WHERE action = 'seed')
GROUP BY branch;

-- 0010 cap SELECT mac dinh cho reporting_readonly; lich su co ten nguoi dung nen chi doc qua API.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_readonly') THEN
    REVOKE ALL ON stock_position_history FROM reporting_readonly;
  END IF;
END $$;
