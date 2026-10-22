-- ORDER VAT: them trang thai '5' = "VAT san nhieu" (2026-10-22).
-- Truoc day KT danh "0. Khong khai duoc" kem note "san / ton nhieu / con" cho ma con nhieu hang VAT;
-- nay tach thanh trang thai rieng. Khoa sale nhu 0 (luat o server/vatRequests/service.js).
-- Chuyen 1 lan cac dong 0 co note KHOP NGUYEN (bo khoang trang 2 dau, khong phan biet hoa thuong) 1 trong:
-- "sẵn", "sẵn nhiều", "tồn nhiều", "còn", "còn tồn nhiều" — khong tim tu trong cau de khoi khop nham
-- (vd "còn chờ"). Moi dong ghi 1 dong lich su changed_by NULL ("He thong")
-- — saleNotifier.js bo qua dong changed_by NULL nen khong bao hang loat cho sale.
-- Idempotent: chay lai khong con dong 0 nao khop (da sang 5), constraint dung ten co dinh.

ALTER TABLE vat_requests DROP CONSTRAINT IF EXISTS vat_requests_status_check;
ALTER TABLE vat_requests ADD CONSTRAINT vat_requests_status_check
  CHECK (status IN ('pending','0','1','2','3','4','5'));

WITH moved AS (
  UPDATE vat_requests
  SET status = '5', version = version + 1, updated_at = now()
  WHERE status = '0' AND NOT is_deleted
    AND accountant_note ~* '^\s*(sẵn|sẵn nhiều|tồn nhiều|còn|còn tồn nhiều)\s*$'
  RETURNING id
)
INSERT INTO vat_request_history (request_id, changed_by, changed_by_name, action, field, old_value, new_value)
SELECT id, NULL, 'Hệ thống', 'update', 'status', '0', '5' FROM moved;
