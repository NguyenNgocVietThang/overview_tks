-- Them loai tai lieu thu 3 cho tab "Quy dinh cong ty": kind = 'text' — Quan ly go
-- truc tiep noi dung tren web (khac 'pdf' la tai file len, khac 'builtin' la noi dung
-- dung san trong HTML). Luu van ban thuan (khong HTML) o cot `body`; frontend thoat
-- ky tu HTML khi hien thi, khong render rich-text, de tranh XSS.
-- Tai lieu text sua duoc tai cho (khac PDF chi thay moi), nen them cot updated_at/
-- updated_by_name de biet lan sua gan nhat.
ALTER TABLE hr_rule_documents
  ADD COLUMN body TEXT CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 20000),
  ADD COLUMN updated_at TIMESTAMPTZ,
  ADD COLUMN updated_by_name TEXT NOT NULL DEFAULT '';

ALTER TABLE hr_rule_documents DROP CONSTRAINT IF EXISTS hr_rule_documents_kind_shape;
ALTER TABLE hr_rule_documents DROP CONSTRAINT IF EXISTS hr_rule_documents_kind_check;

ALTER TABLE hr_rule_documents ADD CONSTRAINT hr_rule_documents_kind_check
  CHECK (kind IN ('builtin', 'pdf', 'text'));

ALTER TABLE hr_rule_documents ADD CONSTRAINT hr_rule_documents_kind_shape CHECK (
  (kind = 'builtin' AND builtin_key IS NOT NULL AND content IS NULL
     AND file_name IS NULL AND size_bytes IS NULL AND sha256 IS NULL AND body IS NULL)
  OR
  (kind = 'pdf' AND builtin_key IS NULL AND content IS NOT NULL
     AND file_name IS NOT NULL AND size_bytes IS NOT NULL AND sha256 IS NOT NULL AND body IS NULL)
  OR
  (kind = 'text' AND builtin_key IS NULL AND content IS NULL
     AND file_name IS NULL AND size_bytes IS NULL AND sha256 IS NULL AND body IS NOT NULL)
);
