-- So phat cong no theo ngay (2026-10-14), mo rong cong no theo lich TT (0047/0048).
--
-- Ban chot cong no (debt_cycle_*) chi giu 7 ngay va phan hoi/trang thai bi don, nen khong the
-- tinh lai tien phat ca thang tu du lieu cu. Bang xep hang phat sale (tab Cong no) doc so nay.
--
-- * debt_penalty_daily: tien phat DA CHOT cua tung khach theo tung chu ky (cycle_date), giu
--   vinh vien. Chi ghi dong amount > 0. Ten sale + thong tin khach duoc dong bang tai luc chot
--   so (nhom khach KiotViet co the doi sau do).
-- * debt_penalty_cycles: danh dau chu ky da chot so phat. Chu ky DANG MO (ban chot moi nhat)
--   van sua duoc phat / trang thai nen chi chot so khi da co ban chot ke tiep.

CREATE TABLE debt_penalty_daily (
  cycle_date      DATE NOT NULL,
  branch          TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  customer_id     BIGINT NOT NULL,
  sale            TEXT NOT NULL DEFAULT '',
  customer_code   TEXT NOT NULL DEFAULT '',
  customer_name   TEXT NOT NULL DEFAULT '',
  overdue_debt    NUMERIC NOT NULL DEFAULT 0,
  overdue_streak  INTEGER NOT NULL DEFAULT 0,
  amount          NUMERIC NOT NULL CHECK (amount > 0),
  is_manual       BOOLEAN NOT NULL DEFAULT false,
  status          TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (cycle_date, branch, customer_id)
);

CREATE INDEX debt_penalty_daily_sale_idx ON debt_penalty_daily (cycle_date, sale);

CREATE TABLE debt_penalty_cycles (
  cycle_date    DATE PRIMARY KEY,
  finalized_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chua ten khach nhu phan hoi / tien phat: khong cap cho reporting_readonly.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='reporting_readonly') THEN
  REVOKE SELECT ON debt_penalty_daily, debt_penalty_cycles FROM reporting_readonly;
 END IF;
END $$;
