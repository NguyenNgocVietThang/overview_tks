-- Tai lieu dung san thu 3 cua tab "Quy dinh cong ty": Chi tieu & Phuc loi (quy che
-- chi tieu cong doan + phuc loi cong ty). Noi dung nam trong HTML trang Quan ly nhan
-- su (khoi #ruleDoc-phuc-loi); bang chi luu metadata de Quan ly go / khoi phuc duoc.
-- Phai khop phan tu thu 3 cua DEFAULT_BUILTIN_DOCUMENTS trong hrRuleDocumentsRepository.js.
INSERT INTO hr_rule_documents (kind, builtin_key, title, sort_order) VALUES
  ('builtin', 'phuc-loi', 'Chi tiêu & Phúc lợi', 30)
ON CONFLICT (builtin_key) DO NOTHING;
