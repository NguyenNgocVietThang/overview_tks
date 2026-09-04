CREATE TABLE invoices (
  id                        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id                 BIGINT NOT NULL REFERENCES branches(id),
  kiotviet_id               BIGINT NULL,
  invoice_code              TEXT NOT NULL,
  purchase_date             TIMESTAMPTZ NOT NULL,
  order_code                TEXT NULL,
  customer_id               BIGINT NULL REFERENCES customers(id),
  kiotviet_customer_id      BIGINT NULL,
  customer_code_snapshot    TEXT NULL,
  customer_name_snapshot    TEXT NULL,
  customer_contact_snapshot TEXT NULL,
  sold_by_staff_id          BIGINT NULL REFERENCES staff(id),
  kiotviet_branch_id        BIGINT NULL,      -- field noi bo KiotViet, KHAC branch_id
  kiotviet_branch_name      TEXT NULL,
  total_amount              NUMERIC(18,2) NOT NULL,
  discount_amount           NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_payment             NUMERIC(18,2) NOT NULL DEFAULT 0,
  status                    SMALLINT NULL,     -- giu nguyen ma goc KiotViet, KHONG suy dien nhan
  description               TEXT NULL,
  using_cod                 BOOLEAN NOT NULL DEFAULT false,
  source                    TEXT NOT NULL DEFAULT 'kiotviet' CHECK (source IN ('kiotviet','manual','import')),
  kiotviet_modified_at      TIMESTAMPTZ NULL,
  kiotviet_synced_at        TIMESTAMPTZ NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invoices_branch_kiotviet_uq ON invoices(branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL;
CREATE UNIQUE INDEX invoices_branch_code_uq ON invoices(branch_id, invoice_code);
CREATE INDEX invoices_branch_date_idx ON invoices(branch_id, purchase_date);
CREATE INDEX invoices_branch_customer_date_idx ON invoices(branch_id, customer_id, purchase_date);

-- Khong co ID dong on dinh tu KiotViet cho tung line item -> line_no (vi tri
-- trong mang) la conflict target. Chien luoc upsert: XOA het dong cu cua 1
-- invoice roi CHEN LAI toan bo trong cung transaction voi header.
CREATE TABLE invoice_line_items (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id            BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  branch_id             BIGINT NOT NULL,     -- copy tu cha, ghi trong CUNG transaction nen khong lech
  line_no               INT NOT NULL,
  product_id            BIGINT NULL REFERENCES products(id),
  kiotviet_product_id   BIGINT NULL,
  product_code_snapshot TEXT NULL,
  product_name_snapshot TEXT NULL,
  quantity              NUMERIC(18,3) NOT NULL,
  price                 NUMERIC(18,2) NOT NULL,
  discount              NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_ratio        NUMERIC(9,4) NULL,
  line_amount           NUMERIC(18,2) NOT NULL,
  note                  TEXT NULL
);
CREATE UNIQUE INDEX invoice_line_items_uq ON invoice_line_items(invoice_id, line_no);
CREATE INDEX invoice_line_items_product_idx ON invoice_line_items(product_id);
