-- Current Sheets snapshot only. Replaced atomically with its sync metadata.
CREATE TABLE IF NOT EXISTS product_container_sync (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version uuid,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb
);
INSERT INTO product_container_sync(singleton) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS product_container_lines (
  sheet_name text NOT NULL,
  sheet_order integer NOT NULL,
  container_row integer NOT NULL,
  source_row integer NOT NULL,
  product_code text NOT NULL,
  product_key text NOT NULL,
  container_name text NOT NULL,
  status smallint NOT NULL CHECK (status BETWEEN 1 AND 5),
  status_label text NOT NULL,
  eta text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '',
  sale_note text NOT NULL DEFAULT '',
  ordered_by text NOT NULL DEFAULT '',
  listed_at text NOT NULL DEFAULT '',
  units_per_package numeric,
  package_count numeric,
  quantity numeric NOT NULL CHECK (quantity >= 0),
  vietnam_price numeric,
  PRIMARY KEY (sheet_name, source_row)
);
CREATE INDEX IF NOT EXISTS product_container_lines_product_key_idx ON product_container_lines(product_key, status);

-- 0010 grants default table SELECT to reporting_readonly. These snapshots
-- contain restricted purchaser/price/source-warning fields; API grants only.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_readonly') THEN
    REVOKE ALL ON product_container_lines, product_container_sync FROM reporting_readonly;
  END IF;
END $$;
