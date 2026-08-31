CREATE TABLE suppliers (
  id                             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id                      BIGINT NOT NULL REFERENCES branches(id),
  kiotviet_id                    BIGINT NULL,
  supplier_code                  TEXT NOT NULL,
  name                           TEXT NOT NULL,
  contact_number                 TEXT NULL,
  address                        TEXT NULL,
  debt_amount                    NUMERIC(18,2) NOT NULL DEFAULT 0,
  is_active                      BOOLEAN NOT NULL DEFAULT true,
  created_by_staff_id            BIGINT NULL REFERENCES staff(id),
  total_purchased                NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_purchased_net_of_returns NUMERIC(18,2) NOT NULL DEFAULT 0,
  source                         TEXT NOT NULL DEFAULT 'kiotviet' CHECK (source IN ('kiotviet','manual','import')),
  kiotviet_modified_at           TIMESTAMPTZ NULL,
  kiotviet_synced_at             TIMESTAMPTZ NULL,
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX suppliers_branch_kiotviet_uq ON suppliers(branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL;
CREATE UNIQUE INDEX suppliers_branch_code_uq ON suppliers(branch_id, supplier_code);
