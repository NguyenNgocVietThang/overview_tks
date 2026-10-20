-- Yeu cau xuat VAT (thay Google Form + sheet "ORDER VAT 1", 2026-10-20).
-- Sale tao yeu cau, Ke toan xu ly trang thai. Phan quyen theo truong + khoa theo
-- trang thai nam o server/vatRequests/service.js; o day chi giu rang buoc du lieu.
--
-- Trang thai giu nguyen ma cua sheet cu, them 'pending' (cho KT xu ly):
--   pending | 0 Khong khai duoc | 1 Da xong | 2 Da khai cho ve | 3 Cho khai chen | 4 Cho cont ve, tang slg
-- Sale bi khoa khi status IN ('0','1','2').
--
-- created_by la app_users.id dang TEXT, khong FK: tai khoan admin cung co id khong
-- phai UUID, va xoa mem tai khoan khong duoc lam mat yeu cau cu. Ten/email chup lai
-- luc tao de hien thi ca khi tai khoan da doi ten.
-- Dong import tu sheet cu (is_legacy) duoc phep thieu thoi gian / nguoi tao / gia /
-- so luong / ma SP vi sheet goc co o "X" hoac trong; dong tao moi tren web thi bat buoc du.
CREATE TABLE IF NOT EXISTS vat_requests (
  id                   BIGSERIAL PRIMARY KEY,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           TEXT,
  created_by_name      TEXT NOT NULL DEFAULT '',
  created_by_email     TEXT NOT NULL DEFAULT '',
  is_legacy            BOOLEAN NOT NULL DEFAULT false,
  legacy_row           INTEGER,
  customer_name        TEXT NOT NULL DEFAULT '',
  customer_code        TEXT,
  product_code         TEXT NOT NULL DEFAULT '',
  product_key          TEXT GENERATED ALWAYS AS (lower(btrim(product_code))) STORED,
  product_name         TEXT NOT NULL DEFAULT '',
  quantity             NUMERIC CHECK (quantity > 0),
  unit_price_excl_vat  NUMERIC CHECK (unit_price_excl_vat > 0),
  total_amount         NUMERIC GENERATED ALWAYS AS (quantity * unit_price_excl_vat) STORED,
  full_vat             BOOLEAN NOT NULL DEFAULT false,
  sale_note            TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','0','1','2','3','4')),
  accountant_note      TEXT NOT NULL DEFAULT '',
  arrival_date         DATE,
  version              INTEGER NOT NULL DEFAULT 1,
  is_deleted           BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT vat_requests_new_row_complete CHECK (
    is_legacy OR (created_at IS NOT NULL AND created_by IS NOT NULL AND btrim(product_code) <> '' AND quantity IS NOT NULL AND unit_price_excl_vat IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS vat_requests_product_status_idx ON vat_requests(product_key, status) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS vat_requests_status_created_idx ON vat_requests(status, created_at DESC) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS vat_requests_created_by_idx ON vat_requests(created_by) WHERE NOT is_deleted;
-- Import lai sheet cu khong nhan doi dong.
CREATE UNIQUE INDEX IF NOT EXISTS vat_requests_legacy_row_key ON vat_requests(legacy_row) WHERE legacy_row IS NOT NULL;

-- Lich su tung truong (ai doi gi, luc nao): co so xu ly tranh chap sau khi khoa.
-- Chi ghi them, trigger chan sua/xoa giong account_audit_log (0040).
CREATE TABLE IF NOT EXISTS vat_request_history (
  id               BIGSERIAL PRIMARY KEY,
  request_id       BIGINT NOT NULL REFERENCES vat_requests(id),
  changed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by       TEXT,
  changed_by_name  TEXT NOT NULL DEFAULT '',
  action           TEXT NOT NULL CHECK (action IN ('create','update','delete','import')),
  field            TEXT,
  old_value        TEXT,
  new_value        TEXT
);
CREATE INDEX IF NOT EXISTS vat_request_history_request_idx ON vat_request_history(request_id, changed_at, id);

CREATE OR REPLACE FUNCTION vat_request_history_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'VAT request history is immutable';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS vat_request_history_guard ON vat_request_history;
CREATE TRIGGER vat_request_history_guard BEFORE UPDATE OR DELETE ON vat_request_history
  FOR EACH ROW EXECUTE FUNCTION vat_request_history_guard();

-- 0010 cap SELECT mac dinh cho reporting_readonly; bang nay co gia ban + ten khach nen chi doc qua API.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_readonly') THEN
    REVOKE ALL ON vat_requests, vat_request_history FROM reporting_readonly;
  END IF;
END $$;
