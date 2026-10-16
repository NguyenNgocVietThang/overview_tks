-- Tien phat no cham + so phien lien tiep (2026-10-13), mo rong cong no theo lich TT (0047).
--
-- * debt_cycle_customers.overdue_debt / overdue_streak: no qua han va SO PHIEN LIEN TIEP cua
--   khach tai ban chot 15:00 (qua han >= 400k -> phien truoc + 1, nguoc lai 0; trang thai
--   "Da xu ly" o chu ky truoc giu nguyen so phien). Ban chot sau doc lai de cong don.
-- * debt_cycle_penalties: tien phat Quan ly tu dien cho chu ky ("Tien phat phien nay"). Khac
--   phan hoi/trang thai, KHONG bi don sau 7 ngay vi la khoan tien. Khach chua co dong thi
--   man hinh hien muc phat goi y theo quy che.
-- * Bo trang thai "Dang xu ly" khoi cot Xu ly: du lieu cu chuyen ve "Chua xu ly".

ALTER TABLE debt_cycle_customers
  ADD COLUMN overdue_debt   NUMERIC,
  ADD COLUMN overdue_streak INTEGER NOT NULL DEFAULT 0;

CREATE TABLE debt_cycle_penalties (
  cycle_date          DATE NOT NULL,   -- khong FK toi debt_cycle_runs: job chot don run cu hon 7 ngay
  branch              TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  customer_id         BIGINT NOT NULL,
  amount             NUMERIC NOT NULL CHECK (amount >= 0),
  updated_by_user_id  TEXT,
  updated_by_name     TEXT NOT NULL DEFAULT '',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cycle_date, branch, customer_id)
);

-- Lich su sua tren giao dien them cot 'penalty'.
ALTER TABLE debt_feedback_history DROP CONSTRAINT IF EXISTS debt_feedback_history_field_check;
ALTER TABLE debt_feedback_history ADD CONSTRAINT debt_feedback_history_field_check
  CHECK (field IN ('sale', 'manager', 'status', 'schedule', 'penalty'));

-- Bo "Dang xu ly".
UPDATE debt_cycle_feedback SET status = 'Chưa xử lý' WHERE status = 'Đang xử lý';
ALTER TABLE debt_cycle_feedback DROP CONSTRAINT IF EXISTS debt_cycle_feedback_status_check;
ALTER TABLE debt_cycle_feedback ADD CONSTRAINT debt_cycle_feedback_status_check
  CHECK (status IN ('Chưa xử lý', 'Đã xử lý', 'Bỏ qua'));

-- Tien phat chua ten nguoi dung nhu phan hoi: khong cap cho reporting_readonly.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='reporting_readonly') THEN
  REVOKE SELECT ON debt_cycle_penalties FROM reporting_readonly;
 END IF;
END $$;
