-- Bang gia duyet (0091): tach "Gia duyet" thanh 2 gia tuy chon (2026-10-24): gia KHONG VAT va gia CO VAT, de trong 1 trong 2.
-- Hoa don Full VAT dung gia co VAT, hoa don khong Full VAT dung gia khong VAT; loai gia de trong thi KHONG ap gia duyet cho loai hoa don do.
-- Ban ghi cu (neu co): gia duyet cu ap cho moi hoa don -> giu nguyen hanh vi bang cach dien CA HAI cot bang gia cu.
-- Them cot truoc, doi du lieu, roi moi bo cot cu; chay lai an toan (IF NOT EXISTS / IF EXISTS).

ALTER TABLE invoice_approved_prices ADD COLUMN IF NOT EXISTS price_no_vat   NUMERIC;
ALTER TABLE invoice_approved_prices ADD COLUMN IF NOT EXISTS price_with_vat NUMERIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'invoice_approved_prices' AND column_name = 'approved_price') THEN
    UPDATE invoice_approved_prices
       SET price_no_vat = approved_price, price_with_vat = approved_price
     WHERE price_no_vat IS NULL AND price_with_vat IS NULL;
    ALTER TABLE invoice_approved_prices DROP COLUMN approved_price;
  END IF;
END $$;

ALTER TABLE invoice_approved_prices DROP CONSTRAINT IF EXISTS invoice_approved_prices_price_check;
ALTER TABLE invoice_approved_prices ADD CONSTRAINT invoice_approved_prices_price_check CHECK (
  (price_no_vat IS NOT NULL OR price_with_vat IS NOT NULL)
  AND (price_no_vat IS NULL OR price_no_vat > 0)
  AND (price_with_vat IS NULL OR price_with_vat > 0));
