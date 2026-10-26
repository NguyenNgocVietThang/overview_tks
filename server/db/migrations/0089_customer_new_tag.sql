-- "Khach moi" (nhan dot, vd T10/26, Cu): dung chung version/quyen sua/lich su voi level gia.
ALTER TABLE customer_price_levels ADD COLUMN IF NOT EXISTS new_customer TEXT NOT NULL DEFAULT '';
ALTER TABLE customer_price_level_history ADD COLUMN IF NOT EXISTS old_new_customer TEXT;
ALTER TABLE customer_price_level_history ADD COLUMN IF NOT EXISTS new_new_customer TEXT;
