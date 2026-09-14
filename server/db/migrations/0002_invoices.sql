CREATE TABLE invoices (
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  id            BIGINT NOT NULL,
  code          TEXT NOT NULL,
  purchase_date TIMESTAMPTZ,
  customer_id   BIGINT,
  sold_by_id    BIGINT,
  total         BIGINT,
  total_payment BIGINT,
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
  quantity   INTEGER,
  price      BIGINT,
  discount   BIGINT,
  raw        JSONB NOT NULL,
  PRIMARY KEY (branch, invoice_id, line_no),
  FOREIGN KEY (branch, invoice_id) REFERENCES invoices (branch, id) ON DELETE CASCADE
);

CREATE TABLE invoice_payments (
  branch     TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  invoice_id BIGINT NOT NULL,
  line_no    INT NOT NULL,
  method     TEXT,
  amount     BIGINT,
  trans_date TIMESTAMPTZ,
  raw        JSONB NOT NULL,
  PRIMARY KEY (branch, invoice_id, line_no),
  FOREIGN KEY (branch, invoice_id) REFERENCES invoices (branch, id) ON DELETE CASCADE
);

CREATE INDEX idx_invoices_modified ON invoices (branch, modified_date);
