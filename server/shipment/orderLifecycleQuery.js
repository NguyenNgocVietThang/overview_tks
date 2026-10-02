// ==========================================
// ORDER LIFECYCLE QUERY — loc / sap xep / phan trang bang "Toan bo don hang" TREN MAY CHU.
//
// Tu 2026-10-02 bang gom MOI don cua KiotViet (~60 nghin don, moi trang thai) nen khong the gui ca
// danh sach xuong trinh duyet moi 60 giay: giao dien chi xin 1 trang (100 dong) kem bo loc/sap xep, va
// xuat Excel gui cung bo loc nay (khong gui danh sach ma nua). Cac ham o day la HAM THUAN, giu NGUYEN
// hanh vi loc/sap xep truoc day cua trang (chuan hoa tieng Viet khong dau, thoi gian tinh bang
// Date.UTC tren dung cac con so hien thi — khong phu thuoc mui gio may chu).
// ==========================================
'use strict';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

const SORT_KEYS = Object.freeze([
  'orderCode', 'branch', 'orderDate', 'saleName', 'customerName', 'orderTotal', 'sellableValue', 'note',
  'saleSentAt', 'kiotStatus', 'status', 'at', 'warning'
]);
// Cot thoi gian duoc phep dung cho bo loc "tu ... den ...".
const DATE_FIELDS = Object.freeze(['saleSentAt', 'at', 'orderDate']);
const SEARCH_MODES = Object.freeze(['code', 'sale', 'customer']);
const BRANCHES = Object.freeze(['HN', 'SG']);
// Mac dinh (khi khong chon cot sap xep): don moi dat nhat truoc.
const DEFAULT_SORT = Object.freeze({ key: 'orderDate', dir: -1 });
// Thu tu hien thi cua bo loc "Trang thai KiotViet"; trang thai la xep sau theo ten.
const KIOT_STATUS_ORDER = Object.freeze(['Phiếu tạm', 'Đã xác nhận', 'Đang giao hàng', 'Hoàn thành', 'Đã hủy']);

function makeError(message, code) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

// Tieng Viet khong dau, chu thuong — cung ham voi normalizeSearchText cua giao dien cu.
function normalizeSearchText(value) {
  return String(value == null ? '' : value)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().trim();
}

/**
 * Doi 1 o thoi gian thanh SO (ms) de sap xep/loc theo thoi gian that. Nhan "dd/MM/yyyy[ HH:mm[:ss]]"
 * (cot cua sheet, ke ca loi go "15,35"), "YYYY-MM-DD[ HH:mm[:ss]]" (lich su cap nhat, o loc ngay).
 * Rong/khong doc duoc -> null (luon xep cuoi bang).
 */
function parseDateTimeValue(value) {
  const text = String(value == null ? '' : value).trim();
  let m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2})[:,h.](\d{2})(?:[:.](\d{2}))?)?/);
  let year;
  let month;
  let day;
  if (m) {
    day = Number(m[1]); month = Number(m[2]); year = Number(m[3]);
  } else {
    m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    year = Number(m[1]); month = Number(m[2]); day = Number(m[3]);
  }
  const ms = Date.UTC(year, month - 1, day, Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  return Number.isNaN(ms) ? null : ms;
}

// Nhieu ma cach nhau khoang trang, chuan hoa + loai trung.
function parseSearchCodes(value) {
  const normalized = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const seen = new Set();
  return normalized.split(' ').filter(Boolean).map(normalizeSearchText).filter(code => {
    if (!code || seen.has(code)) return false;
    seen.add(code);
    return true;
  });
}

/** 'YYYY-MM-DD' co that (khong tran sang thang/ngay khac, vd 2026-13-45 hay 2026-02-31 bi tu choi). */
function isIsoDay(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function pickString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Chuan hoa tham so tu query string (GET) hoac body (POST /export). Gia tri sai kieu liet ke cung
 * -> 400 kem ma loi; chuoi tim kiem/bo loc tu do khong khop thi chi cho ket qua rong.
 */
function parseParams(input) {
  const raw = input || {};
  const branch = pickString(raw.branch);
  if (branch && !BRANCHES.includes(branch)) {
    throw makeError('Tham số "branch" phải là "HN" hoặc "SG".', 'INVALID_BRANCH');
  }
  const dateField = pickString(raw.dateField) || 'saleSentAt';
  if (!DATE_FIELDS.includes(dateField)) {
    throw makeError('Cột thời gian lọc không hợp lệ.', 'INVALID_DATE_FIELD');
  }
  const mode = pickString(raw.mode) || 'code';
  if (!SEARCH_MODES.includes(mode)) {
    throw makeError('Kiểu tìm kiếm không hợp lệ.', 'INVALID_SEARCH_MODE');
  }
  const from = pickString(raw.from);
  const to = pickString(raw.to);
  [from, to].forEach(day => {
    if (day && !isIsoDay(day)) throw makeError('Ngày lọc phải có dạng YYYY-MM-DD.', 'INVALID_DATE');
  });
  const sort = pickString(raw.sort);
  if (sort && !SORT_KEYS.includes(sort)) {
    throw makeError('Cột sắp xếp không hợp lệ.', 'INVALID_SORT');
  }
  const dir = pickString(raw.dir).toLowerCase();
  if (dir && dir !== 'asc' && dir !== 'desc') {
    throw makeError('Chiều sắp xếp phải là "asc" hoặc "desc".', 'INVALID_SORT');
  }
  const page = Math.floor(Number(raw.page));
  const pageSize = Math.floor(Number(raw.pageSize));
  return {
    branch,
    status: pickString(raw.status),
    kiotStatus: pickString(raw.kiotStatus),
    dateField,
    from,
    to,
    mode,
    q: typeof raw.q === 'string' ? raw.q.slice(0, 500) : '',
    // Khong chon cot -> mac dinh (don moi dat nhat truoc); chon cot ma khong co chieu -> tang dan.
    sort: sort || DEFAULT_SORT.key,
    dir: dir === 'desc' ? -1 : (dir === 'asc' ? 1 : (sort ? 1 : DEFAULT_SORT.dir)),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE
  };
}

// Bo nho dem khoa chuan hoa theo dong (khong sua doi tuong dong, khong dinh vao JSON tra ve).
const keyMemo = new WeakMap();
function memoKey(row, name, compute) {
  let keys = keyMemo.get(row);
  if (!keys) { keys = {}; keyMemo.set(row, keys); }
  if (!(name in keys)) keys[name] = compute(row);
  return keys[name];
}

function hasKiotOrder(row) {
  return !!row.kiotStatus;
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Gia tri sap xep cua tung cot — null/undefined LUON nam cuoi du tang hay giam dan.
const SORT_VALUE = {
  orderCode: row => memoKey(row, 'code', r => normalizeSearchText(r.orderCode)),
  branch: row => row.branch || null,
  orderDate: row => memoKey(row, 'orderDate', r => parseDateTimeValue(r.orderDate)),
  saleName: row => memoKey(row, 'sale', r => normalizeSearchText(r.saleName)),
  customerName: row => memoKey(row, 'customer', r => normalizeSearchText(r.customerName)),
  orderTotal: row => (hasKiotOrder(row) ? finiteOrNull(row.orderTotal) : null),
  sellableValue: row => (hasKiotOrder(row) ? finiteOrNull(row.sellableValue) : null),
  note: row => memoKey(row, 'note', r => normalizeSearchText(r.note) || null),
  saleSentAt: row => memoKey(row, 'saleSentAt', r => parseDateTimeValue(r.saleSentAt)),
  kiotStatus: row => memoKey(row, 'kiotStatus', r => normalizeSearchText(r.kiotStatus) || null),
  status: row => memoKey(row, 'status', r => normalizeSearchText(r.summary && r.summary.label)),
  at: row => memoKey(row, 'at', r => parseDateTimeValue(r.summary && r.summary.at)),
  warning: row => (row.warning ? 1 : 0)
};

function compareValues(a, b, dir) {
  const aEmpty = a === null || a === undefined;
  const bEmpty = b === null || b === undefined;
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : (aEmpty ? 1 : -1);
  if (a < b) return -1 * dir;
  if (a > b) return 1 * dir;
  return 0;
}

/** Sap xep BEN VUNG (cung gia tri giu thu tu goc); moi dong chi tinh gia tri sap xep 1 lan. */
function sortRows(rows, key, dir) {
  const valueOf = SORT_VALUE[key] || SORT_VALUE[DEFAULT_SORT.key];
  const decorated = rows.map((row, index) => ({ row, index, value: valueOf(row) }));
  decorated.sort((a, b) => compareValues(a.value, b.value, dir) || (a.index - b.index));
  return decorated.map(item => item.row);
}

/** Don cua co so da chon (hoac tat ca) — dung de dem "tong so don" truoc khi ap cac bo loc khac. */
function rowsInBranch(rows, branch) {
  return branch ? rows.filter(row => row.branch === branch) : rows;
}

function filterRows(rows, params) {
  const { status, kiotStatus, from, to, dateField, mode, q } = params;
  const codes = mode === 'code' ? parseSearchCodes(q) : [];
  const text = mode === 'code' ? '' : normalizeSearchText(q);
  const textKey = mode === 'sale' ? SORT_VALUE.saleName : SORT_VALUE.customerName;
  const fromMs = from ? parseDateTimeValue(from) : null;
  // Ngay "den" tinh het ngay (23:59:59) de bao gom don trong ngay do.
  const toMs = to ? parseDateTimeValue(to) + DAY_MS - 1 : null;
  const dateValue = SORT_VALUE[dateField];
  const needsFilter = codes.length || text || status || kiotStatus || fromMs !== null || toMs !== null;
  if (!needsFilter) return rows;
  return rows.filter(row => {
    if (codes.length) {
      const code = SORT_VALUE.orderCode(row);
      if (!codes.some(item => code.includes(item))) return false;
    }
    if (text && !String(textKey(row)).includes(text)) return false;
    if (status && !(row.summary && row.summary.code === status)) return false;
    if (kiotStatus && row.kiotStatus !== kiotStatus) return false;
    if (fromMs !== null || toMs !== null) {
      const time = dateValue(row);
      if (time === null) return false; // chua co moc thoi gian nay thi khong nam trong khoang da chon
      if (fromMs !== null && time < fromMs) return false;
      if (toMs !== null && time > toMs) return false;
    }
    return true;
  });
}

/** Danh sach TRANG THAI KIOT co mat trong cac don (cho o loc), theo thu tu quen thuoc roi theo ten. */
function distinctKiotStatuses(rows) {
  const seen = new Set();
  rows.forEach(row => { if (row.kiotStatus) seen.add(row.kiotStatus); });
  const rank = value => {
    const index = KIOT_STATUS_ORDER.indexOf(value);
    return index === -1 ? KIOT_STATUS_ORDER.length : index;
  };
  return [...seen].sort((a, b) => (rank(a) - rank(b)) || a.localeCompare(b, 'vi'));
}

/** Loc roi sap xep TOAN BO danh sach (chua cat trang) — dung chung cho trang xem va xuat Excel. */
function selectRows(rows, params) {
  return sortRows(filterRows(rowsInBranch(rows, params.branch), params), params.sort, params.dir);
}

function paginate(rows, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * pageSize;
  return { items: rows.slice(start, start + pageSize), page: current, pageSize, totalPages };
}

/**
 * Bo nho dem KET QUA loc + sap xep (chua cat trang) de lat trang khong phai sap xep lai ~60 nghin
 * dong. Gan voi MANG dong nguon: nguon doi (du lieu moi) thi bo het.
 */
function createSelectionCache(limit = 6) {
  let source = null;
  const entries = new Map();
  return {
    select(rows, params) {
      if (rows !== source) { source = rows; entries.clear(); }
      const key = JSON.stringify([
        params.branch, params.status, params.kiotStatus, params.dateField, params.from, params.to,
        params.mode, params.q, params.sort, params.dir
      ]);
      if (entries.has(key)) {
        const hit = entries.get(key);
        entries.delete(key); // dua len cuoi (gan day nhat)
        entries.set(key, hit);
        return hit;
      }
      const selected = selectRows(rows, params);
      entries.set(key, selected);
      if (entries.size > limit) entries.delete(entries.keys().next().value);
      return selected;
    }
  };
}

module.exports = {
  DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, SORT_KEYS, DATE_FIELDS, SEARCH_MODES, DEFAULT_SORT,
  normalizeSearchText, parseDateTimeValue, parseSearchCodes,
  parseParams, rowsInBranch, filterRows, sortRows, selectRows, paginate, distinctKiotStatuses,
  createSelectionCache
};
