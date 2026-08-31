CREATE TABLE returns (
  id                          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id                   BIGINT NOT NULL REFERENCES branches(id),
  kiotviet_id                 BIGINT NULL,
  return_code                 TEXT NOT NULL,
  return_date                 TIMESTAMPTZ NOT NULL,
  original_invoice_id         BIGINT NULL REFERENCES invoices(id),
  kiotviet_original_invoice_id BIGINT NULL,
  customer_id                 BIGINT NULL REFERENCES customers(id),
  sold_by_staff_id            BIGINT NULL REFERENCES staff(id),
  received_by_staff_id        BIGINT NULL REFERENCES staff(id),  -- KiotViet co ca 2 vai tro
  return_total                NUMERIC(18,2) NOT NULL DEFAULT 0,
  return_discount              NUMERIC(18,2) NOT NULL DEFAULT 0,
  return_fee                  NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_payment                NUMERIC(18,2) NOT NULL DEFAULT 0,
  status                      SMALLINT NULL,
  source                      TEXT NOT NULL DEFAULT 'kiotviet' CHECK (source IN ('kiotviet','manual','import')),
  kiotviet_modified_at        TIMESTAMPTZ NULL,
  kiotviet_synced_at          TIMESTAMPTZ NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX returns_branch_kiotviet_uq ON returns(branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL;
CREATE UNIQUE INDEX returns_branch_code_uq ON returns(branch_id, return_code);
CREATE INDEX returns_branch_date_idx ON returns(branch_id, return_date);
CREATE INDEX returns_original_invoice_idx ON returns(branch_id, original_invoice_id);
