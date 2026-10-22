-- ORDER VAT: thong bao chuong cho sale sau khi KT sua yeu cau (2026-10-22).
-- Job server/vatRequests/saleNotifier.js doc vat_request_history (0076) — moi lan sua da ghi o day —
-- gom theo sale (vat_requests.created_by), sale nao KT ngung sua du 10 phut thi gui 1 thong bao.
-- Bang nay chi giu CON TRO: id dong lich su cuoi cung da xet cho tung sale. Dong moc sale_id = '*'
-- = max(id) luc ap migration: lan chay dau khong bao lai cac lan sua cu.
-- Chi them bang moi, khong doi / xoa du lieu cu. Chua ap thi job ghi log va bo qua.

CREATE TABLE IF NOT EXISTS vat_request_notice_state (
  sale_id          TEXT PRIMARY KEY,
  last_history_id  BIGINT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO vat_request_notice_state (sale_id, last_history_id)
SELECT '*', COALESCE(max(id), 0) FROM vat_request_history
ON CONFLICT (sale_id) DO NOTHING;

-- 0010 cap SELECT mac dinh cho reporting_readonly; bang noi bo cua job.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_readonly') THEN
    REVOKE ALL ON vat_request_notice_state FROM reporting_readonly;
  END IF;
END $$;
