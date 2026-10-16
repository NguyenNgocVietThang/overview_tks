-- Trang thai lam moi TANG DAN cua "Bao cao hang hoa" (product_report + product_report_customers), xem
-- docs/superpowers/specs/2026-10-16-realtime-customer-product-reports-design.md muc 3.B.
--
-- Truoc day bang bi TRUNCATE va nap lai 1 lan/dem nen moi dong co cung computed_at. O che do tang dan chi
-- ghi dong THAT SU DOI, nen computed_at tung dong chi con la "lan doi gan nhat"; moc cap nhat chung cua bao
-- cao nam o day:
--   computed_at  : lan kiem tra/lam moi gan nhat (nhan "Du lieu cap nhat luc" tren giao dien).
--   version      : tang 1 chi khi co dong that su doi (product_report hoac product_report_customers). Client
--                  va cache may chu dung de biet khi nao phai tai lai 10,9K dong.
--   last_full_at : lan gan nhat chay PHAN NANG (quet 90 ngay hoa don de tinh khach lon nhat/so khach); NULL =
--                  chua tung => job chay phan nang truoc.
CREATE TABLE IF NOT EXISTS product_report_state (
  id           SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  computed_at  TIMESTAMPTZ NOT NULL,
  version      BIGINT NOT NULL DEFAULT 1,
  last_full_at TIMESTAMPTZ
);

-- Cong kiem tra "co chung tu/khach moi dong bo khong" chi doc duoi index. 0054 cung tao hai index dau
-- (IF NOT EXISTS) de 0055 tu du khi ap rieng; customers nho nhung cung co index cho dong bo.
CREATE INDEX IF NOT EXISTS idx_invoices_synced_at ON invoices (branch, synced_at);
CREATE INDEX IF NOT EXISTS idx_returns_synced_at ON returns (branch, synced_at);
CREATE INDEX IF NOT EXISTS idx_customers_synced_at ON customers (branch, synced_at);
