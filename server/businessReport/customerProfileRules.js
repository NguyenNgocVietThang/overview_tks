'use strict';

// Quy tac thuan (khong DB) cho thong tin / ghi chu khach hang cua bang "Doanh so theo khach".
// Route va repository cung dung de 400 som, dung 1 nguon su that.

const SCALES = Object.freeze(['none', 'small', 'medium', 'large']);
const SALES_CHANNELS = Object.freeze(['san', 'cua_hang', 'fb_ads', 'fb_live', 'sang_tay', 'kho_buon']);
const MAX_TEXT = 500;
const MAX_NOTE = 2000;
const MAX_VISIT_DATES = 400;
const MAX_EDITORS = 200;
const MAX_IMAGES = 10;
const MAX_WAREHOUSE_COUNT = 1e9;
const MIN_VISIT_DATE = '2000-01-01';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function httpError(statusCode, code, message) {
  const e = new Error(message);
  e.statusCode = statusCode;
  e.code = code;
  return e;
}

const bad = (code, message) => httpError(400, code, message);

function text(value, label) {
  const s = String(value == null ? '' : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (s.length > MAX_TEXT) throw bad('INVALID_PROFILE', `${label} tối đa ${MAX_TEXT} ký tự.`);
  return s;
}

// body: { warehouseLocation, warehouseCount, warehouseScale, competitor, salesChannels }.
function normalizeProfileInput(body) {
  const b = body && typeof body === 'object' ? body : {};
  let count = null;
  if (b.warehouseCount !== null && b.warehouseCount !== undefined && b.warehouseCount !== '') {
    const n = typeof b.warehouseCount === 'number' ? b.warehouseCount : (typeof b.warehouseCount === 'string' && b.warehouseCount.trim() !== '' ? Number(b.warehouseCount) : NaN);
    if (!Number.isFinite(n) || n < 0 || n > MAX_WAREHOUSE_COUNT) throw bad('INVALID_PROFILE', 'Số lượng kho phải là số không âm.');
    count = n;
  }
  const scale = b.warehouseScale === undefined || b.warehouseScale === null || b.warehouseScale === '' ? 'none' : b.warehouseScale;
  if (!SCALES.includes(scale)) throw bad('INVALID_PROFILE', 'Quy mô kho không hợp lệ.');
  let channels = [];
  if (b.salesChannels !== undefined && b.salesChannels !== null) {
    if (!Array.isArray(b.salesChannels)) throw bad('INVALID_PROFILE', 'Hình thức bán hàng không hợp lệ.');
    if (b.salesChannels.some(c => !SALES_CHANNELS.includes(c))) throw bad('INVALID_PROFILE', 'Hình thức bán hàng không hợp lệ.');
    channels = SALES_CHANNELS.filter(c => b.salesChannels.includes(c));
  }
  return {
    warehouseLocation: text(b.warehouseLocation, 'Định vị kho'),
    warehouseCount: count,
    warehouseScale: scale,
    competitor: text(b.competitor, 'Đối thủ'),
    salesChannels: channels
  };
}

function normalizeNoteBody(value) {
  if (typeof value !== 'string') throw bad('INVALID_NOTE', 'Nội dung note không được để trống.');
  const s = value.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (!s) throw bad('INVALID_NOTE', 'Nội dung note không được để trống.');
  if (s.length > MAX_NOTE) throw bad('INVALID_NOTE', `Note tối đa ${MAX_NOTE} ký tự.`);
  return s;
}

function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Tap ngay "da di": mang 'YYYY-MM-DD' hop le, khong o tuong lai theo today (gio VN), khong trung; tra ve tang dan.
function normalizeVisitDates(dates, today) {
  if (!Array.isArray(dates)) throw bad('INVALID_VISIT_DATES', 'Danh sách ngày không hợp lệ.');
  if (dates.length > MAX_VISIT_DATES) throw bad('INVALID_VISIT_DATES', `Tối đa ${MAX_VISIT_DATES} ngày.`);
  const set = new Set();
  for (const d of dates) {
    if (typeof d !== 'string' || !isRealDate(d)) throw bad('INVALID_VISIT_DATES', 'Ngày không hợp lệ (định dạng YYYY-MM-DD).');
    if (d > today) throw bad('INVALID_VISIT_DATES', 'Không chọn ngày trong tương lai.');
    if (d < MIN_VISIT_DATE) throw bad('INVALID_VISIT_DATES', 'Ngày quá xa.');
    set.add(d);
  }
  return [...set].sort();
}

function normalizeUserIds(userIds) {
  if (!Array.isArray(userIds)) throw bad('INVALID_EDITORS', 'Danh sách người sửa không hợp lệ.');
  if (userIds.length > MAX_EDITORS) throw bad('INVALID_EDITORS', 'Quá nhiều người sửa.');
  const out = [];
  for (const id of userIds) {
    const s = typeof id === 'string' || typeof id === 'number' ? String(id).trim() : '';
    if (!s || s.length > 100) throw bad('INVALID_EDITORS', 'Mã người dùng không hợp lệ.');
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

const emptyProfile = () => ({ warehouseLocation: '', warehouseCount: null, warehouseScale: 'none', competitor: '', salesChannels: [] });

module.exports = {
  SCALES, SALES_CHANNELS, MAX_IMAGES, MAX_NOTE, MAX_TEXT, UUID_RE,
  httpError, normalizeProfileInput, normalizeNoteBody, normalizeVisitDates, normalizeUserIds, emptyProfile
};
