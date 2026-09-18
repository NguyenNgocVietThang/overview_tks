-- Ket qua tinh san cua bao cao cong no khach hang HN1/HN3/HN7 (thay 3 tab
-- Google Sheets Apps Script tung tu tinh — xem src-dashboard/kiotviet/
-- CustomerDebtReport.gs). Refresh moi 5 phut boi
-- server/kiotvietSync/customerDebtReportRefresh.js (server/dashboard/
-- customerDebtPgReader.js CHI DOC bang nay, khong tinh toan gi them) —
-- cung 1 chien luoc voi 4 bang rollup o 0013_dashboard_rollups.sql, nhung o
-- day thuat toan (so du chay theo tung giao dich, tach dong theo mat hang)
-- qua phuc tap de viet thanh 1 cau SQL GROUP BY don thuan nen van tinh trong
-- Node.js roi ghi ket qua xuong day, thay vi tinh song trong request HTTP.
--
-- Moi dong ung voi 1 dong hien thi tren bao cao (dong "Du no dau ky", 1 dong
-- moi giao dich hoac 1 dong moi mat hang trong giao dich nhieu mat hang) —
-- KHONG phai 1 dong = 1 giao dich KiotViet. `seq` giu dung thu tu hien thi
-- (sap theo tong no giam dan giua cac khach, theo thoi gian tang dan trong
-- tung khach) vi day la bang dan xuat, khong co khoa nghiep vu tu nhien.
--
-- product_code/product_name/category_name/price/quantity/amount/discount
-- deu NULL khi dong khong gan voi 1 dong hang cu the (dong "Du no dau ky",
-- thanh toan, dieu chinh) — customerDebtPgReader.js doc lai phai tra ve ''
-- cho cac cot nay giong het hanh vi Apps Script cu.
--
-- Khong REVOKE SELECT FROM reporting_readonly: du lieu (ma so/dien thoai
-- khach hang, cong no) khong nhay cam hon bang `customers` nguon, da duoc
-- GRANT san o 0010_reporting_readonly_role.sql.

CREATE TABLE customer_debt_report_lines (
  branch         TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  period_days    SMALLINT NOT NULL CHECK (period_days IN (1, 3, 7)),
  seq            INT NOT NULL,
  customer_code  TEXT NOT NULL,
  customer_name  TEXT NOT NULL,
  phone          TEXT NOT NULL,
  customer_group TEXT NOT NULL,
  opening_debt   NUMERIC NOT NULL,
  debit          NUMERIC NOT NULL,
  credit         NUMERIC NOT NULL,
  closing_debt   NUMERIC NOT NULL,
  txn_code       TEXT NOT NULL,
  txn_time       TIMESTAMPTZ,
  txn_type       TEXT NOT NULL,
  txn_value      NUMERIC NOT NULL,
  running_debt   NUMERIC NOT NULL,
  product_code   TEXT,
  product_name   TEXT,
  category_name  TEXT,
  price          NUMERIC,
  quantity       NUMERIC,
  amount         NUMERIC,
  discount       NUMERIC,
  total          NUMERIC NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, period_days, seq)
);
