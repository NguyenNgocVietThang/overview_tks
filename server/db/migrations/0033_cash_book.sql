ALTER TABLE cash_flows ADD COLUMN account_id BIGINT;
ALTER TABLE cash_flows ADD COLUMN status INT;

-- Tiến theo khóa ghép kể cả khi phiếu tiền mặt không có accountId.
-- Mỗi dòng chỉ được xét một lần; chỉ cập nhật dòng chưa có tài khoản.
DO $$
DECLARE
  last_branch TEXT;
  last_id BIGINT;
  next_branch TEXT;
  next_id BIGINT;
BEGIN
  LOOP
    SELECT branch, id INTO next_branch, next_id
    FROM (
      SELECT branch, id FROM cash_flows
      WHERE last_branch IS NULL OR (branch, id) > (last_branch, last_id)
      ORDER BY branch, id LIMIT 20000
    ) batch ORDER BY branch DESC, id DESC LIMIT 1;
    EXIT WHEN NOT FOUND;
    UPDATE cash_flows
    SET account_id = NULLIF(COALESCE(raw->>'AccountId',raw->>'accountId'),'')::bigint,
        status = NULLIF(COALESCE(raw->>'Status',raw->>'status'),'')::int
    WHERE account_id IS NULL
      AND (last_branch IS NULL OR (branch, id) > (last_branch, last_id))
      AND (branch, id) <= (next_branch, next_id);
    last_branch := next_branch;
    last_id := next_id;
  END LOOP;
END $$;
CREATE INDEX idx_cash_flows_account_date ON cash_flows (account_id, trans_date);
CREATE TABLE cash_book_accounts (
 id BIGINT PRIMARY KEY,
 bank_name TEXT,
 account_no TEXT,
 description TEXT,
 raw JSONB NOT NULL,
 synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE cash_book_checkpoints (
 id BIGSERIAL PRIMARY KEY,
 account_id BIGINT,
 checkpoint_at TIMESTAMPTZ NOT NULL,
 balance NUMERIC NOT NULL,
 system_balance NUMERIC,
 diff NUMERIC,
 note TEXT,
 created_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Không đặt FK: tiền mặt và ID lịch sử thiếu trong danh mục vẫn hợp lệ.
CREATE INDEX idx_cash_book_checkpoints_account ON cash_book_checkpoints (account_id, checkpoint_at DESC);
