-- Bao cao hang hoa: them "Don gia" theo tung co so cho bang product_report
-- (server/kiotvietSync/productReportRefresh.js, productReportIncremental.js).
--
--   price_hanoi / price_saigon: gia ban chung (products.base_price) cua ma hang o tung co so tren KiotViet.
--     price_hanoi luon co so (cot ma hang lay theo Ha Noi, thieu gia coi nhu 0); price_saigon NULL khi Sai Gon
--     khong co ma nay -> giao dien hien "—" thay vi gia thanh 0.
--
-- Cot de NULL (khong DEFAULT): dong chua duoc tinh lai sau migration thi hien "—". Job dem tu tinh lai o luot kiem tra
-- 5 phut ke tiep khi con dong price_hanoi NULL; luong tang dan ghi de o luot nhe dau tien vi NULL khac gia tri moi.
-- Chi API tra cac cot nay cho tai khoan co quyen reports.products.price (Quan ly, Tro ly).
ALTER TABLE product_report
  ADD COLUMN IF NOT EXISTS price_hanoi  NUMERIC,
  ADD COLUMN IF NOT EXISTS price_saigon NUMERIC;
