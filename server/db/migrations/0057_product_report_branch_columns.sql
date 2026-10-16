-- Bao cao hang hoa: them so lieu THEO TUNG CO SO cho bang product_report (xem server/kiotvietSync/productReportRefresh.js).
--
--   available_hanoi / available_saigon: "Co ban" tung co so = ton thuc tung co so - so luong dang bi giu trong don dat hang
--     cua khach o trang thai Phieu tam CUA CO SO DO. Cong hai cot nay luon bang available_to_sell da luu (cong thuc giu nguyen);
--     khong kep ve 0 (hang bi giu qua ton hien so am).
--   description_hanoi / description_saigon: truong "Mo ta" cua san pham tren KiotViet cua tung co so
--     (products.raw->>'description'), nhan vien ghi bang gia/ghi chu cho sale tra cuu.
--
-- Cot de NULL (khong DEFAULT) co chu y: NULL = "dong nay chua duoc tinh lai sau migration" nen giao dien hien "—" thay vi
-- gia thanh 0. Job dem (productReportRefresh) tu tinh lai o luot kiem tra 5 phut ke tiep khi con dong NULL; luong tang dan
-- (productReportIncremental) ghi de dong NULL o luot nhe dau tien vi NULL khac gia tri moi.
ALTER TABLE product_report
  ADD COLUMN IF NOT EXISTS available_hanoi    NUMERIC,
  ADD COLUMN IF NOT EXISTS available_saigon   NUMERIC,
  ADD COLUMN IF NOT EXISTS description_hanoi  TEXT,
  ADD COLUMN IF NOT EXISTS description_saigon TEXT;

-- Khong can GRANT rieng: ALTER DEFAULT PRIVILEGES o 0010 da cap SELECT cho reporting_readonly tren bang tao truoc/sau.
