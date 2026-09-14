-- Endpoint KiotViet that: /purchaseorders (khong phai /purchases) - xem API_ENDPOINTS.md.
CREATE TABLE purchases (
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  id            BIGINT NOT NULL,
  code          TEXT NOT NULL,
  purchase_date TIMESTAMPTZ,
  supplier_id   BIGINT,
  total         NUMERIC(18,2),
  status        SMALLINT,
  created_date  TIMESTAMPTZ,
  modified_date TIMESTAMPTZ,
  raw           JSONB NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, id),
  UNIQUE (branch, code)
);

CREATE TABLE purchase_details (
  branch      TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  purchase_id BIGINT NOT NULL,
  line_no     INT NOT NULL,
  product_id  BIGINT,
  quantity    NUMERIC(18,3),
  price       NUMERIC(18,2),
  raw         JSONB NOT NULL,
  PRIMARY KEY (branch, purchase_id, line_no),
  FOREIGN KEY (branch, purchase_id) REFERENCES purchases (branch, id) ON DELETE CASCADE
);

CREATE INDEX idx_purchases_modified ON purchases (branch, modified_date);
