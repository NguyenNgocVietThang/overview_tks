-- Kiem tra gia ban (tab Hoa don, 2026-10-20). Moi dem 23:00 job chup cac hoa don chua quet trong cua so 7 ngay
-- va ghi ket qua doi chieu gia min; web (/api/invoice-price-audit) chi DOC bang nay, sale ghi giai thich,
-- nguoi co quyen ghi Chot (Ok / Phat). Xem server/invoicePriceAudit/.
--
-- 4 bang moi + cot freight_per_unit cua shipping_measures (cot O "Cuoc 1 Sp" cua sheet CAN DO).
-- Khong co FK sang invoices / invoice_details cua Kiot: dong bo nguon khong xoa/sua ban ghi nhan.
-- Bang giai thich / chot / nhat ky chi API duoc doc, khong cap cho reporting_readonly.
-- Chi them, khong doi/xoa du lieu cu. Chay lai an toan (IF NOT EXISTS).

-- So danh dau hoa don DA QUET (ke ca hoa don khong co dong can phat) -> chong quet trung o cap hoa don.
-- Xoa dong danh dau (het cua so) keo theo xoa cac dong chup va nhat ky (ON DELETE CASCADE o bang con).
CREATE TABLE IF NOT EXISTS invoice_price_audit_invoices (
  branch             TEXT        NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  invoice_id         BIGINT      NOT NULL,
  invoice_code       TEXT        NOT NULL,
  sold_day           DATE        NOT NULL,   -- (purchase_date AT TIME ZONE 'UTC')::date, gio dia phuong Kiot gan nhan UTC
  captured_at        TIMESTAMPTZ NOT NULL,
  run_day            DATE        NOT NULL,   -- ngay cua lan chay job da chup hoa don nay
  source_hash        TEXT,
  source_modified_at TIMESTAMPTZ,
  PRIMARY KEY (branch, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_price_audit_invoices_sold_day
  ON invoice_price_audit_invoices (sold_day);

-- 1 dong = 1 dong hang cua hoa don, chup tai thoi diem ghi nhan (khong upsert lai gia dong cu).
CREATE TABLE IF NOT EXISTS invoice_price_audit_lines (
  branch              TEXT        NOT NULL,
  invoice_id          BIGINT      NOT NULL,
  source_line_no      INTEGER     NOT NULL,   -- thu tu dong trong hoa don luc chup (bat dau tu 1)
  invoice_code        TEXT        NOT NULL,
  sold_at             TIMESTAMPTZ NOT NULL,   -- nhu invoices.purchase_date (gio dia phuong gan nhan UTC)
  sold_day            DATE        NOT NULL,
  -- nhan dien
  customer_code       TEXT        NOT NULL DEFAULT '',
  customer_name       TEXT        NOT NULL DEFAULT '',
  customer_email      TEXT        NOT NULL DEFAULT '',
  customer_level      TEXT        NOT NULL DEFAULT '',   -- Vua / Lon / VIP
  sale_name           TEXT        NOT NULL DEFAULT '',   -- nhom khach Kiot luc ghi nhan
  product_code        TEXT        NOT NULL DEFAULT '',
  product_name        TEXT        NOT NULL DEFAULT '',
  -- so luong va gia ban
  quantity            NUMERIC,
  total_code_quantity NUMERIC,                           -- tong SL cung ma trong hoa don, xet bac gia
  original_unit_price NUMERIC,                           -- don gia truoc giam
  unit_discount       NUMERIC,
  net_unit_price      NUMERIC,                           -- don gia sau giam
  full_vat            BOOLEAN     NOT NULL DEFAULT FALSE,
  -- doi chieu HN (NULL = khong co / khong tra)
  carton_size_hn      NUMERIC,
  quantity_price_hn   NUMERIC,
  level_price_hn      NUMERIC,
  vat_hn              NUMERIC,
  minimum_hn          NUMERIC,
  -- cuoc
  freight_eligible    BOOLEAN     NOT NULL DEFAULT FALSE,
  freight_per_unit    NUMERIC,                           -- cuoc/chiec da cong (0 neu thieu)
  -- doi chieu SG
  carton_size_sg      NUMERIC,
  quantity_price_sg   NUMERIC,
  level_price_sg      NUMERIC,
  vat_sg              NUMERIC,
  minimum_sg          NUMERIC,
  -- ket qua
  winning_source      TEXT        NOT NULL DEFAULT '',   -- HN / HN + cuoc / SG / Khong xet
  reason              TEXT        NOT NULL DEFAULT '',
  minimum_unit_price  NUMERIC,                           -- gia min ap dung, NULL = thieu gia
  unit_shortfall      NUMERIC,                           -- chenh/don vi goc
  original_amount     NUMERIC     NOT NULL DEFAULT 0,    -- tien chenh goc
  original_status     TEXT        NOT NULL CHECK (original_status IN ('correct', 'wrong')),
  calculation         JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- ung vien tung mien + ghi chu nguon
  -- ghi chu nguon
  product_note_hn     TEXT        NOT NULL DEFAULT '',
  product_note_sg     TEXT        NOT NULL DEFAULT '',
  line_note           TEXT        NOT NULL DEFAULT '',
  invoice_note        TEXT        NOT NULL DEFAULT '',
  -- giai thich cua sale + chot
  sale_explanation    TEXT        NOT NULL DEFAULT '',
  explanation_by      TEXT,
  explanation_at      TIMESTAMPTZ,
  decision            TEXT        CHECK (decision IN ('ok', 'penalty')),   -- NULL = chua chot
  decided_by          TEXT,
  decided_at          TIMESTAMPTZ,
  version             INTEGER     NOT NULL DEFAULT 1,    -- khoa lac quan khi sua giai thich/chot
  captured_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, invoice_id, source_line_no),
  CONSTRAINT invoice_price_audit_lines_branch_check CHECK (branch IN ('hanoi', 'saigon')),
  CONSTRAINT invoice_price_audit_lines_invoice_fk FOREIGN KEY (branch, invoice_id)
    REFERENCES invoice_price_audit_invoices (branch, invoice_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_invoice_price_audit_lines_sold
  ON invoice_price_audit_lines (sold_day DESC, branch);
CREATE INDEX IF NOT EXISTS idx_invoice_price_audit_lines_decision_sale
  ON invoice_price_audit_lines (decision, sale_name);
CREATE INDEX IF NOT EXISTS idx_invoice_price_audit_lines_status
  ON invoice_price_audit_lines (original_status, sold_day DESC);

-- 1 dong trang thai: ban du lieu da cong bo gan nhat (hoan thanh moi ngay dua tren DB, khong dua tren bo nho).
CREATE TABLE IF NOT EXISTS invoice_price_audit_state (
  id                   BOOLEAN     PRIMARY KEY DEFAULT TRUE CHECK (id),
  published_day        DATE,
  window_from          DATE,
  window_to            DATE,
  last_success_at      TIMESTAMPTZ,
  last_attempt_at      TIMESTAMPTZ,
  last_error           TEXT,
  added_invoice_count  INTEGER     NOT NULL DEFAULT 0,
  version              INTEGER     NOT NULL DEFAULT 1
);

-- Nhat ky sua giai thich / chot; het cua so xoa cung dong (CASCADE), khong luu lich su dai han.
CREATE TABLE IF NOT EXISTS invoice_price_audit_changes (
  id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch          TEXT        NOT NULL,
  invoice_id      BIGINT      NOT NULL,
  source_line_no  INTEGER     NOT NULL,
  actor           TEXT        NOT NULL,
  action          TEXT        NOT NULL,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  before_value    JSONB,
  after_value     JSONB,
  version_before  INTEGER,
  version_after   INTEGER,
  CONSTRAINT invoice_price_audit_changes_line_fk FOREIGN KEY (branch, invoice_id, source_line_no)
    REFERENCES invoice_price_audit_lines (branch, invoice_id, source_line_no) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_invoice_price_audit_changes_line
  ON invoice_price_audit_changes (branch, invoice_id, source_line_no, changed_at DESC);

-- Cot O "Cuoc 1 Sp (465/m3, 1367d/kg)" cua sheet CAN DO, doc truc tiep (khong tinh lai tu kg/m3).
-- NULL = o trong (quy tac doi chieu ap 0). Chi them cot, khong anh huong m3/kg cua Vong doi don.
ALTER TABLE shipping_measures ADD COLUMN IF NOT EXISTS freight_per_unit NUMERIC;

-- Co giai thich cua sale / quyet dinh chot / nhat ky: chi API duoc doc, khong cap cho reporting_readonly.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_readonly') THEN
    REVOKE ALL ON invoice_price_audit_invoices, invoice_price_audit_lines, invoice_price_audit_state,
      invoice_price_audit_changes FROM reporting_readonly;
  END IF;
END $$;
