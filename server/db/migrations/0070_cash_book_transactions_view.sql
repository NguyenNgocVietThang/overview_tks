-- 0070: view v_cash_book_transactions cho tab So quy (/cashbook/).
-- Gom vao mot cho: (1) khoa quy fund_key (Cash / unassigned / account_id),
-- (2) so TK + chu TK + mo ta tu cash_book_accounts, (3) cac truong rut san tu
-- cash_flows.raw (PascalCase truoc, camelCase sau - dung thu tu COALESCE cua code cu).
-- KHONG lo cot raw: trang du lieu khong con keo ca JSON raw moi phieu (giam egress).
-- La view thuong, khong ghi gi vao bang, khong tao index/generated column tren cash_flows.
-- Code doc fail-soft: thieu view (42P01) thi cashbookRepository tu lui ve cung noi dung
-- duoi dang subquery (xem CASH_BOOK_TRANSACTIONS_SELECT trong cashbookRepository.js;
-- test cashBookViewMigration.test.js doi chieu hai ban phai giong het).
CREATE OR REPLACE VIEW v_cash_book_transactions AS
SELECT
  c.branch,
  c.id,
  c.code,
  c.trans_date,
  c.is_receipt,
  c.amount,
  c.method,
  c.status,
  c.account_id,
  c.user_id,
  c.description,
  c.source_missing_at,
  CASE WHEN c.method='Cash' THEN 'cash'
    WHEN c.account_id IS NULL THEN 'unassigned' ELSE c.account_id::text END AS fund_key,
  a.account_no,
  a.bank_name AS account_name,
  a.description AS account_desc,
  COALESCE(c.raw->>'CashFlowGroupId',c.raw->>'cashFlowGroupId') AS cash_group_id,
  COALESCE(c.raw->>'CashGroup',c.raw->>'cashGroup') AS cash_group_name,
  COALESCE(c.raw->>'PartnerId',c.raw->>'partnerId') AS partner_id,
  COALESCE(c.raw->>'PartnerName',c.raw->>'partnerName') AS partner_name,
  COALESCE(c.raw->>'ContactNumber',c.raw->>'contactNumber') AS partner_phone,
  COALESCE(c.raw->>'CreatedBy',c.raw->>'createdBy') AS created_by,
  COALESCE(c.raw->>'User',c.raw->>'user') AS user_name,
  COALESCE(c.raw->>'UserId',c.raw->>'userId') AS raw_user_id,
  COALESCE(c.raw->>'UsedForFinancialReporting',c.raw->>'usedForFinancialReporting') AS used_for_financial_reporting
FROM cash_flows c
LEFT JOIN cash_book_accounts a ON a.id=c.account_id;

-- Role chi-doc chi duoc cap SELECT tren bang co liet ke (xem 0010); chi cap neu role ton tai.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_readonly') THEN
    GRANT SELECT ON v_cash_book_transactions TO reporting_readonly;
  END IF;
END $$;
