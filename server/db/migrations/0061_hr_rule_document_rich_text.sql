-- Nang cap tai lieu go tay (kind='text') tu van ban thuan sang rich text (dinh dang
-- kieu Word: dam/nghieng/gach chan/gach ngang, tieu de H1/H2, can le, mau chu/nen,
-- bang, chen anh). Noi dung van luu trong cot `body` (van la TEXT), nhung tu migration
-- nay tro di `body` chua HTML da duoc loc qua sanitize-html (server/hr/hrRuleDocumentSanitizer.js)
-- thay vi van ban thuan. KHONG bao gio render body bang innerHTML neu chua qua bo loc.

-- Du lieu cu la van ban thuan, chuyen sang HTML tuong duong de khong mat noi dung:
-- thoat 4 ky tu dac biet HTML truoc (& < > ") roi doi \n -> <br>. Dung char_length
-- cu de loc chi nhung dong 'text' hien co (builtin/pdf khong co body).
UPDATE hr_rule_documents
SET body = REPLACE(
  REPLACE(REPLACE(REPLACE(REPLACE(body, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'),
  E'\n', '<br>'
)
WHERE kind = 'text' AND body IS NOT NULL;

-- HTML co dinh dang chiem nhieu ky tu hon van ban thuan cung noi dung (the + thuoc
-- tinh), nen nang gioi han. Van gioi han tuyet doi de chan phinh bang qua muc.
ALTER TABLE hr_rule_documents DROP CONSTRAINT IF EXISTS hr_rule_documents_body_check;
ALTER TABLE hr_rule_documents ADD CONSTRAINT hr_rule_documents_body_check
  CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 200000);

-- Anh chen trong tai lieu go tay. Luu BYTEA nhu PDF (hr_rule_documents.content), gioi
-- han 5 MB/anh. document_id xoa theo (ON DELETE CASCADE) khi tai lieu bi go. Khong
-- FK rang buoc kind='text' o muc DB (don gian hon triggers), nhung code chi tao dong
-- o bang nay tu luong luu tai lieu kind='text'.
CREATE TABLE hr_rule_document_images (
  id            BIGSERIAL PRIMARY KEY,
  document_id   BIGINT NOT NULL REFERENCES hr_rule_documents(id) ON DELETE CASCADE,
  content       BYTEA NOT NULL,
  content_type  TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  size_bytes    INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  sha256        CHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_hr_rule_document_images_document_id ON hr_rule_document_images (document_id);

-- Chua file noi bo (co the chua anh noi bo cong ty) — khong phai du lieu bao cao.
REVOKE SELECT ON hr_rule_document_images FROM reporting_readonly;
