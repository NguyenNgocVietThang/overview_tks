-- Tuoi no theo hoa don (muc 3 tab Cong no, 2026-10-17). Bang KET QUA tinh san tu cac bang
-- chung (customers.debt + invoices Hoan thanh + debt_payment_schedules) boi
-- server/debtSchedule/debtAgingRefresh.js sau moi luot dong bo KiotViet; web chi doc bang nay.
--
-- 1 dong / khach / co so (khach dang hoat dong). Ghi khac biet: dong khong doi khong bi ghi lai.
-- payoff_day/equivalent_days/remaining_days NULL khi no <= 0. beyond_history = tru het 30 ngay
-- hoa don van con no (payoff_day = ngay dau khoang tra cuu).
-- Chi them bang moi, khong doi/xoa du lieu cu. Code tra bang rong (canh bao) khi chua ap.

CREATE TABLE IF NOT EXISTS debt_aging_customers (
  branch              TEXT     NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  customer_id         BIGINT   NOT NULL,
  customer_code       TEXT     NOT NULL DEFAULT '',
  customer_name       TEXT     NOT NULL DEFAULT '',
  sale                TEXT,
  schedule_days       INTEGER  NOT NULL,
  has_stored_schedule BOOLEAN  NOT NULL DEFAULT false,
  current_debt        NUMERIC  NOT NULL DEFAULT 0,
  overdue_debt        NUMERIC  NOT NULL DEFAULT 0,
  payoff_day          DATE,
  beyond_history      BOOLEAN  NOT NULL DEFAULT false,
  equivalent_days     INTEGER,
  remaining_days      INTEGER,
  PRIMARY KEY (branch, customer_id)
);

-- 1 dong trang thai: ngay tinh (gio VN), luc tinh xong, luc dong bo khach moi nhat, version tang
-- khi noi dung bang doi (de cache doc biet khi nao phai doc lai).
CREATE TABLE IF NOT EXISTS debt_aging_state (
  id                  SMALLINT    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  as_of_day           DATE        NOT NULL,
  refreshed_at        TIMESTAMPTZ NOT NULL,
  customers_synced_at TIMESTAMPTZ,
  version             BIGINT      NOT NULL DEFAULT 0
);
