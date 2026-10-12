-- 0044: dau van tay raw phieu nhap de doi soat khong phai tai lai ca JSON raw.
-- NULL = chua co hash -> lan quet dau ghi lai mot luot roi on dinh.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS raw_hash TEXT;
