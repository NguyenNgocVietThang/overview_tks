CREATE TABLE products (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id            BIGINT NOT NULL REFERENCES branches(id),
  kiotviet_id          BIGINT NULL,
  category_id          BIGINT NULL REFERENCES categories(id),
  kiotviet_category_id BIGINT NULL,
  product_code         TEXT NOT NULL,
  name                 TEXT NOT NULL,
  product_type         TEXT NULL,                  -- 'hang_hoa' | 'combo' | 'dich_vu'
  base_price           NUMERIC(18,2) NULL,
  allows_sale          BOOLEAN NOT NULL DEFAULT true,
  is_active            BOOLEAN NOT NULL DEFAULT true,
  unit                 TEXT NULL,
  conversion_value     NUMERIC(18,4) NULL,
  has_variants         BOOLEAN NOT NULL DEFAULT false,
  description          TEXT NULL,
  shelf_location       TEXT NULL,
  source               TEXT NOT NULL DEFAULT 'kiotviet' CHECK (source IN ('kiotviet','manual','import')),
  kiotviet_modified_at TIMESTAMPTZ NULL,
  kiotviet_synced_at   TIMESTAMPTZ NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX products_branch_kiotviet_uq ON products(branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL;
CREATE UNIQUE INDEX products_branch_code_uq ON products(branch_id, product_code);
CREATE INDEX products_category_idx ON products(category_id);

-- Bang con rieng -- KiotViet tra Inventories[] theo TUNG branch noi bo, khong
-- phai 1 so duy nhat. Mac dinh kiotviet_branch_id=0 khi KiotViet khong tach
-- theo branch noi bo, de unique constraint luon co conflict target ro rang
-- (tranh lo hong NULL-uniqueness).
CREATE TABLE product_inventory (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kiotviet_branch_id  BIGINT NOT NULL DEFAULT 0,
  kiotviet_branch_name TEXT NULL,
  on_hand             NUMERIC(18,3) NULL,
  reserved            NUMERIC(18,3) NULL,
  cost                NUMERIC(18,2) NULL,
  min_quantity        NUMERIC(18,3) NULL,
  max_quantity        NUMERIC(18,3) NULL,
  kiotviet_synced_at  TIMESTAMPTZ NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_inventory_uq ON product_inventory(product_id, kiotviet_branch_id);

-- Append-only, phuc vu bieu do xu huong ton kho. Ghi 1 dong/ngay, tan dung
-- luot poll products hang ngay, khong can lich rieng.
CREATE TABLE inventory_daily_snapshot (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id         BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kiotviet_branch_id BIGINT NOT NULL DEFAULT 0,
  snapshot_date      DATE NOT NULL,
  on_hand            NUMERIC(18,3) NULL,
  reserved           NUMERIC(18,3) NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX inventory_snapshot_uq ON inventory_daily_snapshot(product_id, kiotviet_branch_id, snapshot_date);
