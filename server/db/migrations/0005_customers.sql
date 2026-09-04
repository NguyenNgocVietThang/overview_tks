CREATE TABLE customers (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id             BIGINT NOT NULL REFERENCES branches(id),
  kiotviet_id           BIGINT NULL,
  customer_code         TEXT NOT NULL,
  name                  TEXT NOT NULL,
  contact_number        TEXT NULL,
  sub_contact_number    TEXT NULL,
  address               TEXT NULL,
  organization          TEXT NULL,
  customer_group_names  TEXT NULL,   -- gop chuoi, giong cach hien tai dang lam
  gender                TEXT NULL,
  birthday              DATE NULL,
  debt_amount           NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_invoiced        NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_revenue         NUMERIC(18,2) NOT NULL DEFAULT 0,  -- so KiotViet tu tinh
  source                TEXT NOT NULL DEFAULT 'kiotviet' CHECK (source IN ('kiotviet','manual','import')),
  kiotviet_modified_at  TIMESTAMPTZ NULL,
  kiotviet_synced_at    TIMESTAMPTZ NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customers_branch_kiotviet_uq ON customers(branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL;
CREATE UNIQUE INDEX customers_branch_code_uq ON customers(branch_id, customer_code);
