-- Bao cao hang hoa (tab "Tong quan") - tinh san 1 lan/dem boi
-- server/kiotvietSync/productReportRefresh.js, doc thang tu day thay vi quet
-- lai invoice_details/order_details/products moi request (xem ke hoach da
-- duyet "mutable-summit").
--
-- Nhu 4 bang rollup o 0013_dashboard_rollups.sql, day la bang TONG HOP (khong
-- phai ban sao 1-1 tu KiotViet) nen khong theo quy uoc PK bat dau bang
-- `branch` va khong co cot `raw`. Khoa chinh la ma hang (product_code) vi bang
-- gom du lieu CA HAI co so tren 1 dong/ma hang.
--
-- Dinh nghia cot (xem chi tiet cong thuc trong productReportRefresh.js):
--   stock_hanoi/stock_saigon: ton hien tai tung co so (SUM onHand tu
--     products.raw->'inventories', giong PRODUCTS_QUERY cua stockoutPgSource.js).
--   available_to_sell: (stock_hanoi + stock_saigon) - so luong dang bi giu
--     cho trong DON DAT HANG CUA KHACH (bang orders, KHONG PHAI purchases)
--     dang o trang thai chua hoan tat (Phieu tam/Dang xu ly/Da xac nhan,
--     dung PENDING_ORDER_STATUSES cua dashboardData.js).
--   qty_sold_30d/revenue_90d: cong tu daily_product_sales (bang rollup co san)
--     trong 30/90 ngay ket thuc HOM QUA (khong tinh hom nay).
--   customer_count_90d/top_customer_*: tinh truc tiep tu invoice_details/
--     invoices/customers trong 90 ngay, dung chung dinh nghia "hoa don hop le"
--     (statusValue != 'Da huy') voi revenue_90d de top_customer_share (I/G)
--     luon <= 100%.
CREATE TABLE product_report (
  product_code             TEXT NOT NULL PRIMARY KEY,
  product_name             TEXT NOT NULL,
  stock_hanoi              NUMERIC NOT NULL DEFAULT 0,
  stock_saigon             NUMERIC NOT NULL DEFAULT 0,
  available_to_sell        NUMERIC NOT NULL DEFAULT 0,
  qty_sold_30d             NUMERIC NOT NULL DEFAULT 0,
  revenue_90d              NUMERIC NOT NULL DEFAULT 0,
  customer_count_90d       INT NOT NULL DEFAULT 0,
  top_customer_revenue_90d NUMERIC NOT NULL DEFAULT 0,
  top_customer_name        TEXT,
  top_customer_share       NUMERIC,
  computed_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Khong can GRANT rieng: ALTER DEFAULT PRIVILEGES o 0010 da tu cap SELECT cho
-- reporting_readonly cho moi bang tao sau no; du lieu chi la so tong hop.
