CREATE TABLE invoices (
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  id            BIGINT NOT NULL,
  code          TEXT NOT NULL,
  purchase_date TIMESTAMPTZ,
  customer_id   BIGINT,
  sold_by_id    BIGINT,
  total         NUMERIC(18,2),
  total_payment NUMERIC(18,2),
  status        SMALLINT,
  created_date  TIMESTAMPTZ,
  modified_date TIMESTAMPTZ,
  raw           JSONB NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, id),
  UNIQUE (branch, code)
);

CREATE TABLE invoice_details (
  branch     TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  invoice_id BIGINT NOT NULL,
  line_no    INT NOT NULL,
  product_id BIGINT,
  quantity   NUMERIC(18,3),
  price      NUMERIC(18,2),
  discount   NUMERIC(18,2),
  raw        JSONB NOT NULL,
  PRIMARY KEY (branch, invoice_id, line_no),
  FOREIGN KEY (branch, invoice_id) REFERENCES invoices (branch, id) ON DELETE CASCADE
);

CREATE TABLE invoice_payments (
  branch     TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  invoice_id BIGINT NOT NULL,
  line_no    INT NOT NULL,
  method     TEXT,
  amount     NUMERIC(18,2),
  trans_date TIMESTAMPTZ,
  raw        JSONB NOT NULL,
  PRIMARY KEY (branch, invoice_id, line_no),
  FOREIGN KEY (branch, invoice_id) REFERENCES invoices (branch, id) ON DELETE CASCADE
);

CREATE INDEX idx_invoices_modified ON invoices (branch, modified_date);
