-- Extend existing customer profiles without replacing stored information.
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS area TEXT NOT NULL DEFAULT '';

ALTER TABLE customer_profiles DROP CONSTRAINT IF EXISTS customer_profiles_warehouse_scale_check;
ALTER TABLE customer_profiles ADD CONSTRAINT customer_profiles_warehouse_scale_check
  CHECK (warehouse_scale IN ('none', 'small', 'medium', 'large', 'very_large'));

ALTER TABLE customer_profiles DROP CONSTRAINT IF EXISTS customer_profiles_sales_channels_check;
ALTER TABLE customer_profiles ADD CONSTRAINT customer_profiles_sales_channels_check
  CHECK (sales_channels <@ ARRAY['san', 'cua_hang', 'fb_ads', 'fb_live', 'sang_tay', 'kho_buon', 'khac']::text[]);
