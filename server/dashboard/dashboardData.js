// ==========================================
// DASHBOARD DATA — cung cap du lieu cho Web App (GET /api/dashboard)
// Doc tu sheet KiotViet export 9-tab (dong bo boi cac module Apps Script trong src/)
// ==========================================
const CONFIG = require('../config');
const sheetsClient = require('../sheets/sheetsClient');
const { parseDebtSheet } = require('./debtReport');

const OUT_OF_STOCK_LEVEL = 0;
const TOP_SELLING_LIMIT = 10;
const NEWLY_IMPORTED_REVENUE_LIMIT = 15;
const MAX_PARENT_CATEGORY_BARS = 30;
const NEW_PURCHASES_SUPPLIER_LIMIT = 30; // top NCC cho bieu do 2 cot
const SEARCH_CACHE_TTL_MS = 2 * 60 * 1000;
const DASHBOARD_SHEETS_CACHE_TTL_MS = 90 * 1000;
const PENDING_ORDER_STATUSES = new Set(['Phiếu tạm', 'Đang xử lý', 'Đã xác nhận']);
const DASHBOARD_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const DASHBOARD_UTC_OFFSET = '+07:00';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 3660; // ~10 nam — chan vong lap tao bucket ngay bi vo tan/qua lon
const MAX_REPORT_TRANSACTIONS = 500; // gioi han so dong bang "Chi tiet giao dich" khi loc ca ky dai
const TOP_REPORT_TRANSACTIONS = 15;
const TOP_CUSTOMER_REVENUE_CHART_LIMIT = 15;
const TOP_CUSTOMER_REVENUE_TABLE_LIMIT = 50;

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: DASHBOARD_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});

function getDashboardDateParts(date) {
  return Object.fromEntries(
    DATE_TIME_FORMATTER.formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
}

function formatDMY(date) {
  const { day, month, year } = getDashboardDateParts(date);
  return `${day}/${month}/${year}`;
}

function formatDMYHMS(date) {
  const { day, month, year, hour, minute, second } = getDashboardDateParts(date);
  return `${day}/${month}/${year} ${hour}:${minute}:${second}`;
}

function formatHM(date) {
  const { hour, minute } = getDashboardDateParts(date);
  return `${hour}:${minute}`;
}

function formatDMYHM(date) {
  const { day, month, hour, minute } = getDashboardDateParts(date);
  return `${day}/${month} ${hour}:${minute}`;
}

function parseDashboardWallTime(yyyy, MM, dd, hh = '0', mi = '0', ss = '0') {
  const pad = value => String(value).padStart(2, '0');
  const expected = `${pad(dd)}/${pad(MM)}/${yyyy} ${pad(hh)}:${pad(mi)}:${pad(ss)}`;
  const iso = `${yyyy}-${pad(MM)}-${pad(dd)}T${pad(hh)}:${pad(mi)}:${pad(ss)}${DASHBOARD_UTC_OFFSET}`;
  const date = new Date(iso);
  return !isNaN(date.getTime()) && formatDMYHMS(date) === expected ? date : null;
}

/**
 * Parse gia tri ngay do Sheets API tra ve (thuong la chuoi da format theo
 * number-format cua o, dang "dd/MM/yyyy HH:mm:ss"). Khong bao gio throw —
 * tra null neu khong doc duoc, de goi noi bo qua thay vi lam vo ca dashboard.
 */
function parseSheetDate(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;

  if (typeof raw === 'number') {
    const wallTime = new Date(Math.round((raw - 25569) * DAY_MS));
    if (isNaN(wallTime.getTime())) return null;
    return parseDashboardWallTime(
      wallTime.getUTCFullYear(),
      wallTime.getUTCMonth() + 1,
      wallTime.getUTCDate(),
      wallTime.getUTCHours(),
      wallTime.getUTCMinutes(),
      wallTime.getUTCSeconds()
    );
  }

  const str = String(raw).trim();
  if (!str) return null;

  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, dd, MM, yyyy, hh = '0', mi = '0', ss = '0'] = m;
    if (Number(yyyy) > 1990) return parseDashboardWallTime(yyyy, MM, dd, hh, mi, ss);
  }

  // Chuoi ISO khong kem offset cung la gio Viet Nam tu Google Sheets (va cung
  // la dinh dang <input type="date"> gui len tu bo loc "Tuy chinh" o client).
  const isoLocal = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (isoLocal) {
    const [, yyyy, MM, dd, hh = '0', mi = '0', ss = '0'] = isoLocal;
    if (Number(yyyy) > 1990) return parseDashboardWallTime(yyyy, MM, dd, hh, mi, ss);
  }

  const d2 = new Date(str);
  const dashboardYear = !isNaN(d2.getTime()) ? Number(getDashboardDateParts(d2).year) : 0;
  if (dashboardYear > 1990 && dashboardYear < 2100) return d2;

  return null;
}

function dmyKey(date) {
  return formatDMY(date);
}

function startOfDay(date) {
  const { day, month, year } = getDashboardDateParts(date);
  return parseDashboardWallTime(year, month, day, 0, 0, 0);
}

function endOfDay(date) {
  const { day, month, year } = getDashboardDateParts(date);
  return parseDashboardWallTime(year, month, day, 23, 59, 59);
}

/**
 * Quy doi 1 bo loc thoi gian tu client ({mode, days, from, to}) thanh khoang
 * ngay cu the. mode: 'days' (N ngay gan nhat, ke ca hom nay) | 'range' (tuy
 * chinh tu ngay...den ngay...) | 'all' (khong gioi han — bo qua moi dieu kien
 * ngay thang). Khong bao gio throw: bo loc "range" thieu/sai dinh dang duoc
 * coi nhu "all" de dashboard khong bi trong thay vi bao loi.
 */
function resolveFilterRange(spec, now) {
  const raw = spec || {};
  const mode = raw.mode === 'range' || raw.mode === 'all' ? raw.mode : 'days';

  if (mode === 'all') {
    return { mode: 'all', start: null, end: null, label: 'Tất cả' };
  }

  if (mode === 'range') {
    const fromDate = raw.from ? parseSheetDate(raw.from) : null;
    const toDate = raw.to ? parseSheetDate(raw.to) : null;
    if (!fromDate || !toDate) {
      return { mode: 'all', start: null, end: null, label: 'Tất cả' };
    }
    let start = startOfDay(fromDate);
    let end = endOfDay(toDate);
    if (start.getTime() > end.getTime()) {
      start = startOfDay(toDate);
      end = endOfDay(fromDate);
    }
    if ((end.getTime() - start.getTime()) / DAY_MS > MAX_RANGE_DAYS) {
      end = endOfDay(new Date(start.getTime() + MAX_RANGE_DAYS * DAY_MS));
    }
    return { mode: 'range', start, end, label: `${formatDMY(start)} – ${formatDMY(end)}` };
  }

  const days = Math.min(Math.max(Number(raw.days) || 30, 1), MAX_RANGE_DAYS);
  const end = endOfDay(now);
  const start = startOfDay(new Date(now.getTime() - (days - 1) * DAY_MS));
  return { mode: 'days', days, start, end, label: `${days} ngày` };
}

function isWithinRange(date, range) {
  if (range.mode === 'all') return true;
  if (!date) return false;
  const t = date.getTime();
  return t >= range.start.getTime() && t <= range.end.getTime();
}

// true khi khoang loc chi gom dung 1 ngay (vd "1 ngày", hoac tuy chinh tu ngay = den ngay)
function isSingleDayRange(range) {
  return range.mode !== 'all' && formatDMY(range.start) === formatDMY(range.end);
}

function normalizeCategoryName(value) {
  return String(value || '').trim().toLocaleLowerCase('vi-VN');
}

function isVatProductCode(value) {
  return String(value || '').trim().toUpperCase().startsWith('VAT');
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function buildParentCategoryResolver(categoryData) {
  const categoriesById = new Map();
  const categoriesByName = new Map();

  for (let r = 1; r < categoryData.length; r++) {
    const row = categoryData[r];
    const id = String(row[0] || '').trim();
    const name = String(row[1] || '').trim();
    const parentId = String(row[2] || '').trim();
    if (!id || !name) continue;
    const category = { id, name, parentId };
    categoriesById.set(id, category);
    const normalizedName = normalizeCategoryName(name);
    if (!categoriesByName.has(normalizedName)) categoriesByName.set(normalizedName, []);
    categoriesByName.get(normalizedName).push(category);
  }

  const rootCache = new Map();
  function findRoot(category) {
    if (rootCache.has(category.id)) return rootCache.get(category.id);
    const visited = new Set();
    let current = category;

    while (current) {
      // Chỉ các dòng để trống "Mã nhóm cha" mới là nhóm cha gốc.
      if (!current.parentId) {
        rootCache.set(category.id, current);
        return current;
      }
      if (visited.has(current.id)) break;
      visited.add(current.id);
      current = categoriesById.get(current.parentId);
    }

    rootCache.set(category.id, null);
    return null;
  }

  return function resolveParentCategory(categoryName, categoryId) {
    const id = String(categoryId || '').trim();
    const candidates = id && categoriesById.has(id)
      ? [categoriesById.get(id)]
      : (categoriesByName.get(normalizeCategoryName(categoryName)) || []);
    if (!candidates.length) return 'Chưa xác định';

    const roots = new Map();
    candidates.forEach(category => {
      const root = findRoot(category);
      if (root) roots.set(root.id, root);
    });
    return roots.size === 1 ? roots.values().next().value.name : 'Chưa xác định';
  };
}

function limitParentCategoryBars(categories) {
  if (categories.length <= MAX_PARENT_CATEGORY_BARS) return categories;

  const visibleCategories = categories.slice(0, MAX_PARENT_CATEGORY_BARS - 1);
  const remainingCategories = categories.slice(MAX_PARENT_CATEGORY_BARS - 1);
  return visibleCategories.concat({
    name: `Khác (${remainingCategories.length} nhóm)`,
    stockValue: remainingCategories.reduce((sum, category) => sum + category.stockValue, 0),
    stock: remainingCategories.reduce((sum, category) => sum + category.stock, 0),
    productCount: remainingCategories.reduce((sum, category) => sum + category.productCount, 0)
  });
}

const SHEET_NAMES = [
  CONFIG.SHEET_CATEGORIES,
  CONFIG.SHEET_PRODUCTS,
  CONFIG.SHEET_INVOICES,
  CONFIG.SHEET_INVOICE_DETAILS,
  CONFIG.SHEET_ORDERS,
  CONFIG.SHEET_RETURNS,
  CONFIG.SHEET_CUSTOMERS,
  CONFIG.SHEET_SUPPLIERS,
  CONFIG.SHEET_PURCHASES,
  CONFIG.SHEET_DEACTIVATED_TODAY,
  CONFIG.SHEET_CUSTOMER_REPORT
];

// HN1/HN3/HN7 do KiotViet tu quan ly; gop vao cung 1 lan batchGet de khong
// tang so request goi Google Sheets API. Server CHI DOC, khong bao gio ghi.
const DEBT_SHEETS = [
  { period: 1, name: CONFIG.SHEET_DEBT_1 },
  { period: 3, name: CONFIG.SHEET_DEBT_3 },
  { period: 7, name: CONFIG.SHEET_DEBT_7 }
];

const SEARCH_SOURCES = {
  products: {
    label: CONFIG.SHEET_PRODUCTS,
    sheetName: CONFIG.SHEET_PRODUCTS,
    codeIndex: 0,
    nameIndex: 1
  },
  invoices: {
    label: CONFIG.SHEET_INVOICES,
    sheetName: CONFIG.SHEET_INVOICES,
    codeIndex: 0,
    nameIndex: 2
  },
  orders: {
    label: CONFIG.SHEET_ORDERS,
    sheetName: CONFIG.SHEET_ORDERS,
    codeIndex: 0,
    nameIndex: 2
  },
  returns: {
    label: CONFIG.SHEET_RETURNS,
    sheetName: CONFIG.SHEET_RETURNS,
    codeIndex: 0,
    nameIndex: 3
  },
  customers: {
    label: CONFIG.SHEET_CUSTOMERS,
    sheetName: CONFIG.SHEET_CUSTOMERS,
    codeIndex: 0,
    nameIndex: 1
  },
  suppliers: {
    label: CONFIG.SHEET_SUPPLIERS,
    sheetName: CONFIG.SHEET_SUPPLIERS,
    codeIndex: 0,
    nameIndex: 1
  },
  purchases: {
    label: CONFIG.SHEET_PURCHASES,
    sheetName: CONFIG.SHEET_PURCHASES,
    // Sheet "Nhập hàng" da doi sang cap dong hang (xem PURCHASE_SHEET_HEADERS
    // trong SheetSchemas.gs) nen cot khong con o vi tri co dinh — uu tien tim
    // theo TEN COT, codeIndex/nameIndex chi la fallback neu khong tim thay header.
    codeHeader: 'Mã nhập hàng',
    nameHeader: 'Tên nhà cung cấp',
    codeIndex: 0,
    nameIndex: 2
  }
};

const SEARCH_SCOPES = {
  overview: ['products', 'invoices', 'orders', 'returns', 'customers', 'suppliers', 'purchases'],
  products: ['products'],
  invoices: ['invoices', 'orders', 'returns'],
  customers: ['customers'],
  suppliers: ['suppliers', 'purchases']
};
const SEARCH_SHEET_NAMES = [...new Set(
  Object.values(SEARCH_SOURCES).map(source => source.sheetName)
)];

let searchSheetCache = {
  data: null,
  expiresAt: 0,
  loading: null
};

function normalizeWhitespace(value) {
  return String(value === undefined || value === null ? '' : value)
    .normalize('NFKC')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeSearchValue(value) {
  return normalizeWhitespace(value)
    // NFC keeps Vietnamese diacritics comparable even when the source and the
    // query use different Unicode representations (for example, "a" + a tone
    // mark versus the precomposed character). Case is intentionally ignored.
    .normalize('NFC')
    .toLocaleLowerCase('vi-VN');
}

function compactSearchValue(value) {
  return value.replace(/\s/gu, '');
}

function buildSearchIndex(sheets) {
  const sources = {};

  Object.entries(SEARCH_SOURCES).forEach(([sourceKey, source], sourceOrder) => {
    const rows = sheets[source.sheetName] || [];
    const headers = rows[0] || [];
    const records = [];

    const headerCodeIndex = source.codeHeader
      ? headers.findIndex(header => String(header || '').trim() === source.codeHeader)
      : -1;
    const headerNameIndex = source.nameHeader
      ? headers.findIndex(header => String(header || '').trim() === source.nameHeader)
      : -1;
    const codeIndex = headerCodeIndex >= 0 ? headerCodeIndex : source.codeIndex;
    const nameIndex = headerNameIndex >= 0 ? headerNameIndex : source.nameIndex;

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex] || [];
      const code = normalizeWhitespace(row[codeIndex]);
      const name = normalizeWhitespace(row[nameIndex]);
      if (!code && !name) continue;
      if (sourceKey === 'products' && isVatProductCode(code)) continue;

      const normalizedCode = normalizeSearchValue(code);
      const normalizedName = normalizeSearchValue(name);
      records.push({
        row,
        rowIndex,
        code,
        name: name || code,
        normalizedCode,
        normalizedName,
        compactCode: compactSearchValue(normalizedCode),
        compactName: compactSearchValue(normalizedName)
      });
    }

    sources[sourceKey] = { source, sourceOrder, headers, records };
  });

  return sources;
}

function rememberSearchSheets(sheets) {
  // Normalizing every cell and serializing every field on each keystroke was
  // the hot path for large product sheets. Build the reusable search index when
  // the Sheets cache changes instead.
  searchSheetCache.data = buildSearchIndex(sheets);
  searchSheetCache.expiresAt = Date.now() + SEARCH_CACHE_TTL_MS;
}

async function getSearchSheets() {
  if (searchSheetCache.data && Date.now() < searchSheetCache.expiresAt) {
    return searchSheetCache.data;
  }
  if (searchSheetCache.loading) return searchSheetCache.loading;

  const loading = sheetsClient.getMultipleSheetValues(SEARCH_SHEET_NAMES)
    .then(sheets => {
      rememberSearchSheets(sheets);
      return searchSheetCache.data;
    })
    .finally(() => {
      if (searchSheetCache.loading === loading) searchSheetCache.loading = null;
    });
  searchSheetCache.loading = loading;
  return loading;
}

function getSearchMatchRank(record, query) {
  const { normalizedCode: code, normalizedName: name, compactCode, compactName } = record;
  const { value, compactValue, tokens } = query;
  if (code === value) return 0;
  if (name === value) return 1;
  if (compactCode === compactValue) return 2;
  if (compactName === compactValue) return 3;
  if (code.startsWith(value)) return 4;
  if (name.startsWith(value)) return 5;
  if (compactCode.startsWith(compactValue)) return 6;
  if (compactName.startsWith(compactValue)) return 7;
  if (code.includes(value)) return 8;
  if (name.includes(value)) return 9;
  if (compactCode.includes(compactValue)) return 10;
  if (compactName.includes(compactValue)) return 11;
  if (tokens.length > 1 && tokens.every(token => code.includes(token))) return 12;
  if (tokens.length > 1 && tokens.every(token => name.includes(token))) return 13;
  return -1;
}

function buildSearchFields(headers, row) {
  const fieldCount = Math.max(headers.length, row.length);
  const fields = [];
  for (let index = 0; index < fieldCount; index++) {
    const header = normalizeWhitespace(headers[index]) || `Cột ${index + 1}`;
    const rawValue = row[index];
    fields.push({
      label: header,
      value: rawValue === undefined || rawValue === null || rawValue === '' ? '—' : normalizeWhitespace(rawValue)
    });
  }
  return fields;
}

/**
 * Tim ban ghi co ma hoac ten chua tu khoa trong pham vi dashboard hien tai.
 * Uu tien: trung hoan toan, trung tien to, chua cum tu, roi den du cac tu don.
 * Ket qua kem toan bo cot cua dong nguon de giao dien hien thi dung nhu Sheet.
 */
async function searchDashboardRecords(view, rawQuery, rawLimit) {
  const scope = SEARCH_SCOPES[view] || SEARCH_SCOPES.overview;
  const queryText = normalizeWhitespace(rawQuery).slice(0, 120);
  const normalizedQuery = normalizeSearchValue(queryText);
  const query = {
    value: normalizedQuery,
    compactValue: compactSearchValue(normalizedQuery),
    tokens: normalizedQuery.split(' ').filter(Boolean)
  };
  const wantsAllResults = String(rawLimit || '').toLocaleLowerCase('vi-VN') === 'all';
  const limit = wantsAllResults ? null : Math.min(Math.max(Number(rawLimit) || 8, 1), 50);
  if (!query.value) return { view, query: queryText, total: 0, results: [] };

  const indexedSources = await getSearchSheets();
  const matches = [];

  scope.forEach(sourceKey => {
    const indexedSource = indexedSources[sourceKey];
    if (!indexedSource) return;

    indexedSource.records.forEach(record => {
      const rank = getSearchMatchRank(record, query);
      if (rank < 0) return;

      matches.push({
        indexedSource,
        record,
        source: sourceKey,
        _rank: rank,
        _sourceOrder: indexedSource.sourceOrder
      });
    });
  });

  matches.sort((a, b) =>
    a._rank - b._rank ||
    a._sourceOrder - b._sourceOrder ||
    a.record.code.localeCompare(b.record.code, 'vi', { numeric: true, sensitivity: 'base' }) ||
    a.record.name.localeCompare(b.record.name, 'vi', { sensitivity: 'base' })
  );

  return {
    view,
    query: queryText,
    total: matches.length,
    results: (limit === null ? matches : matches.slice(0, limit))
      .map(({ indexedSource, record, source, _rank, _sourceOrder }) => ({
        id: `${source}:${record.rowIndex + 1}`,
        source,
        sourceLabel: indexedSource.source.label,
        code: record.code,
        name: record.name,
        fields: buildSearchFields(indexedSource.headers, record.row)
      }))
  };
}

// ---------- Cache ngan han cho du lieu tho doc tu Google Sheet ----------
// Truoc day moi lan goi /api/dashboard deu batchGet lai TOAN BO cac sheet.
// Gio moi tab co bo loc rieng nen client co the goi API thuong xuyen hon han
// (moi lan doi bo loc o bat ky tab nao) — cache vai chuc giay de tranh dam
// vao han muc Google Sheets API; tinh toan loc theo ngay van chay tren du
// lieu da cache nen van nhanh va luon phan anh dung bo loc moi nhat.
let dashboardSheetsCache = {
  data: null,
  expiresAt: 0,
  loading: null
};

async function getCachedDashboardSheets() {
  if (dashboardSheetsCache.data && Date.now() < dashboardSheetsCache.expiresAt) {
    return dashboardSheetsCache.data;
  }
  if (dashboardSheetsCache.loading) return dashboardSheetsCache.loading;

  const debtSheetNames = DEBT_SHEETS.map(entry => entry.name);
  const loading = sheetsClient.getMultipleSheetValues(SHEET_NAMES.concat(debtSheetNames))
    .then(sheets => {
      dashboardSheetsCache.data = sheets;
      dashboardSheetsCache.expiresAt = Date.now() + DASHBOARD_SHEETS_CACHE_TTL_MS;
      return sheets;
    })
    .finally(() => {
      if (dashboardSheetsCache.loading === loading) dashboardSheetsCache.loading = null;
    });
  dashboardSheetsCache.loading = loading;
  return loading;
}

/**
 * Gop cac hoa don trong `records` thanh chuoi doanh thu theo ngay trong
 * `range`. Voi "Tat ca" (khong gioi han), bucket theo tung ngay THUC SU CO
 * hoa don thay vi dien du moi ngay lich (tranh bieu do qua dai/rong khi du
 * lieu trai dai nhieu nam).
 */
function buildRevenuePeriod(range, invoiceRecords) {
  const completed = invoiceRecords.filter(r => r.isCompleted && r._dt && isWithinRange(r._dt, range));
  const dayBuckets = {};
  const dayOrder = [];

  if (range.mode === 'all') {
    completed
      .slice()
      .sort((a, b) => a._sortTime - b._sortTime)
      .forEach(r => {
        if (!dayBuckets[r._dateKey]) {
          dayBuckets[r._dateKey] = { revenue: 0, count: 0 };
          dayOrder.push(r._dateKey);
        }
      });
  } else {
    let cursor = range.start;
    while (cursor.getTime() <= range.end.getTime()) {
      const key = formatDMY(cursor);
      dayBuckets[key] = { revenue: 0, count: 0 };
      dayOrder.push(key);
      cursor = new Date(cursor.getTime() + DAY_MS);
    }
  }

  completed.forEach(r => {
    const bucket = dayBuckets[r._dateKey];
    if (!bucket) return;
    bucket.revenue += r.total;
    bucket.count += 1;
  });

  const revenueByDay = dayOrder.map(key => ({
    date: key,
    label: key.substring(0, 5),
    revenue: dayBuckets[key].revenue,
    count: dayBuckets[key].count
  }));
  const periodRevenue = revenueByDay.reduce((s, d) => s + d.revenue, 0);
  const periodInvoices = revenueByDay.reduce((s, d) => s + d.count, 0);
  return { revenueByDay, periodRevenue, periodInvoices };
}

/**
 * Gop cac dong giao dich trong sheet "Bao cao ban hang" (moi dong la 1 hoa
 * don HOAC 1 phieu tra hang cua 1 khach, xem buildCustomerReportValues_ trong
 * CustomerReport.gs) thanh doanh thu theo tung khach trong `range`. Cot E/H
 * (SL don ban/Doanh thu) trong sheet la tong TOAN THOI GIAN nen khong dung
 * duoc truc tiep — phai tu cong don tu cot M (Thoi gian theo giao dich, index
 * 12) va cot R (Doanh thu theo giao dich, index 17). Quy uoc: doanh thu dong
 * >= 0 la don ban (cong vao saleOrderCount), < 0 la dong tra hang (khong tinh
 * vao saleOrderCount nhung van cong don vao revenue vi cot nay da tru tra
 * hang o tung dong).
 */
function buildTopCustomersByRevenue(range, customerReportData) {
  const customers = new Map();

  for (let r = 1; r < customerReportData.length; r++) {
    const row = customerReportData[r];
    const code = String(row[0] || '').trim();
    const name = String(row[1] || '').trim();
    if (!code && !name) continue;

    const dt = parseSheetDate(row[12]);
    if (!isWithinRange(dt, range)) continue;

    const key = code || ('name:' + name.toLocaleLowerCase('vi-VN'));
    if (!customers.has(key)) {
      customers.set(key, { code: code || '—', name: name || '(Không xác định)', saleOrderCount: 0, revenue: 0 });
    }
    const entry = customers.get(key);
    const revenue = Number(row[17]) || 0;
    entry.revenue += revenue;
    if (revenue >= 0) entry.saleOrderCount += 1;
  }

  const sorted = Array.from(customers.values()).sort((a, b) => b.revenue - a.revenue);

  return {
    label: range.label,
    top15: sorted.slice(0, TOP_CUSTOMER_REVENUE_CHART_LIMIT),
    top50: sorted.slice(0, TOP_CUSTOMER_REVENUE_TABLE_LIMIT)
  };
}

/**
 * Bao cao chi tiet giao dich trong `range` cho tab Tong quan (thay cho khai
 * niem "cuoi ngay" co dinh truoc day). Tong hop (summary) luon tinh tren TOAN
 * BO giao dich trong ky; danh sach chi tiet (transactions) gioi han
 * MAX_REPORT_TRANSACTIONS dong gan nhat de khong lam nang trang khi chon ky dai.
 */
function buildTransactionsReport(range, invoiceRecords, invoiceQuantityMap) {
  const singleDay = isSingleDayRange(range);
  const inRangeRecords = invoiceRecords.filter(r => isWithinRange(r._dt, range));

  const allTransactions = inRangeRecords
    .map(r => {
      const normalizedCode = String(r.code).trim();
      return {
        code: r.code,
        time: r._dt ? (singleDay ? formatHM(r._dt) : formatDMYHM(r._dt)) : '—',
        customer: r.customer,
        employee: r.employee,
        quantity: invoiceQuantityMap.get(normalizedCode) || 0,
        quantityKnown: invoiceQuantityMap.has(normalizedCode),
        revenue: r.total,
        discount: r.discount,
        paid: r.paid,
        status: r.status,
        _sortTime: r._sortTime
      };
    })
    .sort((a, b) => b._sortTime - a._sortTime);

  const completedTransactions = allTransactions.filter(t => t.status === 'Hoàn thành');
  const topTransactions = completedTransactions
    .slice()
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, TOP_REPORT_TRANSACTIONS)
    .map(({ _sortTime, ...rest }) => rest);
  const summary = {
    transactionCount: completedTransactions.length,
    cancelledCount: allTransactions.length - completedTransactions.length,
    quantity: completedTransactions.reduce((s, t) => s + t.quantity, 0),
    quantityKnown: completedTransactions.length > 0 && completedTransactions.every(t => t.quantityKnown),
    revenue: completedTransactions.reduce((s, t) => s + t.revenue, 0),
    discount: completedTransactions.reduce((s, t) => s + t.discount, 0),
    paid: completedTransactions.reduce((s, t) => s + t.paid, 0)
  };

  const transactions = allTransactions
    .slice(0, MAX_REPORT_TRANSACTIONS)
    .map(({ _sortTime, ...rest }) => rest);

  return {
    date: range.label,
    singleDay,
    truncated: allTransactions.length > MAX_REPORT_TRANSACTIONS,
    totalInRange: allTransactions.length,
    transactions,
    topTransactions,
    summary
  };
}

/**
 * Ham chinh lay du lieu cho dashboard.
 * @param {Object} filters - Bo loc rieng cho tung tab. Moi bo loc thoi gian co
 *   dang { mode: 'days'|'range'|'all', days?, from?, to? }; products co them
 *   status: 'all'|'Đang kinh doanh'|'Ngừng kinh doanh'.
 * @returns {Object} Du lieu KPI, bieu do, bang xep hang cho dashboard
 */
async function getDashboardData(filters) {
  const f = filters || {};
  const now = new Date();
  const todayStr = formatDMY(now);

  const overviewRange = resolveFilterRange(f.overview, now);
  const productsRange = resolveFilterRange(f.products, now);
  const productStatusFilter = ['Đang kinh doanh', 'Ngừng kinh doanh'].includes(f.products && f.products.status)
    ? f.products.status
    : 'all';
  const invoicesRange = resolveFilterRange(f.invoices, now);
  const customersRange = resolveFilterRange(f.customers, now);
  const newPurchasesRange = resolveFilterRange(f.newPurchases, now);
  const newProductsRange = resolveFilterRange(f.newProducts, now);
  const deactivatedRange = resolveFilterRange(f.deactivated, now);

  const sheets = await getCachedDashboardSheets();
  rememberSearchSheets(sheets);

  const debt = {};
  DEBT_SHEETS.forEach(entry => {
    debt[entry.period] = parseDebtSheet(sheets[entry.name], now);
  });

  const categoryData = sheets[CONFIG.SHEET_CATEGORIES];
  const prodData = sheets[CONFIG.SHEET_PRODUCTS];
  const invData = sheets[CONFIG.SHEET_INVOICES];
  const detailData = sheets[CONFIG.SHEET_INVOICE_DETAILS];
  const orderData = sheets[CONFIG.SHEET_ORDERS];
  const returnData = sheets[CONFIG.SHEET_RETURNS];
  const custData = sheets[CONFIG.SHEET_CUSTOMERS];
  const customerReportData = sheets[CONFIG.SHEET_CUSTOMER_REPORT] || [];
  const supplierData = sheets[CONFIG.SHEET_SUPPLIERS];
  const poData = sheets[CONFIG.SHEET_PURCHASES];
  const deactivatedData = sheets[CONFIG.SHEET_DEACTIVATED_TODAY];

  // ---------- HÀNG HÓA ----------
  // Cột: [0]Mã hàng [1]Tên hàng [2]Nhóm hàng [3]Thương hiệu [4]Loại [5]Giá vốn [6]Giá bán [7]Tồn kho [8]Khách đặt [9]Trạng thái kinh doanh [10]Ngày sửa cuối [11]Mã nhóm hàng
  // Toan bo phan nay la so lieu TON KHO TAI THOI DIEM HIEN TAI (snapshot) —
  // khong gan voi 1 ngay phat sinh cu the nen KHONG loc theo bo loc thoi gian.
  let totalProducts = 0, totalStock = 0, inStockCodes = 0, activeProducts = 0, inactiveProducts = 0, lowStock = [];
  let stockList = [];
  const parentCategoryMap = {};
  const productParentCategoryByCode = new Map();
  const productStatusByCode = new Map();
  const resolveParentCategory = buildParentCategoryResolver(categoryData);
  const productHeaders = prodData[0] || [];
  const productCategoryIdIndex = productHeaders.findIndex(header => String(header || '').trim() === 'Mã nhóm hàng');
  const productCreatedDateIndex = productHeaders.findIndex(header => String(header || '').trim() === 'Ngày tạo');
  const todayNewProducts = [];

  for (let r = 1; r < prodData.length; r++) {
    const row = prodData[r];
    const code = row[0];
    if (!code || isVatProductCode(code)) continue;
    const ton = Number(row[7]) || 0;
    const cost = Math.max(Number(row[5]) || 0, 0);
    const price = Math.max(Number(row[6]) || 0, 0);
    const stockValue = Math.max(ton, 0) * cost;
    const reserved = Number(row[8]) || 0;
    const status = String(row[9] || 'Đang kinh doanh').trim();
    productStatusByCode.set(String(code).trim(), status);
    const createdAt = productCreatedDateIndex >= 0 ? parseSheetDate(row[productCreatedDateIndex]) : null;
    if (createdAt && isWithinRange(createdAt, newProductsRange)) {
      todayNewProducts.push({
        code,
        name: row[1] || code,
        category: row[2] || 'Chưa phân nhóm',
        createdAt: formatDMYHMS(createdAt),
        cost,
        price,
        _sortTime: createdAt.getTime()
      });
    }
    if (productStatusFilter !== 'all' && status !== productStatusFilter) continue;

    totalProducts++;
    if (status === 'Ngừng kinh doanh') inactiveProducts++; else activeProducts++;
    totalStock += ton;
    if (ton > 0) inStockCodes++;
    stockList.push({ code, name: row[1], stock: ton, reserved, status });
    if (ton === OUT_OF_STOCK_LEVEL) {
      lowStock.push({
        code,
        name: row[1],
        type: row[4] || '—',
        status,
        cost,
        price
      });
    }

    const categoryName = (row[2] && String(row[2]).trim()) || '';
    const categoryId = productCategoryIdIndex >= 0 ? row[productCategoryIdIndex] : '';
    const parentCategoryName = resolveParentCategory(categoryName, categoryId);
    productParentCategoryByCode.set(String(code).trim(), parentCategoryName);
    if (!parentCategoryMap[parentCategoryName]) {
      parentCategoryMap[parentCategoryName] = { name: parentCategoryName, stock: 0, stockValue: 0, productCount: 0 };
    }
    parentCategoryMap[parentCategoryName].stock += Math.max(ton, 0);
    parentCategoryMap[parentCategoryName].stockValue += stockValue;
    parentCategoryMap[parentCategoryName].productCount += 1;
  }
  lowStock.sort((a, b) => a.stock - b.stock);
  todayNewProducts.sort((a, b) => b._sortTime - a._sortTime);
  const todayNewProductRows = todayNewProducts.map(({ _sortTime, ...rest }) => rest);

  // ---------- HÀNG NGỪNG KINH DOANH ----------
  // Tab "Hàng ngừng kinh doanh" do src/kiotviet/DiscontinuedProducts.gs ghi nhan
  // moi khi 1 ma hang chuyen sang "Ngung kinh doanh". Loc lai theo
  // "Ngay sua tren KiotViet" / "Thoi gian phat hien" bang bo loc thoi gian cua tab Tong quan.
  const deactivatedTodayProducts = [];
  if (Array.isArray(deactivatedData) && deactivatedData.length > 1) {
    const deactivatedHeaders = deactivatedData[0] || [];
    const norm = str => String(str || '').toLowerCase().replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    const findCol = (...keywords) => deactivatedHeaders.findIndex(header => {
      const h = norm(header);
      return keywords.some(kw => h.includes(norm(kw)));
    });

    const modifiedAtIndex = findCol('Ngày sửa trên KiotViet', 'Ngày sửa KiotViet', 'Ngày sửa');
    const detectedAtIndex = findCol('Thời gian phát hiện', 'Phát hiện');
    const statusIndex = findCol('Trạng thái hiện tại', 'Trạng thái');
    const codeIndex = findCol('Mã hàng');
    const nameIndex = findCol('Tên hàng');
    const categoryIndex = findCol('Nhóm hàng');

    for (let r = 1; r < deactivatedData.length; r++) {
      const row = deactivatedData[r];
      const code = codeIndex >= 0 ? row[codeIndex] : row[6];
      if (!code) continue;

      const modifiedAtDate = modifiedAtIndex >= 0 ? parseSheetDate(row[modifiedAtIndex]) : null;
      const detectedAtDate = detectedAtIndex >= 0 ? parseSheetDate(row[detectedAtIndex]) : null;
      const eventDate = modifiedAtDate || detectedAtDate || parseSheetDate(row[0]);

      if (!isWithinRange(eventDate, deactivatedRange)) continue;

      let displayDateStr = '';
      if (eventDate) {
        displayDateStr = formatDMYHMS(eventDate);
      } else if (modifiedAtIndex >= 0 && row[modifiedAtIndex]) {
        displayDateStr = String(row[modifiedAtIndex]);
      } else if (detectedAtIndex >= 0 && row[detectedAtIndex]) {
        displayDateStr = String(row[detectedAtIndex]);
      }

      deactivatedTodayProducts.push({
        code,
        name: (nameIndex >= 0 ? row[nameIndex] : row[8]) || code,
        category: (categoryIndex >= 0 ? row[categoryIndex] : row[12]) || 'Chưa phân nhóm',
        status: (statusIndex >= 0 ? row[statusIndex] : row[2]) || 'Ngừng kinh doanh',
        modifiedAt: displayDateStr,
        _sortTime: eventDate ? eventDate.getTime() : 0
      });
    }
  }
  deactivatedTodayProducts.sort((a, b) => b._sortTime - a._sortTime);
  const deactivatedTodayRows = deactivatedTodayProducts.map(({ _sortTime, ...rest }) => rest);

  stockList.sort((a, b) => b.stock - a.stock);

  const allProducts = stockList.map(p => ({
    code: p.code,
    name: p.name,
    stock: p.stock,
    reserved: p.reserved,
    status: p.status,
    pct: totalStock > 0 ? (p.stock / totalStock) * 100 : 0
  }));

  const categoryList = Object.values(parentCategoryMap);
  const stockByCategory = categoryList.filter(category => category.stock > 0).sort((a, b) => b.stock - a.stock);
  const allStockValueByCategory = categoryList
    .filter(category => category.stockValue > 0 || category.stock > 0)
    .sort((a, b) => b.stockValue - a.stockValue || b.stock - a.stock);
  const inventoryValueCategoryCount = allStockValueByCategory.length;
  const totalInventoryValue = allStockValueByCategory.reduce((sum, category) => sum + category.stockValue, 0);
  const stockValueByCategory = limitParentCategoryBars(allStockValueByCategory);

  // ---------- HÀNG MỚI NHẬP (theo bộ lọc Hàng hóa) ----------
  // Lay ngay nhap SOM NHAT cho tung ma hang tu sheet "Nhap hang" (doc theo TEN
  // COT thay vi index cung, vi schema sheet nay da doi sang cap dong hang —
  // xem PURCHASE_SHEET_HEADERS trong SheetSchemas.gs). Mot ma chi xuat hien
  // neu ngay nhap dau tien nam trong khoang cua tab Hang hoa va khop bo loc
  // trang thai kinh doanh dang chon.
  const poHeaders = poData[0] || [];
  const poCodeIndex = poHeaders.findIndex(header => String(header || '').trim() === 'Mã hàng');
  const poNameIndex = poHeaders.findIndex(header => String(header || '').trim() === 'Tên hàng');
  const poTimeIndex = poHeaders.findIndex(header => String(header || '').trim() === 'Thời gian');
  const firstImportByCode = new Map();

  if (poCodeIndex >= 0 && poTimeIndex >= 0) {
    for (let r = 1; r < poData.length; r++) {
      const row = poData[r];
      const code = row[poCodeIndex];
      if (!code || isVatProductCode(code)) continue;
      const importDate = parseSheetDate(row[poTimeIndex]);
      if (!importDate) continue;
      const key = String(code).trim();
      const existing = firstImportByCode.get(key);
      if (!existing || importDate.getTime() < existing.date.getTime()) {
        const name = (poNameIndex >= 0 && row[poNameIndex]) || (existing && existing.name) || code;
        firstImportByCode.set(key, { code, name, date: importDate });
      }
    }
  }

  const newlyImportedProducts = [];
  firstImportByCode.forEach(entry => {
    if (!isWithinRange(entry.date, productsRange)) return;
    const currentProductStatus = productStatusByCode.get(String(entry.code).trim());
    if (productStatusFilter !== 'all' && currentProductStatus !== productStatusFilter) return;
    newlyImportedProducts.push({
      code: entry.code,
      name: entry.name,
      firstImportDate: formatDMY(entry.date),
      _sortTime: entry.date.getTime()
    });
  });
  newlyImportedProducts.sort((a, b) => b._sortTime - a._sortTime);
  const newlyImportedCodeSet = new Set(newlyImportedProducts.map(p => String(p.code).trim()));

  // ---------- HÓA ĐƠN: index 1 lần, dùng lại cho mọi bộ lọc ----------
  // Cột: [0]Mã hóa đơn [1]Ngày bán [2]Khách hàng [3]SĐT khách [4]Nhân viên bán [5]Chi nhánh [6]Tổng tiền hàng [7]Giảm giá [8]Khách đã trả [9]Trạng thái
  // Tong so luong tung hoa don de bao cao co cot SL nhu KiotViet.
  const invoiceQuantityMap = new Map();
  for (let r = 1; r < detailData.length; r++) {
    const invoiceCode = String(detailData[r][0] || '').trim();
    if (!invoiceCode) continue;
    const quantity = Number(detailData[r][3]) || 0;
    invoiceQuantityMap.set(invoiceCode, (invoiceQuantityMap.get(invoiceCode) || 0) + quantity);
  }

  let revenueToday = 0, invoicesToday = 0, cancelledToday = 0;
  const invoiceRecords = [];
  const invoiceIndexByCode = new Map();

  for (let r = 1; r < invData.length; r++) {
    const row = invData[r];
    const code = row[0];
    if (!code) continue;
    const customer = row[2];
    const phone = row[3];
    const employee = row[4];
    const total = Number(row[6]) || 0;
    const discount = Number(row[7]) || 0;
    const paid = Number(row[8]) || 0;
    const status = row[9] || 'Hoàn thành';
    const isCancelled = status === 'Đã hủy';
    const isCompleted = status === 'Hoàn thành';
    const dt = parseSheetDate(row[1]);
    const dateKey = dt ? dmyKey(dt) : '';

    if (dateKey === todayStr && isCompleted) {
      revenueToday += total;
      invoicesToday++;
    }
    if (dateKey === todayStr && isCancelled) cancelledToday++;

    const record = {
      code,
      customer,
      phone,
      employee,
      total,
      discount,
      paid,
      status,
      time: row[1] || '',
      isCancelled,
      isCompleted,
      _dt: dt,
      _dateKey: dateKey,
      _sortTime: dt ? dt.getTime() : 0
    };
    invoiceRecords.push(record);
    invoiceIndexByCode.set(String(code).trim(), record);
  }

  const overviewPeriod = buildRevenuePeriod(overviewRange, invoiceRecords);
  const overviewReport = buildTransactionsReport(overviewRange, invoiceRecords, invoiceQuantityMap);

  const invoicesPeriod = buildRevenuePeriod(invoicesRange, invoiceRecords);
  const periodCancelledInvoices = invoiceRecords.filter(
    record => record.isCancelled && isWithinRange(record._dt, invoicesRange)
  ).length;
  const recentInvoices = invoiceRecords
    .filter(r => isWithinRange(r._dt, invoicesRange))
    .sort((a, b) => b._sortTime - a._sortTime)
    .slice(0, 8)
    .map(r => ({ code: r.code, customer: r.customer, total: r.total, status: r.status, time: r.time }));

  // ---------- CHI TIẾT HÓA ĐƠN -> TOP SẢN PHẨM BÁN CHẠY (theo bộ lọc Hàng hóa) ----------
  // Cột: [0]Mã hóa đơn [1]Mã hàng [2]Tên hàng [3]Số lượng [4]Đơn giá [5]Giảm giá [6]Thành tiền
  const productSalesMap = {};
  const parentCategorySalesMap = {};
  const newlyImportedCategorySalesMap = {};
  const newlyImportedProductSalesMap = new Map();
  for (let r = 1; r < detailData.length; r++) {
    const row = detailData[r];
    const invoiceCode = row[0];
    const code = row[1];
    if (!invoiceCode || !code) continue;
    const invoiceEntry = invoiceIndexByCode.get(String(invoiceCode).trim());
    if (!invoiceEntry || invoiceEntry.isCancelled) continue;
    if (!isWithinRange(invoiceEntry._dt, productsRange)) continue;
    const currentProductStatus = productStatusByCode.get(String(code).trim());
    if (productStatusFilter !== 'all' && currentProductStatus !== productStatusFilter) continue;

    const name = row[2] || code;
    const qty = Number(row[3]) || 0;
    const revenue = Number(row[6]) || 0;
    const trimmedCode = String(code).trim();

    if (!productSalesMap[code]) productSalesMap[code] = { code, name, qty: 0, revenue: 0 };
    productSalesMap[code].qty += qty;
    productSalesMap[code].revenue += revenue;

    const parentCategoryName = productParentCategoryByCode.get(trimmedCode) || 'Chưa xác định';
    if (!parentCategorySalesMap[parentCategoryName]) {
      parentCategorySalesMap[parentCategoryName] = {
        name: parentCategoryName,
        qty: 0,
        revenue: 0,
        productCodes: new Set()
      };
    }
    parentCategorySalesMap[parentCategoryName].qty += qty;
    parentCategorySalesMap[parentCategoryName].revenue += revenue;
    parentCategorySalesMap[parentCategoryName].productCodes.add(trimmedCode);

    if (newlyImportedCodeSet.has(trimmedCode)) {
      if (!newlyImportedProductSalesMap.has(trimmedCode)) {
        newlyImportedProductSalesMap.set(trimmedCode, { code, name, qty: 0, revenue: 0 });
      }
      const newlyImportedProductSale = newlyImportedProductSalesMap.get(trimmedCode);
      newlyImportedProductSale.qty += qty;
      newlyImportedProductSale.revenue += revenue;

      if (!newlyImportedCategorySalesMap[parentCategoryName]) {
        newlyImportedCategorySalesMap[parentCategoryName] = {
          name: parentCategoryName,
          qty: 0,
          revenue: 0,
          productCodes: new Set()
        };
      }
      newlyImportedCategorySalesMap[parentCategoryName].qty += qty;
      newlyImportedCategorySalesMap[parentCategoryName].revenue += revenue;
      newlyImportedCategorySalesMap[parentCategoryName].productCodes.add(trimmedCode);
    }
  }
  const topSellingProducts = Object.values(productSalesMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, TOP_SELLING_LIMIT);
  const topSellingParentCategories = Object.values(parentCategorySalesMap)
    .map(category => ({
      name: category.name,
      qty: category.qty,
      revenue: category.revenue,
      productCount: category.productCodes.size
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, TOP_SELLING_LIMIT);

  const newlyImportedRows = newlyImportedProducts.map(({ _sortTime, ...product }) => {
    const sales = newlyImportedProductSalesMap.get(String(product.code).trim());
    return {
      ...product,
      revenue: sales ? sales.revenue : 0
    };
  });
  const topNewlyImportedByRevenue = Array.from(newlyImportedProductSalesMap.values())
    .filter(product => product.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue || b.qty - a.qty || String(a.name).localeCompare(String(b.name), 'vi'))
    .slice(0, NEWLY_IMPORTED_REVENUE_LIMIT);

  // ---------- HÀNG MỚI NHẬP -> DOANH THU BÁN THỰC TẾ THEO NHÓM HÀNG ----------
  // Chi lay doanh thu cua nhung ma hang co ngay nhap dau tien nam trong productsRange
  // (newlyImportedCodeSet), gop nhom cha, gioi han so lat hien thi tren pie chart.
  const NEWLY_IMPORTED_PIE_LIMIT = 7;
  const newlyImportedByCategoryFull = Object.values(newlyImportedCategorySalesMap)
    .map(category => ({
      name: category.name,
      qty: category.qty,
      revenue: category.revenue,
      productCount: category.productCodes.size
    }))
    .sort((a, b) => b.revenue - a.revenue);
  const newlyImportedByCategory = newlyImportedByCategoryFull.length <= NEWLY_IMPORTED_PIE_LIMIT
    ? newlyImportedByCategoryFull
    : (() => {
        const visible = newlyImportedByCategoryFull.slice(0, NEWLY_IMPORTED_PIE_LIMIT - 1);
        const rest = newlyImportedByCategoryFull.slice(NEWLY_IMPORTED_PIE_LIMIT - 1);
        return visible.concat({
          name: `Khác (${rest.length} nhóm)`,
          qty: rest.reduce((sum, c) => sum + c.qty, 0),
          revenue: rest.reduce((sum, c) => sum + c.revenue, 0),
          productCount: rest.reduce((sum, c) => sum + c.productCount, 0)
        });
      })();
  const newlyImportedSalesRevenue = newlyImportedByCategoryFull.reduce((sum, c) => sum + c.revenue, 0);
  const newlyImportedSalesQty = newlyImportedByCategoryFull.reduce((sum, c) => sum + c.qty, 0);

  // Group newly imported products by parent category (count of products)
  const newlyImportedProductCountMap = {};
  newlyImportedProducts.forEach(product => {
    const parentCategoryName = productParentCategoryByCode.get(String(product.code).trim()) || 'Chưa xác định';
    if (!newlyImportedProductCountMap[parentCategoryName]) {
      newlyImportedProductCountMap[parentCategoryName] = {
        name: parentCategoryName,
        productCount: 0
      };
    }
    newlyImportedProductCountMap[parentCategoryName].productCount++;
  });

  const newlyImportedByProductCountFull = Object.values(newlyImportedProductCountMap)
    .sort((a, b) => b.productCount - a.productCount);

  const newlyImportedByProductCount = newlyImportedByProductCountFull.length <= NEWLY_IMPORTED_PIE_LIMIT
    ? newlyImportedByProductCountFull
    : (() => {
        const visible = newlyImportedByProductCountFull.slice(0, NEWLY_IMPORTED_PIE_LIMIT - 1);
        const rest = newlyImportedByProductCountFull.slice(NEWLY_IMPORTED_PIE_LIMIT - 1);
        return visible.concat({
          name: `Khác (${rest.length} nhóm)`,
          productCount: rest.reduce((sum, c) => sum + c.productCount, 0)
        });
      })();

  // ---------- ĐẶT HÀNG (theo bộ lọc Hóa đơn) ----------
  // Cột: [0]Mã đặt hàng [1]Ngày đặt [2]Khách hàng [3]Nhân viên lập [4]Chi nhánh [5]Tổng tiền [6]Trạng thái
  const orderRecords = [];
  for (let r = 1; r < orderData.length; r++) {
    const row = orderData[r];
    const code = row[0];
    if (!code) continue;
    const dt = parseSheetDate(row[1]);
    orderRecords.push({
      code, date: row[1] || '', customer: row[2], total: Number(row[5]) || 0, status: row[6] || '',
      _dt: dt, _sortTime: dt ? dt.getTime() : 0
    });
  }
  const ordersInRange = orderRecords.filter(o => isWithinRange(o._dt, invoicesRange));
  let pendingOrdersCount = 0, pendingOrdersTotal = 0;
  ordersInRange.forEach(o => {
    if (PENDING_ORDER_STATUSES.has(o.status)) { pendingOrdersCount++; pendingOrdersTotal += o.total; }
  });
  const recentOrders = ordersInRange
    .slice()
    .sort((a, b) => b._sortTime - a._sortTime)
    .slice(0, 8)
    .map(({ _dt, _sortTime, ...rest }) => rest);

  // ---------- TRẢ HÀNG (theo bộ lọc Hóa đơn) ----------
  // Cột: [0]Mã trả hàng [1]Ngày trả [2]Mã hóa đơn gốc [3]Khách hàng [4]Tổng tiền trả [5]Trạng thái
  const returnRecords = [];
  for (let r = 1; r < returnData.length; r++) {
    const row = returnData[r];
    const code = row[0];
    if (!code) continue;
    const dt = parseSheetDate(row[1]);
    returnRecords.push({
      code, date: row[1] || '', originalInvoiceCode: row[2] || '', customer: row[3] || '',
      total: Number(row[4]) || 0, status: row[5] || '',
      _dt: dt, _sortTime: dt ? dt.getTime() : 0
    });
  }
  const returnsInRange = returnRecords.filter(rt => isWithinRange(rt._dt, invoicesRange));
  const returnsCount = returnsInRange.length;
  const totalReturns = returnsInRange.reduce((sum, rt) => sum + rt.total, 0);
  const recentReturns = returnsInRange
    .slice()
    .sort((a, b) => b._sortTime - a._sortTime)
    .slice(0, 8)
    .map(({ _dt, _sortTime, ...rest }) => rest);

  // ---------- KHÁCH HÀNG ----------
  // Cột: [0]Mã khách hàng [1]Tên khách hàng [2]Điện thoại [3]Giới tính [4]Nhóm khách hàng [5]Địa chỉ [6]Email [7]Nợ hiện tại [8]Tổng bán
  // "Nợ hiện tại" là số dư TẠI THỜI ĐIỂM HIỆN TẠI (snapshot) nên KPI tổng
  // (totalCustomers/customersWithDebt/totalDebt) không lọc theo thời gian.
  // Danh sách/biểu đồ khách nợ (topDebt) thì thu hẹp theo khách CÓ hóa đơn
  // hoàn thành trong khoảng đã chọn, kèm doanh thu mua hàng trong kỳ đó —
  // nối bằng số điện thoại vì hóa đơn không lưu mã khách hàng.
  const customerRevenueByPhone = new Map();
  invoiceRecords.forEach(r => {
    if (!r.isCompleted || !isWithinRange(r._dt, customersRange)) return;
    const phoneKey = normalizePhone(r.phone);
    if (!phoneKey) return;
    customerRevenueByPhone.set(phoneKey, (customerRevenueByPhone.get(phoneKey) || 0) + r.total);
  });

  let totalCustomers = 0, customersWithDebt = 0, totalDebt = 0;
  let topDebt = [];

  for (let r = 1; r < custData.length; r++) {
    const row = custData[r];
    const code = row[0];
    if (!code) continue;
    totalCustomers++;
    const debt = Number(row[7]) || 0;
    if (debt > 0) {
      customersWithDebt++;
      totalDebt += debt;
      const phoneKey = normalizePhone(row[2]);
      const periodRevenue = customerRevenueByPhone.get(phoneKey) || 0;
      const includeInPeriod = customersRange.mode === 'all' || customerRevenueByPhone.has(phoneKey);
      if (includeInPeriod) {
        topDebt.push({ code, name: row[1], phone: row[2], debt, periodRevenue });
      }
    }
  }
  topDebt.sort((a, b) => b.debt - a.debt);

  const topCustomersByRevenue = buildTopCustomersByRevenue(customersRange, customerReportData);

  // ---------- NHÀ CUNG CẤP ----------
  // Cột: [0]Mã NCC [1]Tên NCC [2]Điện thoại [3]Email [4]Địa chỉ [5]Nợ cần trả
  let suppliers = [];
  let totalSupplierDebt = 0, suppliersWithDebt = 0;
  for (let r = 1; r < supplierData.length; r++) {
    const row = supplierData[r];
    const code = row[0];
    if (!code) continue;
    const debt = Number(row[5]) || 0;
    if (debt > 0) { suppliersWithDebt++; totalSupplierDebt += debt; }
    suppliers.push({ code, name: row[1], phone: row[2], email: row[3], address: row[4], debt });
  }
  suppliers.sort((a, b) => b.debt - a.debt);
  const totalSuppliers = suppliers.length;

  // ---------- NHẬP HÀNG ----------
  // Sheet "Nhập hàng" da doi sang cap dong hang (moi dong la mot mat hang
  // trong phieu nhap, thong tin phieu duoc lap lai tren moi dong) - doc theo
  // TEN COT thay vi index cung, xem PURCHASE_SHEET_HEADERS trong SheetSchemas.gs.
  // Gom lai theo "Ma nhap hang" de moi phieu chi tinh 1 lan.
  const poOrderCodeIndex = poHeaders.findIndex(header => String(header || '').trim() === 'Mã nhập hàng');
  const poOrderTimeIndex = poHeaders.findIndex(header => String(header || '').trim() === 'Thời gian');
  const poOrderSupplierIndex = poHeaders.findIndex(header => String(header || '').trim() === 'Tên nhà cung cấp');
  const poOrderBranchIndex = poHeaders.findIndex(header => String(header || '').trim() === 'Chi nhánh');
  const poOrderTotalIndex = poHeaders.findIndex(header => String(header || '').trim() === 'Tổng tiền hàng');
  const poOrderStatusIndex = poHeaders.findIndex(header => String(header || '').trim() === 'Trạng thái');

  let purchaseOrdersCount = 0, totalPurchaseSpend = 0;
  const purchaseRecords = [];
  const seenPurchaseOrderCodes = new Set();
  if (poOrderCodeIndex >= 0) {
    for (let r = 1; r < poData.length; r++) {
      const row = poData[r];
      const code = row[poOrderCodeIndex];
      if (!code || seenPurchaseOrderCodes.has(code)) continue;
      seenPurchaseOrderCodes.add(code);
      const dateVal = poOrderTimeIndex >= 0 ? row[poOrderTimeIndex] : '';
      const dt = parseSheetDate(dateVal);
      const total = poOrderTotalIndex >= 0 ? (Number(row[poOrderTotalIndex]) || 0) : 0;
      purchaseOrdersCount++;
      totalPurchaseSpend += total;
      purchaseRecords.push({
        code,
        date: dateVal || '',
        supplier: (poOrderSupplierIndex >= 0 && row[poOrderSupplierIndex]) || '(Không xác định)',
        branch: (poOrderBranchIndex >= 0 && row[poOrderBranchIndex]) || '',
        total,
        status: (poOrderStatusIndex >= 0 && row[poOrderStatusIndex]) || '',
        _dt: dt, _sortTime: dt ? dt.getTime() : 0
      });
    }
  }
  purchaseRecords.sort((a, b) => b._sortTime - a._sortTime);

  // ---------- HÀNG NHẬP (tab Tổng quan) ----------
  // Sheet "Nhập hàng" chỉ có dữ liệu cấp phiếu. Vì vậy "tổng số lượng mã" ở
  // đây là số mã nhập hàng (số phiếu), không phải số mã sản phẩm bên trong.
  // Gộp "hôm nay" + "gần đây" thành 1 danh sách loc theo bo loc thoi gian
  // rieng cua section (mac dinh xem resolveFilterRange), thay vi tach rieng
  // KPI "hôm nay" va bang "khong qua 90 ngay" nhu truoc.
  const newPurchaseOrders = purchaseRecords
    .filter(p => isWithinRange(p._dt, newPurchasesRange))
    .map(({ _dt, _sortTime, ...rest }) => rest);

  const newPurchaseSupplierMap = {};
  newPurchaseOrders.forEach(p => {
    const supplierName = p.supplier || '(Không xác định)';
    if (!newPurchaseSupplierMap[supplierName]) {
      newPurchaseSupplierMap[supplierName] = { name: supplierName, orderCount: 0, total: 0 };
    }
    newPurchaseSupplierMap[supplierName].orderCount += 1;
    newPurchaseSupplierMap[supplierName].total += p.total;
  });
  const newPurchasesBySupplier = Object.values(newPurchaseSupplierMap)
    .sort((a, b) => b.total - a.total)
    .slice(0, NEW_PURCHASES_SUPPLIER_LIMIT);

  const newPurchasesOrderCount = newPurchaseOrders.length;
  const newPurchasesTotalAmount = newPurchaseOrders.reduce((sum, p) => sum + p.total, 0);
  const newPurchasesSupplierCount = Object.keys(newPurchaseSupplierMap).length;

  return {
    updatedAt: formatDMYHMS(now),
    filters: {
      overview: overviewRange,
      products: productsRange,
      productStatus: productStatusFilter,
      invoices: invoicesRange,
      customers: customersRange,
      newPurchases: newPurchasesRange,
      newProducts: newProductsRange,
      deactivated: deactivatedRange
    },
    kpi: {
      revenueToday,
      invoicesToday,
      cancelledToday,
      totalProducts,
      totalStock,
      inStockCodes,
      activeProducts,
      inactiveProducts,
      lowStockCount: lowStock.length,
      totalInventoryValue,
      inventoryValueCategoryCount,
      totalCustomers,
      customersWithDebt,
      totalDebt,
      totalSuppliers,
      suppliersWithDebt,
      totalSupplierDebt,
      purchaseOrdersCount,
      totalPurchaseSpend,
      newPurchasesOrderCount,
      newPurchasesTotalAmount,
      newPurchasesSupplierCount
    },
    overview: {
      revenueByDay: overviewPeriod.revenueByDay,
      periodRevenue: overviewPeriod.periodRevenue,
      periodInvoices: overviewPeriod.periodInvoices,
      endOfDayReport: overviewReport,
      todayNewProducts: {
        label: newProductsRange.label,
        count: todayNewProductRows.length,
        dateColumnAvailable: productCreatedDateIndex >= 0,
        products: todayNewProductRows
      },
      deactivatedToday: {
        label: deactivatedRange.label,
        count: deactivatedTodayRows.length,
        products: deactivatedTodayRows
      }
    },
    products: {
      topSellingProducts,
      topSellingParentCategories,
      newlyImported: {
        label: productsRange.label,
        count: newlyImportedRows.length,
        products: newlyImportedRows,
        topByRevenue: topNewlyImportedByRevenue,
        salesByCategory: newlyImportedByCategory,
        countByCategory: newlyImportedByProductCount,
        salesRevenue: newlyImportedSalesRevenue,
        salesQty: newlyImportedSalesQty
      }
    },
    invoices: {
      revenueByDay: invoicesPeriod.revenueByDay,
      periodRevenue: invoicesPeriod.periodRevenue,
      periodInvoices: invoicesPeriod.periodInvoices,
      periodCancelledInvoices,
      recentInvoices,
      recentOrders,
      recentReturns,
      pendingOrdersCount,
      pendingOrdersTotal,
      returnsCount,
      totalReturns
    },
    customers: {
      topDebt,
      topRevenue: topCustomersByRevenue
    },
    lowStock,
    stockValueByCategory,
    allProducts,
    stockByCategory,
    suppliers,
    newPurchases: {
      label: newPurchasesRange.label,
      orderCount: newPurchasesOrderCount,
      totalAmount: newPurchasesTotalAmount,
      supplierCount: newPurchasesSupplierCount,
      bySupplier: newPurchasesBySupplier,
      orders: newPurchaseOrders
    },
    debt
  };
}

module.exports = { getDashboardData, searchDashboardRecords };
