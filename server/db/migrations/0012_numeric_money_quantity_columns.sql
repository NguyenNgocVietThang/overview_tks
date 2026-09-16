-- Du lieu KiotViet that (phat hien khi chay backfill production lan dau,
-- 2026-09-16) co gia tri thap phan cho ca cot "tien" lan "so luong" - vi du
-- gia/tien chiet khau tinh ra le xu (125537.84), so luong hang ban theo can
-- khong phai so nguyen (7.5). Thiet ke ban dau o 0001-0006 gia dinh sai la
-- toan bo la so nguyen (BIGINT/INTEGER) - doi sang NUMERIC (khong gioi han
-- precision/scale) de nhan dung du lieu that, khong lam tron/mat du lieu.

ALTER TABLE products
  ALTER COLUMN base_price TYPE NUMERIC USING base_price::numeric;

ALTER TABLE customers
  ALTER COLUMN debt TYPE NUMERIC USING debt::numeric,
  ALTER COLUMN total_revenue TYPE NUMERIC USING total_revenue::numeric;

ALTER TABLE suppliers
  ALTER COLUMN debt TYPE NUMERIC USING debt::numeric;

ALTER TABLE invoices
  ALTER COLUMN total TYPE NUMERIC USING total::numeric,
  ALTER COLUMN total_payment TYPE NUMERIC USING total_payment::numeric;

ALTER TABLE invoice_details
  ALTER COLUMN quantity TYPE NUMERIC USING quantity::numeric,
  ALTER COLUMN price TYPE NUMERIC USING price::numeric,
  ALTER COLUMN discount TYPE NUMERIC USING discount::numeric;

ALTER TABLE invoice_payments
  ALTER COLUMN amount TYPE NUMERIC USING amount::numeric;

ALTER TABLE orders
  ALTER COLUMN total TYPE NUMERIC USING total::numeric;

ALTER TABLE order_details
  ALTER COLUMN quantity TYPE NUMERIC USING quantity::numeric,
  ALTER COLUMN price TYPE NUMERIC USING price::numeric,
  ALTER COLUMN discount TYPE NUMERIC USING discount::numeric;

ALTER TABLE returns
  ALTER COLUMN total TYPE NUMERIC USING total::numeric;

ALTER TABLE return_details
  ALTER COLUMN quantity TYPE NUMERIC USING quantity::numeric,
  ALTER COLUMN price TYPE NUMERIC USING price::numeric;

ALTER TABLE purchases
  ALTER COLUMN total TYPE NUMERIC USING total::numeric;

ALTER TABLE purchase_details
  ALTER COLUMN quantity TYPE NUMERIC USING quantity::numeric,
  ALTER COLUMN price TYPE NUMERIC USING price::numeric;

ALTER TABLE cash_flows
  ALTER COLUMN amount TYPE NUMERIC USING amount::numeric;
