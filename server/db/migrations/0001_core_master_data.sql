CREATE TABLE categories (
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  id            BIGINT NOT NULL,
  parent_id     BIGINT,
  name          TEXT NOT NULL,
  rank          INT,
  modified_date TIMESTAMPTZ,
  raw           JSONB NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, id)
);

CREATE TABLE products (
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  id            BIGINT NOT NULL,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  category_id   BIGINT,
  base_price    BIGINT,
  unit          TEXT,
  is_active     BOOLEAN,
  created_date  TIMESTAMPTZ,
  modified_date TIMESTAMPTZ,
  raw           JSONB NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, id),
  UNIQUE (branch, code)
);

CREATE TABLE customers (
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  id            BIGINT NOT NULL,
  code          TEXT,
  name          TEXT,
  phone         TEXT,
  group_id      BIGINT,
  debt          BIGINT,
  total_revenue BIGINT,
  created_date  TIMESTAMPTZ,
  modified_date TIMESTAMPTZ,
  raw           JSONB NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, id)
);

CREATE TABLE suppliers (
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  id            BIGINT NOT NULL,
  code          TEXT,
  name          TEXT,
  phone         TEXT,
  group_id      BIGINT,
  debt          BIGINT,
  created_date  TIMESTAMPTZ,
  modified_date TIMESTAMPTZ,
  raw           JSONB NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, id)
);

-- Khong co endpoint rieng; Giai doan 2 suy luan staff tu SoldById/CreatedById.
CREATE TABLE staff (
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  id            BIGINT NOT NULL,
  name          TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, id)
);

CREATE TABLE sync_checkpoints (
  branch          TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  entity          TEXT NOT NULL,
  last_synced_at  TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  note            TEXT,
  PRIMARY KEY (branch, entity)
);
