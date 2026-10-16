'use strict';

// Port 1:1 src/normalization.py (vat-draft-app): chuan hoa ma, so, ten de so khop.
// Moi diem khac Python <-> JS (khoang trang, casefold, float(), \w \b Unicode) di qua pyCompat.

const {
  PY_WS,
  pyStrip,
  pyCollapseWs,
  pyCasefold,
  pyFloat,
  pyStr
} = require('./pyCompat');

/** normalize_code: str + NFC + strip (None -> ''; NaN cua pandas -> 'nan' nhu Python). */
function normalizeCode(value) {
  if (value === null || value === undefined) return '';
  return pyStrip(pyStr(value).normalize('NFC'));
}

/** normalize_code_for_match: gop khoang trang + casefold. */
function normalizeCodeForMatch(value) {
  return pyCasefold(pyCollapseWs(normalizeCode(value)));
}

/** _strip_diacritics: NFD, bo dau (Mn), đ->d, Đ->D, NFC. */
function stripDiacritics(text) {
  return String(text)
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFC');
}

/** normalize_diacritics_insensitive: bo dau + gop khoang trang + casefold. */
function normalizeDiacriticsInsensitive(value) {
  return pyCasefold(pyCollapseWs(stripDiacritics(normalizeCode(value))));
}

/**
 * to_float_or_none: so -> chinh no (NaN -> null); chuoi -> bo ',' va ' ' (ASCII),
 * '8%' -> 0.08, khong phai so -> null. Luu y giu nguyen hanh vi Python: '1,5' -> 15.
 */
function toFloatOrNone(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  let text = pyStrip(String(value));
  if (text === '') return null;
  text = text.replace(/,/g, '').replace(/ /g, '');
  const isPercent = text.endsWith('%');
  if (isPercent) text = text.slice(0, -1);
  const parsed = pyFloat(text);
  if (parsed === null) return null;
  return isPercent ? parsed / 100 : parsed;
}

// [^\w\s] cua Python (Unicode): \w = chu cai + chu so (moi loai so) + '_'.
const PUNCT_RE = new RegExp(`[^\\p{L}\\p{N}_${PY_WS.slice(1, -1)}]`, 'gu');
// token so + don vi: 1l, 1.5l, 10cm, 220v, 02, 500ml
const NUMBER_UNIT_TOKEN_RE = new RegExp(`^(\\p{Nd}+(?:[.,]\\p{Nd}+)?)${PY_WS}*(ml|l|cm|mm|m|kg|g|w|v|hz|inch|cai|bo)?$`, 'u');
const DIGITS_ONLY_RE = /^\p{Nd}+$/u;
const LEADING_ZERO_RE = /^0+(\p{Nd}+)$/u;

function normalizeLeadingZero(token) {
  const match = token.match(LEADING_ZERO_RE);
  return match ? match[1] : token;
}

/**
 * normalize_name_for_matching -> { raw, cleanedText, wordTokens, numberTokens }.
 * cleanedText: bo dau, chu thuong, bo dau cau, gop khoang trang, KHONG gom token so.
 */
function normalizeNameForMatching(value) {
  const raw = value === null || value === undefined ? '' : pyStr(value);
  let text = pyStrip(raw);
  text = stripDiacritics(text);
  text = text.toLowerCase();
  text = text.replace(PUNCT_RE, ' ');
  text = pyStrip(pyCollapseWs(text));

  const tokens = text ? text.split(' ') : [];
  const wordTokens = [];
  const numberTokens = [];
  for (const tok of tokens) {
    if (!tok) continue;
    const match = tok.match(NUMBER_UNIT_TOKEN_RE);
    if (match) {
      const num = normalizeLeadingZero(match[1].replace(/,/g, '.'));
      numberTokens.push(`${num}${match[2] || ''}`);
    } else if (DIGITS_ONLY_RE.test(tok)) {
      numberTokens.push(normalizeLeadingZero(tok));
    } else {
      wordTokens.push(tok);
    }
  }
  return { raw, cleanedText: wordTokens.join(' '), wordTokens, numberTokens };
}

// \bVAT\b (IGNORECASE) — \b cua JS chi hieu ASCII nen viet lai bang lookaround Unicode.
const VAT_WORD_RE = /(?<![\p{L}\p{N}_])VAT(?![\p{L}\p{N}_])/giu;

/** strip_price_and_vat_suffix: "Am 1000ML (72,100 - 78,500) (VAT)" -> "Am 1000ML". */
function stripPriceAndVatSuffix(tenTruocVat) {
  if (!tenTruocVat) return '';
  let text = pyStr(tenTruocVat).replace(/\([^)]*\)/g, '');
  text = text.replace(VAT_WORD_RE, '');
  return pyStrip(pyCollapseWs(text));
}

module.exports = {
  normalizeCode,
  normalizeCodeForMatch,
  normalizeDiacriticsInsensitive,
  stripDiacritics,
  toFloatOrNone,
  normalizeNameForMatching,
  stripPriceAndVatSuffix
};
