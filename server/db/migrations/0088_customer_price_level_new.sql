-- Them level gia "Mới" (new): tinh gia nhu Lon, chi khac ten hien thi.
ALTER TABLE customer_price_level_sources DROP CONSTRAINT IF EXISTS customer_price_level_sources_source_level_check;
ALTER TABLE customer_price_level_sources ADD CONSTRAINT customer_price_level_sources_source_level_check CHECK (source_level IN ('medium','large','vip','new'));
ALTER TABLE customer_price_levels DROP CONSTRAINT IF EXISTS customer_price_levels_level_check;
ALTER TABLE customer_price_levels ADD CONSTRAINT customer_price_levels_level_check CHECK (level IN ('medium','large','vip','new'));
ALTER TABLE customer_price_level_history DROP CONSTRAINT IF EXISTS customer_price_level_history_old_level_check;
ALTER TABLE customer_price_level_history ADD CONSTRAINT customer_price_level_history_old_level_check CHECK (old_level IN ('medium','large','vip','new'));
ALTER TABLE customer_price_level_history DROP CONSTRAINT IF EXISTS customer_price_level_history_new_level_check;
ALTER TABLE customer_price_level_history ADD CONSTRAINT customer_price_level_history_new_level_check CHECK (new_level IN ('medium','large','vip','new'));
