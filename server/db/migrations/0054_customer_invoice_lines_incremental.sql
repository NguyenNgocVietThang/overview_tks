-- Che do lam moi TANG DAN cho bang customer_invoice_lines_90d (xem
-- docs/superpowers/specs/2026-10-16-realtime-customer-product-reports-design.md muc 3.A).
--
-- computed_at tu nay la LAN KIEM TRA gan nhat (cap nhat moi luot sync fast, dung cho nhan "cap nhat luc"
-- tren giao dien), nen can mot moc rieng cho lan dung lai DAY DU gan nhat de lich dem (chot doi soat
-- sau 00:10 VN) biet da chay chua. NULL = chua tung dung lai day du o che do tang dan => job se dung lai
-- day du truoc khi tang dan. Khong backfill: bang cu ket thuc HOM QUA, luot day du dau tien se mo rong
-- cua so den hom nay.
ALTER TABLE customer_invoice_lines_state
  ADD COLUMN IF NOT EXISTS last_full_at TIMESTAMPTZ;

-- Phat hien chung tu moi/vua sua cho luot tang dan: dung synced_at (DB gan now() moi lan upsert, ke ca
-- chung tu moi) thay cho modified_date vi ~91% hoa don co modified_date NULL (do 2026-10-16: 43.074/47.141).
-- Moi lan chi doc phan duoi cua index (vai tram dong), khong quet bang.
CREATE INDEX IF NOT EXISTS idx_invoices_synced_at ON invoices (branch, synced_at);
CREATE INDEX IF NOT EXISTS idx_returns_synced_at ON returns (branch, synced_at);
