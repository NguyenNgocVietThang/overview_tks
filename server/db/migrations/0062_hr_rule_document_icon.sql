-- Icon tai lieu quy dinh (kind='text', migration 0061): Quan ly CHON 1 icon tu danh
-- sach co dinh (khong go tay) de hien canh tieu de, thay cho SVG tu do nguoi dung nhap
-- (khong an toan). icon_key la gia tri hang (enum qua CHECK), hoan toan tach biet khoi
-- `body` nen KHONG di qua bo loc XSS va KHONG tang be mat tan cong.
-- Danh sach phai khop ALLOWED_ICON_KEYS trong hr/hrRuleDocumentIcons.js va ICON_DEFS
-- phia frontend (public/humanresources/index.html) — sua o day thi phai sua ca 2 noi do.
ALTER TABLE hr_rule_documents
  ADD COLUMN icon_key TEXT CHECK (icon_key IS NULL OR icon_key IN (
    'clock', 'calendar', 'gift', 'box', 'info', 'warning', 'document', 'users'
  ));
