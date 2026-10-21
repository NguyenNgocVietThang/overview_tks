-- Bang "Du kien hang ve": them 3 cot Ngay len, Don gia (CNY) va Gia VN (2026-10-21).
-- Lay nguyen tu product_container_lines (listed_at 0053, unit_price_cny 0072, vietnam_price 0053) boi
-- server/productContainers/expectedRefresh.js; web chi DOC. Cot moi nam trong bo so sanh IS DISTINCT FROM
-- cua job nen lan tinh dau sau migrate se ghi lai cac dong co gia tri; nguon khong doi thi 0 dong ghi.
-- Chi them cot, khong doi/xoa du lieu cu. Code doc van chay (gia null) khi chua ap migration.

ALTER TABLE product_container_expected
  ADD COLUMN IF NOT EXISTS listed_at text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS unit_price_cny numeric,
  ADD COLUMN IF NOT EXISTS vietnam_price numeric;
