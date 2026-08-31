-- orders: cung hinh dang invoices (khong tach line item, dung pham vi 9 tab
-- hien tai -- Sheets cung khong tach "Dat hang" thanh chi tiet rieng).
CREATE TABLE orders (
  id                        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id                 BIGINT NOT NULL REFERENCES branches(id),
  kiotviet_id               BIGINT NULL,
  order_code                TEXT NOT NULL,
  order_date                TIMESTAMPTZ NOT NULL,
  customer_id               BIGINT NULL REFERENCES customers(id),
  kiotviet_customer_id      BIGINT NULL,
  customer_code_snapshot    TEXT NULL,
  customer_name_snapshot    TEXT NULL,
  customer_contact_snapshot TEXT NULL,
  created_by_staff_id       BIGINT NULL REFERENCES staff(id),
  kiotviet_branch_id        BIGINT NULL,
  kiotviet_branch_name      TEXT NULL,
  total_amount              NUMERIC(18,2) NOT NULL,
  total_payment              NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_amount            NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_ratio             NUMERIC(9,4) NULL,
  status                    SMALLINT NULL,
  description               TEXT NULL,
  using_cod                 BOOLEAN NOT NULL DEFAULT false,
  source                    TEXT NOT NULL DEFAULT 'kiotviet' CHECK (source IN ('kiotviet','manual','import')),
  kiotviet_modified_at      TIMESTAMPTZ NULL,
  kiotviet_synced_at        TIMESTAMPTZ NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX orders_branch_kiotviet_uq ON orders(branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL;
CREATE UNIQUE INDEX orders_branch_code_uq ON orders(branch_id, order_code);
CREATE INDEX orders_branch_date_idx ON orders(branch_id, order_date);
CREATE INDEX orders_branch_customer_idx ON orders(branch_id, customer_id);
