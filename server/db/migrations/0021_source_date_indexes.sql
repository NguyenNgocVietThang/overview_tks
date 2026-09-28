-- Index theo ngay cho cac bang nguon ma cac job dinh ky chi can doc "N ngay gan
-- nhat": rollup Dashboard (dashboardRollupRefresh.js, luot "nong" 7 ngay chay
-- sau moi luot sync) va bao cao cong no 1/3/7 ngay
-- (customerDebtReportRefresh.js, 5 phut/lan). Truoc day cac bo loc ngay bao boc
-- cot trong `(cot AT TIME ZONE 'UTC')::date` nen khong dung duoc index va phai
-- quet ca bang (invoice_details bi seq scan ~7.100 lan, ~670 trieu dong doc, do
-- 2026-09-28). Code moi so sanh thang cot goc voi moc TIMESTAMPTZ nen dung duoc
-- cac index nay. cash_flows da co idx_cash_flows_trans_date (0006).
--
-- Chi them index, khong doi/xoa du lieu; cac bang deu nho (<=41MB) nen tao index
-- trong 1 giao dich chi khoa ghi trong vai giay.

CREATE INDEX IF NOT EXISTS idx_invoices_purchase_date ON invoices (branch, purchase_date);
CREATE INDEX IF NOT EXISTS idx_purchases_purchase_date ON purchases (branch, purchase_date);
CREATE INDEX IF NOT EXISTS idx_returns_return_date ON returns (branch, return_date);
