-- Tai lieu dung san thu 4 cua tab "Quy dinh cong ty": Quy dinh treo hang (don treo cho
-- hang / giu hang cua Sale, muc phat khi treo lach luat). Noi dung nam trong HTML trang
-- Quan ly nhan su (khoi #ruleDoc-treo-hang); bang chi luu metadata de Quan ly go / khoi phuc duoc.
-- Phai khop phan tu thu 4 cua DEFAULT_BUILTIN_DOCUMENTS trong hrRuleDocumentsRepository.js.
INSERT INTO hr_rule_documents (kind, builtin_key, title, sort_order) VALUES
  ('builtin', 'treo-hang', 'Quy định treo hàng', 40)
ON CONFLICT (builtin_key) DO NOTHING;
