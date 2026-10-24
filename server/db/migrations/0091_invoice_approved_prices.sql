-- Bang gia duyet cua tab Hoa don (2026-10-24). Quan ly nhap tay: (co so, khach, san pham, gia duyet, nguoi duyet, ngay duyet).
-- Job "Kiem tra gia ban" dung gia duyet THAY cho gia toi thieu doc tu mo ta san pham khi dong hoa don co ngay ban >= ngay duyet
-- va cung (co so, khach, san pham). Xem server/invoicePriceAudit/approvedPrice*.js.
--
-- Tham chieu khach / san pham bang id Kiot (co so, id), KHONG luu ten/ma: ten hien thi JOIN customers / products luc doc
-- nen Kiot doi ten khach hay ma san pham thi bang tu cap nhat theo. Khong co FK (dong bo nguon khong xoa khach/san pham;
-- service tu kiem tra ton tai khi tao). Nhat ky bat bien, chi API doc, khong cap cho reporting_readonly.
-- Chi them, khong doi/xoa du lieu cu. Chay lai an toan (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS invoice_approved_prices (
  id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch         TEXT        NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  customer_id    BIGINT      NOT NULL,              -- customers.id cung co so
  product_id     BIGINT      NOT NULL,              -- products.id cung co so
  approved_price NUMERIC     NOT NULL CHECK (approved_price > 0),   -- don gia/chiec, da gom VAT/cuoc neu co
  approver       TEXT        NOT NULL,              -- danh sach cho phep kiem tra o service (approvedPriceRules.js)
  approved_on    DATE        NOT NULL,              -- ngay duyet (gio VN), co the sua
  version        INTEGER     NOT NULL DEFAULT 1,    -- khoa lac quan khi sua
  created_by     TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     TEXT        NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invoice_approved_prices_unique UNIQUE (branch, customer_id, product_id, approved_on)
);

CREATE INDEX IF NOT EXISTS idx_invoice_approved_prices_approved_on
  ON invoice_approved_prices (approved_on DESC);

-- Nhat ky tao / sua / xoa. Khong FK de dong "xoa" van con lich su.
CREATE TABLE IF NOT EXISTS invoice_approved_price_changes (
  id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  price_id     BIGINT      NOT NULL,
  action       TEXT        NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  actor        TEXT        NOT NULL,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  before_value JSONB,
  after_value  JSONB
);

CREATE INDEX IF NOT EXISTS idx_invoice_approved_price_changes_price
  ON invoice_approved_price_changes (price_id, changed_at DESC);

CREATE OR REPLACE FUNCTION invoice_approved_price_changes_guard() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'invoice_approved_price_changes is immutable'; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoice_approved_price_changes_guard ON invoice_approved_price_changes;
CREATE TRIGGER invoice_approved_price_changes_guard BEFORE UPDATE OR DELETE ON invoice_approved_price_changes
  FOR EACH ROW EXECUTE FUNCTION invoice_approved_price_changes_guard();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_readonly') THEN
    REVOKE ALL ON invoice_approved_prices, invoice_approved_price_changes FROM reporting_readonly;
  END IF;
END $$;
