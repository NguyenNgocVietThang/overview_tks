-- Bang "Du kien hang ve" (tab Hang hoa, 2026-10-20). Bang KET QUA tinh san tu product_container_lines
-- (snapshot sheet CONT, migration 0053/0072) + ten SP tu product_report boi
-- server/productContainers/expectedRefresh.js; web (/api/expected-arrivals) chi DOC bang nay.
--
-- 1 dong = 1 dong hang cua sheet (khong gop), khoa (sheet_name, source_row) nhu bang nguon.
-- schedule_label = status_label (cot B) + eta (cot C) da ghep, btrim -> "cot A" cua bang.
-- product_name lay tu product_report (1 dong / ma hang, gom ca 2 co so) theo product_key; khong co thi ''.
-- Ghi khac biet: dong khong doi khong bi ghi lai; version trong bang trang thai chi tang khi co dong
-- that su them / doi / xoa (cache doc so version).
-- Chi them bang moi, khong doi/xoa du lieu cu. Code tra bang rong khi chua ap migration.

CREATE TABLE IF NOT EXISTS product_container_expected (
  sheet_name        TEXT     NOT NULL,
  source_row        INTEGER  NOT NULL,
  sheet_order       INTEGER  NOT NULL,
  container_row     INTEGER  NOT NULL,
  container_name    TEXT     NOT NULL DEFAULT '',
  status            SMALLINT NOT NULL,
  status_label      TEXT     NOT NULL DEFAULT '',
  eta               TEXT     NOT NULL DEFAULT '',
  schedule_label    TEXT     NOT NULL DEFAULT '',
  product_code      TEXT     NOT NULL DEFAULT '',
  product_key       TEXT     NOT NULL DEFAULT '',
  product_name      TEXT     NOT NULL DEFAULT '',
  color             TEXT     NOT NULL DEFAULT '',
  sale_note         TEXT     NOT NULL DEFAULT '',
  ordered_by        TEXT     NOT NULL DEFAULT '',
  units_per_package NUMERIC,
  package_count     NUMERIC,
  quantity          NUMERIC  NOT NULL DEFAULT 0,
  PRIMARY KEY (sheet_name, source_row)
);

-- 1 dong trang thai: version tang khi noi dung bang doi; source_version = version snapshot CONT luc tinh.
CREATE TABLE IF NOT EXISTS product_container_expected_state (
  id             SMALLINT    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version        BIGINT      NOT NULL DEFAULT 0,
  source_version UUID,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  row_count      INTEGER     NOT NULL DEFAULT 0
);

-- Co cot Nguoi dat (nhu product_container_lines, 0053): chi API duoc doc, khong cap cho reporting_readonly.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_readonly') THEN
    REVOKE ALL ON product_container_expected, product_container_expected_state FROM reporting_readonly;
  END IF;
END $$;
