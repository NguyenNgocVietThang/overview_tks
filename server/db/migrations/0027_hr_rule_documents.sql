-- Tai lieu "Quy dinh cong ty" (trang Quan ly nhan su, tab Quy dinh cong ty). Moi
-- dong la 1 tai lieu, hien thanh 1 tab trong trang va 1 nhanh con trong sidebar:
--   kind = 'builtin': tai lieu dung san - noi dung nam trong HTML cua trang, khoa
--                     bang builtin_key; chi luu metadata de Quan ly go duoc (xoa
--                     dong) va khoi phuc duoc (chen lai dong con thieu).
--   kind = 'pdf'    : file PDF Quan ly tai len, luu thang trong cot content (BYTEA).
--                     Khong luu dia cuc bo vi dia cua host la ephemeral; moi state
--                     ben vung cua app nam o Postgres.
-- Danh sach tai lieu chi SELECT cac cot metadata, khong keo cot content.
CREATE TABLE hr_rule_documents (
  id                   BIGSERIAL PRIMARY KEY,
  kind                 TEXT NOT NULL CHECK (kind IN ('builtin', 'pdf')),
  builtin_key          TEXT UNIQUE,
  title                TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  sort_order           INTEGER NOT NULL DEFAULT 1000,
  file_name            TEXT,
  size_bytes           INTEGER CHECK (size_bytes > 0),
  sha256               CHAR(64) CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  content              BYTEA,
  uploaded_by_user_id  UUID REFERENCES app_users(id) ON DELETE SET NULL,
  uploaded_by_name     TEXT NOT NULL DEFAULT '',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hr_rule_documents_kind_shape CHECK (
    (kind = 'builtin' AND builtin_key IS NOT NULL AND content IS NULL
       AND file_name IS NULL AND size_bytes IS NULL AND sha256 IS NULL)
    OR
    (kind = 'pdf' AND builtin_key IS NULL AND content IS NOT NULL
       AND file_name IS NOT NULL AND size_bytes IS NOT NULL AND sha256 IS NOT NULL)
  )
);

-- 2 tai lieu dung san, thu tu hien thi theo sort_order (PDF tai len mac dinh 1000
-- nen luon nam sau). Phai khop hang so DEFAULT_BUILTIN_DOCUMENTS trong code (dung
-- de "Khoi phuc tai lieu mac dinh"): sua o day thi phai sua ca do.
INSERT INTO hr_rule_documents (kind, builtin_key, title, sort_order) VALUES
  ('builtin', 'gio-giac',  'Giờ giấc làm việc',  10),
  ('builtin', 'nghi-phep', 'Quy định nghỉ phép', 20);

-- Migration 0010 tu cap SELECT cho reporting_readonly tren moi bang tao sau no.
-- Bang nay chua file PDF noi bo cua cong ty, khong thuoc du lieu bao cao.
REVOKE SELECT ON hr_rule_documents FROM reporting_readonly;
