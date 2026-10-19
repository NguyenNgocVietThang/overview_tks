-- Bao cao kinh doanh: doanh so THANG HIEN TAI tinh san (job nen
-- server/kiotvietSync/businessCurrentMonthRefresh.js), web chi doc.
--
-- Hai bang nay phan chieu y het business_monthly_customer_sales va
-- business_monthly_customer_product_sales (0036) nhung la bang TAM cho thang chua chot:
-- khong ghi vao business_monthly_* vi dong trong business_monthly_state nghia la "da chot".
-- Job chay lai dung cau SQL chot (businessMonthlySql.js) nen so tinh san == so live.
-- Sang thang moi, dong thang cu bi xoa khoi day SAU KHI freezeMonth ghi xong.
--
-- business_current_month_state: dung 1 dong (id = 1). `version` chi tang khi du lieu doi
-- (job ghi diff-only), computed_at = lan tinh gan nhat (de repository biet con tuoi),
-- cutoff = thoi diem du lieu hoa don tinh toi, last_full_at = lan quet day du gan nhat,
-- customers_synced_at = moc nhom/khach dung de phat hien doi (neu co).

CREATE TABLE IF NOT EXISTS business_current_month_customer_sales (
  month          DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  branch         TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  customer_code  TEXT NOT NULL,
  customer_id    BIGINT,
  customer_name  TEXT NOT NULL DEFAULT '',
  invoice_amount NUMERIC NOT NULL DEFAULT 0,
  return_amount  NUMERIC NOT NULL DEFAULT 0,
  net_revenue    NUMERIC NOT NULL DEFAULT 0,
  invoice_count  INTEGER NOT NULL DEFAULT 0,
  return_count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (month, branch, customer_code)
);

CREATE TABLE IF NOT EXISTS business_current_month_customer_product_sales (
  month         DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  customer_code TEXT NOT NULL,
  product_code  TEXT NOT NULL,
  product_name  TEXT NOT NULL DEFAULT '',
  net_revenue   NUMERIC NOT NULL DEFAULT 0,
  net_qty       NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (month, branch, customer_code, product_code)
);
-- Panel "top khach cua 1 ma hang" (giong business_monthly_cps_product_idx).
CREATE INDEX IF NOT EXISTS business_current_month_cps_product_idx
  ON business_current_month_customer_product_sales (product_code, month);

CREATE TABLE IF NOT EXISTS business_current_month_state (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  month               DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  cutoff              TIMESTAMPTZ,
  last_full_at        TIMESTAMPTZ,
  customers_synced_at TIMESTAMPTZ,
  version             BIGINT NOT NULL DEFAULT 0
);

-- Khong can GRANT rieng: ALTER DEFAULT PRIVILEGES o 0010.
