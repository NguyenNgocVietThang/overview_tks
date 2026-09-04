-- Phat hien khi ra soat src-dashboard/kiotviet/CustomerDebtReport.gs:46-78:
-- bao cao Cong no goi endpoint /cashflow voi isReceipt=true/false de phan
-- biet phieu thu/phieu chi. Khong dong bo bang nay thi tab "Cong no" tren
-- Postgres se sai/thieu.
CREATE TABLE cash_flows (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id             BIGINT NOT NULL REFERENCES branches(id),
  kiotviet_id           BIGINT NULL,
  code                  TEXT NOT NULL,
  trans_date            TIMESTAMPTZ NOT NULL,
  amount                NUMERIC(18,2) NOT NULL,
  is_receipt            BOOLEAN NOT NULL,     -- true = phieu thu, false = phieu chi
  kiotviet_partner_id   BIGINT NULL,
  customer_id           BIGINT NULL REFERENCES customers(id),
  supplier_id           BIGINT NULL REFERENCES suppliers(id),
  partner_name_snapshot TEXT NULL,
  contact_number        TEXT NULL,
  status                SMALLINT NULL,
  description           TEXT NULL,
  source                TEXT NOT NULL DEFAULT 'kiotviet' CHECK (source IN ('kiotviet','manual','import')),
  kiotviet_modified_at  TIMESTAMPTZ NULL,
  kiotviet_synced_at    TIMESTAMPTZ NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cash_flows_branch_kiotviet_uq ON cash_flows(branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL;
CREATE INDEX cash_flows_branch_date_idx ON cash_flows(branch_id, trans_date);
CREATE INDEX cash_flows_branch_customer_idx ON cash_flows(branch_id, customer_id);
