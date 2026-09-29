-- Doanh so 90 ngay cua TUNG KHACH theo TUNG MA HANG - nguon cho khung "Chi tiet"
-- duoi bang "Bao cao hang hoa" (tab Tong quan). Do chinh
-- server/kiotvietSync/productReportRefresh.js dung lai 1 LAN/DEM trong cung 1
-- transaction voi product_report: day la cung CTE customer_agg da dung de tinh
-- customer_count_90d / top_customer_* nen khach #1 o day luon khop cot "Khach lon
-- nhat" va so dong = "SL khach ban".
--
-- Bang TONG HOP (khong phai ban sao 1-1 tu KiotViet) nen khong co cot `branch`
-- (gom ca 2 co so, giong product_report) va khong co cot `raw`.
--   product_key: lower(btrim(ma hang)) - cung cach chuan hoa voi product_report.
--   customer_key: 'code:<ma khach>' hoac 'name:<ten khach>' (khach khong co ma).
CREATE TABLE product_report_customers (
  product_key   TEXT NOT NULL,
  customer_key  TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  revenue       NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (product_key, customer_key)
);

-- Khong can GRANT rieng: ALTER DEFAULT PRIVILEGES o 0010 da tu cap SELECT cho
-- reporting_readonly cho moi bang tao sau no.
