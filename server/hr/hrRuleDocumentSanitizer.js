// ==========================================
// HR RULE DOCUMENT SANITIZER — loc HTML cua tai lieu go tay (kind='text', migration
// 0061) truoc khi luu vao Postgres. Day la hang rao DUY NHAT chong XSS: noi dung do
// Quan ly (hr.rules.manage) tu go, hien ra cho MOI tai khoan noi bo qua innerHTML, nen
// chi can 1 cho lot la script/onerror/javascript: chay duoc tren trinh duyet nguoi khac.
//
// Nguyen tac:
//   - Whitelist tuyet doi: the/thuoc tinh KHONG co trong danh sach duoi se bi go, KHONG
//     giu lai duoi dang chu thuong (tru <script>/<style> — noi dung ben trong cung bi bo,
//     xem NON_TEXT_TAGS, tranh ma doc "lo" ra thanh van ban roi bi dong khac dien giai).
//   - <img> CHI nhan src la duong dan tuong doi trong chinh API nay
//     (/api/hr/rules/documents/.../images/...), KHONG nhan URL ngoai (chan anh theo doi
//     nguoi xem qua may chu la, SSRF-style leak) va KHONG nhan data: (anh base64 duoc
//     tach ra luu rieng truoc khi toi day — xem hrRuleDocumentImages.js).
//   - style CHI nhan color/background-color dang hex/rgb hop le — chan CSS injection
//     (url(), expression(), import) va chan dung thuoc tinh style de giau noi dung doc hai.
//   - <a href> chi nhan http/https, luon ep rel="noopener noreferrer" + target="_blank".
// ==========================================
'use strict';

const sanitizeHtml = require('sanitize-html');

const IMAGE_SRC_PATTERN = /^\/api\/hr\/rules\/documents\/\d+\/images\/\d+$/;

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const RGB_COLOR = /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/;

const SANITIZE_OPTIONS = {
  allowedTags: [
    'p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike',
    'h1', 'h2',
    'ul', 'ol', 'li',
    'span', 'a',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'img'
  ],
  // script/style/khong nam trong allowedTags: bo luon ca the lan noi dung ben trong,
  // khong "mo khoa" thanh van ban thuong (mac dinh sanitize-html da lam vay voi
  // script/style, ke them iframe/svg vi 2 the nay cung co the mang theo script).
  nonTextTags: ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'form', 'noscript'],
  allowedAttributes: {
    p: ['style'],
    div: ['style'],
    h1: ['style'],
    h2: ['style'],
    span: ['style'],
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan']
  },
  allowedStyles: {
    'p': { 'text-align': [/^(left|center|right|justify)$/] },
    'div': { 'text-align': [/^(left|center|right|justify)$/] },
    'h1': { 'text-align': [/^(left|center|right|justify)$/] },
    'h2': { 'text-align': [/^(left|center|right|justify)$/] },
    'span': {
      color: [HEX_COLOR, RGB_COLOR],
      'background-color': [HEX_COLOR, RGB_COLOR],
      'font-weight': [/^(bold|700)$/],
      'font-style': [/^italic$/],
      'text-decoration': [/^(?:underline|line-through)(?:\s+(?:underline|line-through))?$/]
    }
  },
  allowedSchemes: ['http', 'https'],
  allowedSchemesByTag: { img: [] }, // img khong qua allowedSchemes (du dung data:/http) — chi qua transformTags duoi day
  transformTags: {
    a(tagName, attribs) {
      return { tagName: 'a', attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' } };
    },
    img(tagName, attribs) {
      // src khong dung dinh dang URL noi bo cua chinh he thong -> bo het thuoc tinh src
      // (anh vo hinh thay vi lam sap trang hoac giu lai nguon la).
      if (typeof attribs.src !== 'string' || !IMAGE_SRC_PATTERN.test(attribs.src)) {
        const { src, ...rest } = attribs;
        return { tagName: 'img', attribs: rest };
      }
      return { tagName: 'img', attribs };
    }
  },
  // Chan toan bo the khong trong danh sach nhung GIU chu (vd nguoi dung go "<div>ghi
  // chu</div>" van con chu "ghi chu") — tru nonTextTags o tren.
  disallowedTagsMode: 'discard'
};

/**
 * Loc HTML tu dieu dang go (rich text editor) truoc khi luu DB.
 * @param {string} html
 * @returns {string} HTML da loc, an toan de luu va render bang innerHTML.
 */
function sanitizeRuleDocumentHtml(html) {
  return sanitizeHtml(String(html == null ? '' : html), SANITIZE_OPTIONS);
}

/** Co chu that hoac cau truc noi dung hop le (anh/bang), khong chi <p><br></p>. */
function hasMeaningfulRuleDocumentContent(html) {
  const value = String(html || '');
  if (/<(?:img|table)\b/i.test(value)) return true;
  const text = sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} })
    .replace(/\u00a0/g, ' ')
    .trim();
  return text.length > 0;
}

module.exports = { sanitizeRuleDocumentHtml, hasMeaningfulRuleDocumentContent, IMAGE_SRC_PATTERN };
