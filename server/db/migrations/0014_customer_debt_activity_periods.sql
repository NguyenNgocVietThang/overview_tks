-- Khach hang co phat sinh giao dich trong 1/3/7 ngay gan nhat, thay the cac
-- tab Google Sheets HN1/HN3/HN7. Bang nay chi luu tap ten/ID can cho canh bao
-- "Chua thu" tren Dashboard; du lieu nguon van la cac bang KiotViet trong DB.
CREATE TABLE customer_debt_activity_periods (
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  period_days   SMALLINT NOT NULL CHECK (period_days IN (1, 3, 7)),
  customer_id   BIGINT NOT NULL,
  customer_name TEXT NOT NULL,
  refreshed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, period_days, customer_id)
);

CREATE INDEX idx_customer_debt_activity_periods_lookup
  ON customer_debt_activity_periods (branch, period_days, customer_name);
