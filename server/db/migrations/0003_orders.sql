CREATE TABLE orders (
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  id            BIGINT NOT NULL,
  code          TEXT NOT NULL,
  order_date    TIMESTAMPTZ,
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

CREATE TABLE order_details (
  branch     TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  order_id   BIGINT NOT NULL,
  line_no    INT NOT NULL,
  product_id BIGINT,
  quantity   NUMERIC(18,3),
  price      NUMERIC(18,2),
  discount   NUMERIC(18,2),
  raw        JSONB NOT NULL,
  PRIMARY KEY (branch, order_id, line_no),
  FOREIGN KEY (branch, order_id) REFERENCES orders (branch, id) ON DELETE CASCADE
);

CREATE INDEX idx_orders_modified ON orders (branch, modified_date);
