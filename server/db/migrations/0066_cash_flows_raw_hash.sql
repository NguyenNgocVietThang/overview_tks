-- 0066: dau van tay raw phieu thu/chi de doi soat (reconcilePage) khong phai tai lai ca JSON raw.
-- NULL = chua co hash -> lan quet dau ghi lai mot luot roi on dinh (giong 0044 cho purchases).
ALTER TABLE cash_flows ADD COLUMN IF NOT EXISTS raw_hash TEXT;
