-- ORDER VAT: thu tu uu tien chung do KT keo dong (2026-10-22).
-- Danh sach xep ORDER BY sort_rank DESC, id DESC. Dong moi mac dinh = mili-giay hien tai nen tu len dau;
-- keo dong chi doi sort_rank cua 1 dong (trung diem 2 dong ke, NUMERIC khong gioi han do chinh xac)
-- trong server/vatRequests/repository.js moveRequest. Khong doi version, khong ghi lich su.
-- Backfill giu nguyen thu tu cu (created_at DESC NULLS LAST, id DESC): dong import thieu thoi gian = 0.
-- Chi them cot, khong doi/xoa du lieu cu. Code van chay (xep theo created_at) khi chua ap migration.

ALTER TABLE vat_requests ADD COLUMN IF NOT EXISTS sort_rank NUMERIC;

UPDATE vat_requests
   SET sort_rank = COALESCE(extract(epoch FROM created_at)::numeric * 1000, 0) + id * 0.000000001
 WHERE sort_rank IS NULL;

ALTER TABLE vat_requests ALTER COLUMN sort_rank SET DEFAULT (extract(epoch FROM clock_timestamp())::numeric * 1000);
ALTER TABLE vat_requests ALTER COLUMN sort_rank SET NOT NULL;

CREATE INDEX IF NOT EXISTS vat_requests_sort_rank_idx ON vat_requests(sort_rank DESC, id DESC) WHERE NOT is_deleted;
