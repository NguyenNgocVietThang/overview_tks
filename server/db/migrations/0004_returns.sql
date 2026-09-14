CREATE TABLE returns (
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  id            BIGINT NOT NULL,
  code          TEXT NOT NULL,
  return_date   TIMESTAMPTZ,
  invoice_id    BIGINT,
  customer_id   BIGINT,
  sold_by_id    BIGINT,
  total         NUMERIC(18,2),
  status        SMALLINT,
  created_date  TIMESTAMPTZ,
  modified_date TIMESTAMPTZ,
  raw           JSONB NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, id),
  UNIQUE (branch, code)
);

CREATE TABLE return_details (
  branch     TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  return_id  BIGINT NOT NULL,
  line_no    INT NOT NULL,
  product_id BIGINT,
  quantity   NUMERIC(18,3),
  price      NUMERIC(18,2),
  raw        JSONB NOT NULL,
  PRIMARY KEY (branch, return_id, line_no),
  FOREIGN KEY (branch, return_id) REFERENCES returns (branch, id) ON DELETE CASCADE
);

CREATE INDEX idx_returns_modified ON returns (branch, modified_date);
