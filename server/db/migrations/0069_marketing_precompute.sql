-- Bao cao Marketing: tinh san trong Postgres, web chi doc (2026-10-19).
--   3a. marketing_ads_costs (+ state)   : chi phi ADS doc tu Google Sheets theo chu ky (marketingAdsSync.js)
--   3b. tks_name_key() + v_marketing_customer_revenue : doanh so KiotViet ghep theo TEN khach bang SQL
--   3c. marketing_phone_summary (+ state): ket qua gop SDT Pancake, dung cuoi moi luot dong bo Pancake
-- Moi duong doc deu fail-soft: thieu bang/view => tu lui ve duong cu (Sheets / RAM / gop JS).
-- Chi THEM doi tuong moi (IF NOT EXISTS / CREATE OR REPLACE), khong doi/xoa du lieu cu, khong CONCURRENTLY.
-- Phai ap SAU 0068 (view doc business_current_month_customer_sales / business_current_month_state).

-- ---------------------------------------------------------------------------------------------
-- 3a. Chi phi ADS. Moi dong = 1 dong ngay ('daily') hoac 1 dong tong thang ('total') cua parseCosts().
-- row_key = record.key cua parser (JSON [ten tab, so dong, khoi]) nen on dinh qua cac lan doc; sheet_order/
-- block/source_row dung de tra ve dung THU TU cua duong doc Sheets (thu tu tab trong workbook, khoi, dong).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketing_ads_costs (
  row_key          TEXT PRIMARY KEY,
  sheet_order      SMALLINT NOT NULL,
  block            SMALLINT NOT NULL,
  source_row       INTEGER  NOT NULL,
  kind             TEXT     NOT NULL CHECK (kind IN ('daily', 'total')),
  sheet            TEXT     NOT NULL,
  page             TEXT     NOT NULL,
  month            SMALLINT,
  date_text        TEXT     NOT NULL DEFAULT '',
  ad_cost          NUMERIC,
  total_cost       NUMERIC,
  messages         NUMERIC,
  cost_per_message NUMERIC,
  phones           NUMERIC,
  cost_per_phone   NUMERIC,
  total_label      TEXT     NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS marketing_ads_costs_month_idx
  ON marketing_ads_costs (month, sheet_order, block, source_row);

-- 1 dong (id = 1): chua co last_success_at => bang chua dong bo => bao cao lui ve doc Sheets.
CREATE TABLE IF NOT EXISTS marketing_ads_sync_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  last_attempt_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error      TEXT,
  row_count       INTEGER NOT NULL DEFAULT 0,
  version         BIGINT  NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------------------------
-- 3b. Khoa so khop ten khach. CUNG cong thuc voi normalizedNameSql() (kiotvietSync/salesSqlFragments.js)
-- va nameKey() (businessReport/businessMonths.js): NFKC, bo ky tu rong (U+200B-U+200D, U+FEFF), gop khoang
-- trang, trim, chu thuong. IMMUTABLE de dung duoc trong index/view.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tks_name_key(value TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(btrim(regexp_replace(
    regexp_replace(normalize(COALESCE(value, ''), NFKC), '[​-‍﻿]', '', 'g'),
    '\s+', ' ', 'g')))
$$;

-- Doanh so (ban - tra hang) tung thang theo TEN khach, gop HN + SG. Thang da chot lay tu
-- business_monthly_customer_sales (chi thang co dong trong business_monthly_state); thang hien tai lay tu
-- business_current_month_customer_sales (chi khi co dong business_current_month_state cung thang; do tuoi cua
-- ban tinh san do phia doc kiem tra qua computed_at).
-- Ngu nghia giu y het duong RAM cu (marketingRevenue.js):
--   * khach co trong danh ba (dang hoat dong) nhung khong ban trong thang  => net_revenue 0, known = true
--   * ten khong co trong danh ba nhung co doanh so                         => net_revenue, known = false
--   * ten khong co o ca hai                                                => khong co dong (phia doc coi la NULL)
--   * khach KHONG hoat dong (customers.raw isActive = false) bi loai khoi doanh so va khoi danh ba.
-- Danh ba lay ban ghi moi nhat (id lon nhat) cua tung (co so, ma khach) nhu businessReportRepository.
CREATE OR REPLACE VIEW v_marketing_customer_revenue AS
WITH directory AS (
  SELECT DISTINCT ON (branch, btrim(code))
         branch, btrim(code) AS code, name,
         COALESCE(raw->>'isActive', raw->>'IsActive', 'true') <> 'false' AS is_active
  FROM customers
  WHERE btrim(COALESCE(code, '')) <> ''
  ORDER BY branch, btrim(code), id DESC
),
active_names AS (
  SELECT DISTINCT tks_name_key(name) AS name_key
  FROM directory
  WHERE is_active AND tks_name_key(name) <> ''
),
sales AS (
  SELECT s.month, s.branch, btrim(s.customer_code) AS code, s.customer_name, s.net_revenue
  FROM business_monthly_customer_sales s
  JOIN business_monthly_state st ON st.month = s.month
  UNION ALL
  SELECT c.month, c.branch, btrim(c.customer_code), c.customer_name, c.net_revenue
  FROM business_current_month_customer_sales c
  JOIN business_current_month_state cs ON cs.id = 1 AND cs.month = c.month
),
-- NOT MATERIALIZED: de dieu kien month = ... cua phia doc day xuong tung thang (khong gop ca nam moi lan hoi).
sales_by_name AS NOT MATERIALIZED (
  SELECT s.month, tks_name_key(s.customer_name) AS name_key, sum(s.net_revenue) AS net_revenue
  FROM sales s
  WHERE tks_name_key(s.customer_name) <> ''
    AND NOT EXISTS (SELECT 1 FROM directory d WHERE NOT d.is_active AND d.branch = s.branch AND d.code = s.code)
  GROUP BY s.month, tks_name_key(s.customer_name)
),
months AS (
  SELECT month FROM business_monthly_state
  UNION
  SELECT month FROM business_current_month_state WHERE id = 1
)
SELECT m.month, a.name_key, COALESCE(sb.net_revenue, 0) AS net_revenue, TRUE AS known
FROM months m
CROSS JOIN active_names a
LEFT JOIN sales_by_name sb ON sb.month = m.month AND sb.name_key = a.name_key
UNION ALL
SELECT sb.month, sb.name_key, sb.net_revenue, FALSE AS known
FROM sales_by_name sb
WHERE NOT EXISTS (SELECT 1 FROM active_names a WHERE a.name_key = sb.name_key);

-- ---------------------------------------------------------------------------------------------
-- 3c. Ket qua gop SDT Pancake doc lap, moi (page_id, phone_key) 1 dong, dung boi marketingSummaryRefresh.js
-- cuoi moi luot dong bo (ghi KHAC BIET). Chi giu truong THO (chua anh xa nhan vien: bang anh xa doi bat cu luc
-- nao nen ap luc doc). trace = danh sach quan sat da gop, moi muc la mang gon [id, source_order, fact_id, run_id, source_key, observed_at].
-- first_order = source_order nho nhat cua nhom => giu dung thu tu hien thi cua duong gop JS.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketing_phone_summary (
  page_id          TEXT   NOT NULL,
  phone_key        TEXT   NOT NULL,
  first_order      BIGINT NOT NULL,
  phone            TEXT   NOT NULL,
  first_employee   TEXT   NOT NULL DEFAULT '',
  current_employee TEXT   NOT NULL DEFAULT '',
  repeat_employee  TEXT   NOT NULL DEFAULT '',
  first_at         DATE,
  current_at       DATE,
  repeat_at        DATE,
  trace            JSONB  NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (page_id, phone_key)
);
CREATE INDEX IF NOT EXISTS marketing_phone_summary_order_idx ON marketing_phone_summary (first_order);
CREATE INDEX IF NOT EXISTS marketing_phone_summary_first_at_idx ON marketing_phone_summary (first_at);
CREATE INDEX IF NOT EXISTS marketing_phone_summary_repeat_at_idx ON marketing_phone_summary (repeat_at) WHERE repeat_at IS NOT NULL;

-- 1 dong (id = 1). max_source_order = quan sat moi nhat da gop: lech voi bang quan sat => ban gop cu =>
-- phia doc lui ve gop JS. periods = cac thang 'YYYY-MM' cua credited_date, employee_raws = moi ten nhan vien
-- nguon da quan sat (cho metadata va danh sach chua anh xa).
CREATE TABLE IF NOT EXISTS marketing_phone_summary_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  built_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  max_source_order BIGINT,
  observation_count BIGINT NOT NULL DEFAULT 0,
  phone_count     INTEGER NOT NULL DEFAULT 0,
  periods         TEXT[]  NOT NULL DEFAULT '{}',
  employee_raws   TEXT[]  NOT NULL DEFAULT '{}',
  version         BIGINT  NOT NULL DEFAULT 0
);

-- Bang SDT chua so dien thoai: khong cho reporting_readonly doc (nhu cac bang marketing_* khac).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_readonly') THEN
    REVOKE SELECT ON marketing_phone_summary, marketing_phone_summary_state FROM reporting_readonly;
  END IF;
END $$;
