-- Bao cao hang hoa: them cac cot theo sheet "BC CHUNG" (server/kiotvietSync/productReportRefresh.js,
-- productReportIncremental.js, dashboard/stockoutCheck/stockoutDaysStore.js).
--
--   qty_sold_30d_hanoi / qty_sold_30d_saigon: so luong ban 30 ngay (rollup daily_product_sales) cua tung co so;
--     cong lai bang qty_sold_30d.
--   orders_30d / orders_90d: so don (hoa don khong huy, ca hai co so) co chua ma hang trong 30 / 90 ngay.
--
-- Cac cot tren de NULL (khong DEFAULT): dong chua duoc tinh lai sau migration thi giao dien hien "—". Luot nhe dau
-- tien cua job tang dan tinh lai SL 30 theo co so; orders_* chi duoc tinh o luot nang nen job se tu chay luot nang
-- khi con dong orders_90d NULL.
ALTER TABLE product_report
  ADD COLUMN IF NOT EXISTS qty_sold_30d_hanoi  NUMERIC,
  ADD COLUMN IF NOT EXISTS qty_sold_30d_saigon NUMERIC,
  ADD COLUMN IF NOT EXISTS orders_30d          NUMERIC,
  ADD COLUMN IF NOT EXISTS orders_90d          NUMERIC;

-- "Dut HN / Dut SG" = tong so ngay dut hang trong 30 ngay gan nhat (totalStockoutDays cua luot quet "Dut hang 30 ngay").
-- Luu bang rieng (khong phai cot product_report) vi job dem cu TRUNCATE product_report con ket qua quet thi khong duoc mat.
-- Mac dinh 0; chi cot cua co so vua quet moi bi ghi de (xem stockoutDaysStore.js).
CREATE TABLE IF NOT EXISTS product_stockout_days (
  product_key        TEXT PRIMARY KEY,                -- lower(btrim(ma hang))
  product_code       TEXT NOT NULL,
  days_hanoi         INTEGER NOT NULL DEFAULT 0,
  days_saigon        INTEGER NOT NULL DEFAULT 0,
  hanoi_scanned_at   TIMESTAMPTZ,
  saigon_scanned_at  TIMESTAMPTZ
);
