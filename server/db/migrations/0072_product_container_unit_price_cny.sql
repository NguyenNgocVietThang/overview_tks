-- Hang du kien: them cot "Gia SP (te) 单价" (cot P cua sheet CONT) vao dong CONT. Cot moi nam CUOI bang de
-- INSERT ... SELECT n.* / CREATE TEMP TABLE (LIKE ...) trong productContainers/sync.js van khop thu tu cot.
-- Sau khi ap migration, lan dong bo ke tiep se ghi lai cac dong (version doi 1 lan) de dien cot nay.
ALTER TABLE product_container_lines ADD COLUMN IF NOT EXISTS unit_price_cny numeric;
