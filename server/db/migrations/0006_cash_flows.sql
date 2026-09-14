CREATE TABLE cash_flows (
  branch       TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  id           BIGINT NOT NULL,
  code         TEXT,
  is_receipt   BOOLEAN NOT NULL,
  amount       NUMERIC(18,2),
  method       TEXT,
  customer_id  BIGINT,
  supplier_id  BIGINT,
  user_id      BIGINT,
  description  TEXT,
  trans_date   TIMESTAMPTZ,
  created_date TIMESTAMPTZ,
  raw          JSONB NOT NULL,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, id)
);

CREATE INDEX idx_cash_flows_trans_date ON cash_flows (branch, trans_date);
