-- Ban chup Google Sheets cho "Vi tri hang" (HN/SG) va "CAN DO" (2026-10-17).
-- Web chi DOC cac bang nay; server/sheetSnapshots/sync.js doc Sheets theo chu ky va ghi KHAC BIET
-- (dong khong doi khong bi ghi lai). Chi them bang moi, khong doi/xoa du lieu cu.

-- 1 dong / nguon: 'stock_locations_hn' | 'stock_locations_sg' | 'shipping_measures'.
CREATE TABLE IF NOT EXISTS sheet_snapshot_sync (
  source          TEXT        PRIMARY KEY,
  last_success_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  last_error      TEXT
);

-- Vi tri hang: giu dung thu tu dong cua sheet (source_row), gom ca dong trung ma / SL = 0.
CREATE TABLE IF NOT EXISTS stock_location_lines (
  branch         TEXT    NOT NULL CHECK (branch IN ('HN', 'SG')),
  source_row     INTEGER NOT NULL,
  code           TEXT    NOT NULL DEFAULT '',
  name           TEXT    NOT NULL DEFAULT '',
  total_quantity TEXT    NOT NULL DEFAULT '',
  notes          TEXT    NOT NULL DEFAULT '',
  location       TEXT    NOT NULL DEFAULT '',
  arrival_date   TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (branch, source_row)
);

-- CAN DO: m3 / kg moi cai da tinh san tu cot goc (D, R, C, SL/T, Can nang). code_key = lower(trim(ma)).
CREATE TABLE IF NOT EXISTS shipping_measures (
  code_key    TEXT    PRIMARY KEY,
  per_carton  NUMERIC,
  m3_per_unit NUMERIC,
  kg_per_unit NUMERIC
);
