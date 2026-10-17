// ==========================================
// HR RULE DOCUMENT ICONS — danh sach icon CO DINH cho tai lieu go tay (kind='text',
// migration 0062). Quan ly CHI CHON tu danh sach nay (nhu chon emoji), khong go tay
// duoc — nen icon_key la 1 enum vo hai, khong di qua bo loc XSS nhu `body`.
// Phai khop CHECK cua migration 0062 va ICON_DEFS phia frontend
// (public/humanresources/index.html) — sua o day thi phai sua ca 2 noi do.
// ==========================================
'use strict';

const ALLOWED_ICON_KEYS = Object.freeze([
  'clock', 'calendar', 'gift', 'box', 'info', 'warning', 'document', 'users'
]);
const ALLOWED_ICON_KEY_SET = new Set(ALLOWED_ICON_KEYS);

/** Chuan hoa gia tri icon tu client: chuoi rong/null/khong hop le -> null (khong co icon). */
function normalizeIconKey(value) {
  const text = String(value == null ? '' : value).trim();
  return ALLOWED_ICON_KEY_SET.has(text) ? text : null;
}

module.exports = { ALLOWED_ICON_KEYS, normalizeIconKey };
