-- Bao cao cong no theo LICH THANH TOAN (2026-10-13), thay workbook Google Sheets
-- + quy tac co dinh 1-3-7-Hang tuan. Xem server/debtSchedule/.
--
-- Khoa cua moi dong cong no la (co so, khach KiotViet): cung mot khach o HN va SG
-- co the co lich thanh toan khac nhau.
--
-- * debt_payment_schedules: lich TT (so ngay no toi da) cua tung khach. Nhap lan dau
--   bang script import, sau do Quan ly sua tren web. Khach chua co dong = 1 ngay.
-- * debt_payment_schedule_log: nhat ky sua lich TT (giu vinh vien, chi THEM).
-- * debt_cycle_runs + debt_cycle_customers + debt_cycle_amounts: ban chot luc 15:00
--   gio VN moi ngay (cycle_date = ngay VN cua lan chot). Chi chot SO TIEN; ten/ma/nhom
--   khach va lich TT doc truc tiep luc xem nen luon khop KiotViet/ban sua moi nhat.
--   debt_cycle_amounts giu tong hoa don / tra hang THEO NGAY (90 ngay toi 15:00) de
--   no trong lich va no qua han tinh lai ngay khi lich TT doi.
-- * debt_cycle_feedback + debt_feedback_history: Sale phan hoi / QL phan hoi / Trang
--   thai va lich su MOI thay doi tren giao dien (2 o phan hoi, trang thai, lich TT) — gan
--   voi cycle_date nen tu "reset" khi co ban chot moi (15:00 hom sau). Job chot don ban cu
--   hon 7 ngay. (Lich TT con co nhat ky rieng giu vinh vien: debt_payment_schedule_log.)

CREATE TABLE debt_payment_schedules (
  branch              TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  customer_id         BIGINT NOT NULL,
  schedule_days       INTEGER NOT NULL CHECK (schedule_days BETWEEN 1 AND 90),
  updated_by_user_id  TEXT,
  updated_by_name     TEXT NOT NULL DEFAULT '',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, customer_id)
);

CREATE TABLE debt_payment_schedule_log (
  id                  BIGSERIAL PRIMARY KEY,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  branch              TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  customer_id         BIGINT NOT NULL,
  customer_code       TEXT NOT NULL DEFAULT '',
  customer_name       TEXT NOT NULL DEFAULT '',
  old_days            INTEGER,
  new_days            INTEGER NOT NULL,
  source              TEXT NOT NULL CHECK (source IN ('import', 'web')),
  actor_user_id       TEXT,
  actor_name          TEXT NOT NULL DEFAULT ''
);

CREATE INDEX debt_payment_schedule_log_customer_idx
  ON debt_payment_schedule_log (branch, customer_id, created_at DESC);
CREATE INDEX debt_payment_schedule_log_created_idx
  ON debt_payment_schedule_log (created_at DESC, id DESC);

CREATE FUNCTION debt_payment_schedule_log_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Debt payment schedule log is immutable';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER debt_payment_schedule_log_guard BEFORE UPDATE OR DELETE ON debt_payment_schedule_log
  FOR EACH ROW EXECUTE FUNCTION debt_payment_schedule_log_guard();

CREATE TABLE debt_cycle_runs (
  cycle_date          DATE PRIMARY KEY,
  taken_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  customer_count      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE debt_cycle_customers (
  cycle_date          DATE NOT NULL REFERENCES debt_cycle_runs(cycle_date) ON DELETE CASCADE,
  branch              TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  customer_id         BIGINT NOT NULL,
  current_debt        NUMERIC NOT NULL,
  opening_debt        NUMERIC,
  avg_revenue_4m      NUMERIC,
  PRIMARY KEY (cycle_date, branch, customer_id)
);

CREATE TABLE debt_cycle_amounts (
  cycle_date          DATE NOT NULL REFERENCES debt_cycle_runs(cycle_date) ON DELETE CASCADE,
  branch              TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  customer_id         BIGINT NOT NULL,
  day                 DATE NOT NULL,
  invoice_amount      NUMERIC NOT NULL DEFAULT 0,
  return_amount       NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (cycle_date, branch, customer_id, day)
);

CREATE TABLE debt_cycle_feedback (
  cycle_date              DATE NOT NULL,
  branch                  TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  customer_id             BIGINT NOT NULL,
  sale_feedback           TEXT NOT NULL DEFAULT '' CHECK (char_length(sale_feedback) <= 1000),
  sale_feedback_by        TEXT NOT NULL DEFAULT '',
  sale_feedback_at        TIMESTAMPTZ,
  manager_feedback        TEXT NOT NULL DEFAULT '' CHECK (char_length(manager_feedback) <= 1000),
  manager_feedback_by     TEXT NOT NULL DEFAULT '',
  manager_feedback_at     TIMESTAMPTZ,
  status                  TEXT NOT NULL DEFAULT 'Chưa xử lý' CHECK (status IN (
                            'Chưa xử lý', 'Đang xử lý', 'Đã xử lý', 'Bỏ qua'
                          )),
  status_by               TEXT NOT NULL DEFAULT '',
  status_at               TIMESTAMPTZ,
  PRIMARY KEY (cycle_date, branch, customer_id)
);

CREATE TABLE debt_feedback_history (
  id                  BIGSERIAL PRIMARY KEY,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  cycle_date          DATE NOT NULL,
  branch              TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  customer_id         BIGINT NOT NULL,
  field               TEXT NOT NULL CHECK (field IN ('sale', 'manager', 'status', 'schedule')),
  old_value           TEXT NOT NULL DEFAULT '',
  new_value           TEXT NOT NULL DEFAULT '',
  actor_user_id       TEXT,
  actor_name          TEXT NOT NULL DEFAULT ''
);

CREATE INDEX debt_feedback_history_cycle_idx ON debt_feedback_history (cycle_date, created_at DESC, id DESC);

-- Migration 0010 tu cap SELECT cho reporting_readonly; phan hoi/nhat ky chua ten nguoi dung.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='reporting_readonly') THEN
  REVOKE SELECT ON debt_payment_schedule_log, debt_cycle_feedback, debt_feedback_history FROM reporting_readonly;
 END IF;
END $$;
