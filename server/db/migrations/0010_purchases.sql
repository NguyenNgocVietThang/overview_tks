CREATE TABLE purchases (
  id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id                BIGINT NOT NULL REFERENCES branches(id),
  kiotviet_id              BIGINT NULL,
  purchase_code            TEXT NOT NULL,
  purchase_date            TIMESTAMPTZ NOT NULL,
  supplier_id              BIGINT NULL REFERENCES suppliers(id),
  kiotviet_supplier_id     BIGINT NULL,
  supplier_code_snapshot   TEXT NULL,
  supplier_name_snapshot   TEXT NULL,
  created_by_staff_id      BIGINT NULL REFERENCES staff(id),
  total_amount             NUMERIC(18,2) NOT NULL,
  discount_amount          NUMERIC(18,2) NOT NULL DEFAULT 0,
  supplier_debt_amount     NUMERIC(18,2) NOT NULL DEFAULT 0,
  paid_amount              NUMERIC(18,2) NOT NULL DEFAULT 0,
  status                   SMALLINT NULL,
  note                     TEXT NULL,
  source                   TEXT NOT NULL DEFAULT 'kiotviet' CHECK (source IN ('kiotviet','manual','import')),
  kiotviet_modified_at     TIMESTAMPTZ NULL,
  kiotviet_synced_at       TIMESTAMPTZ NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX purchases_branch_kiotviet_uq ON purchases(branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL;
CREATE UNIQUE INDEX purchases_branch_code_uq ON purchases(branch_id, purchase_code);
CREATE INDEX purchases_branch_date_idx ON purchases(branch_id, purchase_date);
CREATE INDEX purchases_branch_supplier_idx ON purchases(branch_id, supplier_id);

-- Cung chien luoc xoa-va-chen-lai nhu invoice_line_items.
CREATE TABLE purchase_line_items (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  purchase_id           BIGINT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  branch_id             BIGINT NOT NULL,
  line_no               INT NOT NULL,
  product_id            BIGINT NULL REFERENCES products(id),
  kiotviet_product_id   BIGINT NULL,
  product_code_snapshot TEXT NULL,
  product_name_snapshot TEXT NULL,
  quantity              NUMERIC(18,3) NOT NULL,
  price                 NUMERIC(18,2) NOT NULL,
  discount              NUMERIC(18,2) NOT NULL DEFAULT 0,
  line_amount           NUMERIC(18,2) NOT NULL,
  note                  TEXT NULL
);
CREATE UNIQUE INDEX purchase_line_items_uq ON purchase_line_items(purchase_id, line_no);
CREATE INDEX purchase_line_items_product_idx ON purchase_line_items(product_id);
