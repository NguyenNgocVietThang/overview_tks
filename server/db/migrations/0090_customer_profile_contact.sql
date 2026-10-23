-- SDT + dia chi o ho so khach (hop Chi tiet), sua tay duoc.
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';
