-- Bao cao kinh doanh (tab Bao cao tong hop > Bao cao kinh doanh): doanh so THEO THANG
-- da CHOT CUNG cua tung khach / khach x ma hang / ma hang / sale. Spec:
-- docs/superpowers/specs/2026-10-07-business-report-design.md.
--
-- Job server/kiotvietSync/businessMonthlyRefresh.js chot thang vua qua luc >= 00:10 VN
-- ngay mung 1 (va backfill tu 2026-03 lan dau). Thang hien tai KHONG nam o day - API
-- tinh truc tiep bang cung cau SQL. month = ngay 1 cua thang (lich VN).
--
-- Doanh so = tong hoa don 'Hoàn thành' (invoices.total, da tru giam gia ca don) - tong
-- phieu tra 'Đã trả' (returns.total) theo thang cua ngay ban/ngay tra. Bang khach x ma
-- hang phan bo tong chung tu cho tung dong theo ty le thanh tien nen tong theo ma = tong
-- theo khach (lech vai dong do lam tron).
--
-- Khach = (branch, customer_code): cung ma o HN va SG la 2 khach KHAC nhau. customer_code
-- '' = Khach le / khong doi chieu duoc. Sale KHONG luu o bang khach: lich su di theo
-- nhom HIEN TAI (customers.raw->>'groups'), bang sale duoc dung lai khi nhom doi.

CREATE TABLE business_monthly_customer_sales (
  month          DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  branch         TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  customer_code  TEXT NOT NULL,
  customer_name  TEXT NOT NULL DEFAULT '',
  invoice_amount NUMERIC NOT NULL DEFAULT 0,
  return_amount  NUMERIC NOT NULL DEFAULT 0,
  net_revenue    NUMERIC NOT NULL DEFAULT 0,
  invoice_count  INTEGER NOT NULL DEFAULT 0,
  return_count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (month, branch, customer_code)
);

CREATE TABLE business_monthly_customer_product_sales (
  month         DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  customer_code TEXT NOT NULL,
  product_code  TEXT NOT NULL,
  product_name  TEXT NOT NULL DEFAULT '',
  net_revenue   NUMERIC NOT NULL DEFAULT 0,
  net_qty       NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (month, branch, customer_code, product_code)
);
-- Panel "top khach cua 1 ma hang".
CREATE INDEX business_monthly_cps_product_idx
  ON business_monthly_customer_product_sales (product_code, month);

CREATE TABLE business_monthly_product_sales (
  month        DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  net_revenue  NUMERIC NOT NULL DEFAULT 0,
  net_qty      NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (month, product_code)
);

CREATE TABLE business_monthly_sale_sales (
  month          DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  sale_name      TEXT NOT NULL,
  net_revenue    NUMERIC NOT NULL DEFAULT 0,
  -- So khach co doanh so <> 0 trong thang (thong tin; "SL Khach" tren UI la so khach
  -- hoat dong = TB 4 thang > 0, tinh luc doc).
  customer_count INTEGER NOT NULL DEFAULT 0,
  refreshed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (month, sale_name)
);

-- 1 dong / thang da chot. Khong co dong = thang chua chot (API tinh truc tiep).
CREATE TABLE business_monthly_state (
  month                 DATE PRIMARY KEY CHECK (EXTRACT(DAY FROM month) = 1),
  frozen_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  customer_rows         INTEGER NOT NULL DEFAULT 0,
  customer_product_rows INTEGER NOT NULL DEFAULT 0,
  net_revenue           NUMERIC NOT NULL DEFAULT 0
);

-- Khong can GRANT rieng: ALTER DEFAULT PRIVILEGES o 0010.
