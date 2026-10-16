-- PostgreSQL is the authoritative Marketing store. No source history is rewritten.
CREATE TABLE marketing_pages (
  page_id TEXT PRIMARY KEY CHECK (page_id IN ('1184366971419195','1144127138790204','430840296781378','1094883173717378','1222318524308489','1387564787764418')),
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'facebook' CHECK (platform = 'facebook'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','error')),
  last_success_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  error_code TEXT
);
INSERT INTO marketing_pages(page_id,name) VALUES
 ('1184366971419195','Hữu Nghị'),('1144127138790204','Tân Thanh'),
 ('430840296781378','Bắc Lãm'),('1094883173717378','Phú Lương'),
 ('1222318524308489','HN-SG'),('1387564787764418','Dương Nội');

CREATE SEQUENCE marketing_source_order;
CREATE TABLE marketing_import_batches (
  id BIGSERIAL PRIMARY KEY,
  batch_key TEXT NOT NULL UNIQUE,
  workbook_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor JSONB NOT NULL
);
CREATE TABLE marketing_history_rows (
  id BIGSERIAL PRIMARY KEY,
  batch_id BIGINT NOT NULL REFERENCES marketing_import_batches(id),
  workbook_id TEXT NOT NULL,
  source_tab TEXT NOT NULL,
  source_row INTEGER NOT NULL CHECK (source_row > 0),
  source_order BIGINT NOT NULL UNIQUE DEFAULT nextval('marketing_source_order'),
  page_id TEXT NOT NULL REFERENCES marketing_pages(page_id),
  source_created_at TIMESTAMPTZ,
  source_created_text TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL,
  phone_key TEXT NOT NULL,
  employee_raw TEXT NOT NULL DEFAULT '',
  credited_date DATE,
  raw JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  UNIQUE(workbook_id,source_tab,source_row)
);
CREATE INDEX marketing_history_page_order_idx ON marketing_history_rows(page_id,source_order);

CREATE TABLE marketing_employee_aliases (
  raw_name TEXT PRIMARY KEY CHECK (btrim(raw_name) <> ''),
  report_employee TEXT NOT NULL CHECK (btrim(report_employee) <> ''),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor JSONB NOT NULL
);
CREATE TABLE marketing_sync_runs (
  id BIGSERIAL PRIMARY KEY,
  run_key TEXT NOT NULL UNIQUE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','error'))
);
CREATE TABLE marketing_sync_pages (
  run_id BIGINT NOT NULL REFERENCES marketing_sync_runs(id),
  page_id TEXT NOT NULL REFERENCES marketing_pages(page_id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','error')),
  completed_at TIMESTAMPTZ,
  error_code TEXT,
  payload_hash TEXT,
  input_count INTEGER NOT NULL DEFAULT 0,
  new_facts INTEGER NOT NULL DEFAULT 0,
  new_observations INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(run_id,page_id)
);
CREATE TABLE marketing_pancake_facts (
  id BIGSERIAL PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES marketing_pages(page_id),
  source_key TEXT NOT NULL CHECK (btrim(source_key) <> ''),
  historical_row_id BIGINT UNIQUE REFERENCES marketing_history_rows(id),
  credited_date DATE,
  first_seen_run_id BIGINT NOT NULL REFERENCES marketing_sync_runs(id),
  latest_hash TEXT NOT NULL,
  UNIQUE(page_id,source_key)
);
CREATE TABLE marketing_pancake_observations (
  id BIGSERIAL PRIMARY KEY,
  fact_id BIGINT NOT NULL REFERENCES marketing_pancake_facts(id),
  run_id BIGINT NOT NULL REFERENCES marketing_sync_runs(id),
  source_order BIGINT NOT NULL UNIQUE DEFAULT nextval('marketing_source_order'),
  source_created_at TIMESTAMPTZ NOT NULL,
  credited_date DATE NOT NULL,
  message_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('INBOX','COMMENT')),
  phone TEXT NOT NULL,
  phone_key TEXT NOT NULL,
  employee_raw TEXT NOT NULL DEFAULT '',
  raw JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  UNIQUE(fact_id,run_id)
);
CREATE INDEX marketing_observation_fact_order_idx ON marketing_pancake_observations(fact_id,source_order);
CREATE INDEX marketing_observation_date_idx ON marketing_pancake_observations(credited_date);

CREATE TABLE marketing_monthly_rows (
  id BIGSERIAL PRIMARY KEY,
  report_year INTEGER NOT NULL CHECK (report_year BETWEEN 1900 AND 9999),
  report_month INTEGER NOT NULL CHECK (report_month BETWEEN 1 AND 12),
  sale TEXT NOT NULL DEFAULT '',
  customer TEXT NOT NULL DEFAULT '',
  customer_directory_id TEXT,
  phone TEXT NOT NULL DEFAULT '',
  page_id TEXT REFERENCES marketing_pages(page_id),
  page TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  data_source TEXT NOT NULL DEFAULT '',
  closed_at DATE,
  new_customer TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL CHECK (origin IN ('sheet','manual')),
  workbook_id TEXT,
  source_tab TEXT,
  source_row INTEGER CHECK (source_row > 0),
  source_hash TEXT,
  source_raw JSONB,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((origin='manual' AND workbook_id IS NULL AND source_tab IS NULL AND source_row IS NULL)
      OR (origin='sheet' AND workbook_id IS NOT NULL AND source_tab IS NOT NULL AND source_row IS NOT NULL AND source_hash IS NOT NULL)),
  UNIQUE(workbook_id,source_tab,source_row)
);
CREATE INDEX marketing_monthly_month_idx ON marketing_monthly_rows(report_year,report_month,id);
CREATE TABLE marketing_monthly_audit (
  id BIGSERIAL PRIMARY KEY,
  row_id BIGINT NOT NULL REFERENCES marketing_monthly_rows(id),
  action TEXT NOT NULL CHECK (action IN ('create','update','import')),
  version BIGINT NOT NULL,
  actor JSONB NOT NULL,
  before_row JSONB,
  after_row JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(row_id,version)
);

CREATE FUNCTION marketing_immutable_guard() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Marketing source history and audit are immutable'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER marketing_history_guard BEFORE UPDATE OR DELETE ON marketing_history_rows
 FOR EACH ROW EXECUTE FUNCTION marketing_immutable_guard();
CREATE TRIGGER marketing_observation_guard BEFORE UPDATE OR DELETE ON marketing_pancake_observations
 FOR EACH ROW EXECUTE FUNCTION marketing_immutable_guard();
CREATE TRIGGER marketing_audit_guard BEFORE UPDATE OR DELETE ON marketing_monthly_audit
 FOR EACH ROW EXECUTE FUNCTION marketing_immutable_guard();
CREATE TRIGGER marketing_import_guard BEFORE UPDATE OR DELETE ON marketing_import_batches
 FOR EACH ROW EXECUTE FUNCTION marketing_immutable_guard();

-- Existing default privileges grant reporting_readonly SELECT. Marketing contains personal rows.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='reporting_readonly') THEN
  REVOKE SELECT ON marketing_pages,marketing_import_batches,marketing_history_rows,
   marketing_employee_aliases,marketing_sync_runs,marketing_sync_pages,
   marketing_pancake_facts,marketing_pancake_observations,marketing_monthly_rows,
   marketing_monthly_audit FROM reporting_readonly;
 END IF;
END $$;
