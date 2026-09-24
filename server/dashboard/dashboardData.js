// ==========================================
// DASHBOARD DATA — cung cap du lieu cho Web App (GET /api/dashboard)
//
// Nguon du lieu KiotViet (9 tab: Nhóm hàng/Hàng hóa/Hóa đơn/Chi tiết hóa
// đơn/Đặt hàng/Trả hàng/Khách hàng/Nhà cung cấp/Nhập hàng) doc tu Supabase
// Postgres qua dashboardPgReader.js — module do dung lai dung shape
// `[header, ...rows]` cua Sheets nen toan bo logic tinh toan ben duoi KHONG
// doi. Tap khach hang co giao dich 1/3/7 ngay doc tu Supabase qua
// customerDebtActivityRepository, khong con phu thuoc cac tab HN1/HN3/HN7.
// ==========================================
const CONFIG = require('../config');
const debtManagementSheetsClient = require('../sheets/debtManagementSheetsClient');
const dashboardPgReader = require('./dashboardPgReader');
const customerDebtActivityRepository = require('./customerDebtActivityRepository');
const customerProductTopRepository = require('./customerProductTopRepository');
const dashboardRollupRepository = require('./dashboardRollupRepository');
const { BRANCHES, BRANCH_BOTH, branchLabelToCode, resolveBranchScope } = require('../branch/branches');
const { hasFeature } = require('../auth/featureRegistry');
const debtCollectionStatusRepository = require('./debtCollectionStatusRepository');
const { deriveDebtManagement, PAYMENT_SCHEDULES, DEBT_TOTAL_AVERAGE_SALES } = require('./debtManagement');

const OUT_OF_STOCK_LEVEL = 0;
const TOP_SELLING_LIMIT = 15;
const NEWLY_IMPORTED_REVENUE_LIMIT = 15;
const MAX_PARENT_CATEGORY_BARS = 30;
const NEW_PURCHASES_SUPPLIER_LIMIT = 30; // top NCC cho bieu do 2 cot
const SEARCH_CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_MULTI_SEARCH_CODES = 50;
const DASHBOARD_SHEETS_CACHE_TTL_MS = 90 * 1000;
const CUSTOMER_PRODUCT_TOP_LIMIT = 3;
const PRODUCT_REVENUE_SEARCH_LIVE_LIMIT = 200; // gioi han so dong render khi go tim truc tiep (khong ap dung cho xuat Excel)
const PENDING_ORDER_STATUSES = new Set(['Phiếu tạm', 'Đang xử lý', 'Đã xác nhận']);
const DASHBOARD_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const DASHBOARD_UTC_OFFSET = '+07:00';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 3660; // ~10 nam — chan vong lap tao bucket ngay bi vo tan/qua lon
const MAX_REPORT_TRANSACTIONS = 500; // gioi han so dong bang "Chi tiet giao dich" khi loc ca ky dai
const TOP_REPORT_TRANSACTIONS = 15;
const TOP_CUSTOMER_REVENUE_CHART_LIMIT = 15;
const TOP_CUSTOMER_REVENUE_TABLE_LIMIT = 50;
const CUSTOMER_PRODUCT_REVENUE_WINDOW_DAYS = 90;
const CUSTOMER_PRODUCT_REVENUE_MONTH_DAYS = 30;

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

function daysSince(date) {
  const toUtcMidnight = d => {
    const { day, month, year } = getDashboardDateParts(d);
    return Date.UTC(Number(year), Number(month) - 1, Number(day));
  };
  return Math.round((toUtcMidnight(new Date()) - toUtcMidnight(date)) / DAY_MS);
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

// Chuoi 'YYYY-MM-DD' theo LICH VN cua 1 Date — dung lam tham so $2/$3 (DATE)
// cho cac truy van dashboardRollupRepository.js, tranh phai lap logic quy doi
// mui gio o file do (xem ghi chu dau file dashboardRollupRepository.js).
function toCalendarDateKey(date) {
  const { day, month, year } = getDashboardDateParts(date);
  return `${year}-${month}-${day}`;
}

// Quy doi 1 `range` (tu resolveFilterRange) sang cap {from, to} dang chuoi
// 'YYYY-MM-DD' hoac null (che do "Tất cả" — khong gioi han ngay).
function rangeToDateBounds(range) {
  if (!range || range.mode === 'all') return { from: null, to: null };
  return { from: toCalendarDateKey(range.start), to: toCalendarDateKey(range.end) };
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

// ---------- Cache THEO CO SO -------------------------------------------------
// Moi cache duoi day deu keyed by branch: hai co so doc hai spreadsheet khac
// nhau nen dung chung 1 cache se lam nguoi dung co so nay nhan du lieu cua co
// so kia (ro ri du lieu, khong chi la loi hien thi).
function emptyCache() {
  return { data: null, expiresAt: 0, loading: null };
}

function cacheEntryFor(cacheMap, branch) {
  const key = branch || BRANCHES.HANOI;
  if (!cacheMap.has(key)) cacheMap.set(key, emptyCache());
  return cacheMap.get(key);
}

let searchSheetCacheByBranch = new Map();
let searchIndexBuildCountForTest = 0; // chi dung trong test, xem __test__ o cuoi file

function normalizeWhitespace(value) {
  return String(value === undefined || value === null ? '' : value)
    .normalize('NFKC')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeSearchValue(value) {
  return normalizeWhitespace(value)
    // Chuẩn NFC giúp so sánh dấu tiếng Việt nhất quán ngay cả khi nguồn dữ liệu và
    // truy vấn dùng cách biểu diễn Unicode khác nhau (ví dụ: "a" + dấu tổ hợp so với
    // ký tự dựng sẵn). Chữ hoa/thường được bỏ qua có chủ đích.
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
        row: row.slice(0, 15), // chi giu cac cot dau can thiet cho hien thi search modal thay vi toan bo row dai
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

function rememberSearchSheets(sheets, branch) {
  // Việc chuẩn hóa từng ô và tuần tự hóa từng trường trong mỗi thao tác gõ phím từng
  // là điểm nghẽn hiệu năng trên các sheet sản phẩm lớn. Thay vào đó, xây dựng chỉ mục tìm kiếm
  // tái sử dụng khi cache Sheets có sự thay đổi.
  searchIndexBuildCountForTest += 1; // chi dung trong test, xem __test__ o cuoi file
  const cache = cacheEntryFor(searchSheetCacheByBranch, branch);
  cache.data = buildSearchIndex(sheets);
  cache.expiresAt = Date.now() + SEARCH_CACHE_TTL_MS;
}

// Chi muc tim kiem dung CHUNG du lieu tho voi dashboard (truoc day fetch
// rieng mot lan nua tu Google Sheets). Nguon Postgres tra ve day du 9 tab nen
// khong can lan doc thu hai — chi rebuild chi muc khi chinh no het han.
async function getSearchSheets(branch) {
  if (branch === BRANCH_BOTH) return getAggregateSearchIndex();
  const cache = cacheEntryFor(searchSheetCacheByBranch, branch);
  if (cache.data && Date.now() < cache.expiresAt) {
    return cache.data;
  }
  if (cache.loading) return cache.loading;

  const loading = getCachedDashboardSheets(branch)
    .then(sheets => {
      // getCachedDashboardSheets tu rebuild chi muc moi khi fetch lai du lieu
      // tho; chi lam lai o day khi chi muc that su thieu/het han.
      if (!cache.data || Date.now() >= cache.expiresAt) rememberSearchSheets(sheets, branch);
      return cache.data;
    })
    .finally(() => {
      if (cache.loading === loading) cache.loading = null;
    });
  cache.loading = loading;
  return loading;
}

// ---------- Ca hai: nguon "full" (9 tab) gop qua hai co so vat ly ----------
// Chi muc tim kiem va doanh thu khach cua "Ca hai" duoc tinh tren du lieu da
// gop (thuc the gop theo ma, giao dich noi tiep kem co so) — cung quy tac voi
// getDashboardData. Bo "Chi tiết hóa đơn" (~51K dong, khong ai tim kiem) khong
// duoc gop de tranh chan event loop; bao cao doanh thu theo khach/hang tinh rieng
// tung co so vat ly (xem getCustomerProductRevenueReport) nen khong can no.
let aggregateFullSheetsCache = null; // { sourceSheets: [du lieu tho cua tung co so vat ly], data }

async function getAggregateFullSheets() {
  const scope = resolveBranchScope(BRANCH_BOTH);
  const sources = await Promise.all(scope.map(async physicalBranch => ({
    branch: physicalBranch,
    sheets: await getCachedDashboardSheets(physicalBranch)
  })));
  // So sanh theo DOI TUONG du lieu tho (moi lan fetch lai tao doi tuong moi) thay vi so version doc
  // sau khi await — tranh gan nham du lieu cu voi version moi khi lam moi nen chen ngang.
  const sourceSheets = sources.map(source => source.sheets);
  if (
    aggregateFullSheetsCache &&
    aggregateFullSheetsCache.sourceSheets.every((sheets, index) => sheets === sourceSheets[index])
  ) {
    return aggregateFullSheetsCache.data;
  }
  const searchable = sources.map(({ branch, sheets }) => ({
    branch,
    sheets: Object.fromEntries(Object.entries(sheets).filter(([name]) => name !== CONFIG.SHEET_INVOICE_DETAILS))
  }));
  const data = mergeDashboardSheets(searchable);
  aggregateFullSheetsCache = { sourceSheets, data };
  return data;
}

async function getAggregateSearchIndex() {
  const sheets = await getAggregateFullSheets();
  const cache = cacheEntryFor(searchSheetCacheByBranch, BRANCH_BOTH);
  // Cung doi tuong `sheets` = cung phien ban du lieu cua ca hai co so -> giu chi muc.
  if (cache.data && cache.sheets === sheets) return cache.data;
  rememberSearchSheets(sheets, BRANCH_BOTH);
  cache.sheets = sheets;
  return cache.data;
}

/** Nguon "full" cua 1 pham vi: co so vat ly doc cache rieng, "Ca hai" doc ban da gop. */
function getFullSheetsForScope(branch) {
  return branch === BRANCH_BOTH ? getAggregateFullSheets() : getCachedDashboardSheets(branch);
}

/**
 * Gan "Tong doanh thu" cho ket qua tim kiem tab Khach hang theo dung ky loc
 * dang chon tren tab (giong cach tinh "Top khach hang theo doanh thu").
 * Khong lam gi voi cac view khac.
 */
async function attachCustomerRevenue(view, results, filterSpec, branch) {
  if (view !== 'customers' || !results.length) return results;
  const range = resolveFilterRange(filterSpec, new Date());
  const rawSheets = await getFullSheetsForScope(branch);
  const customerReportData = rawSheets[CONFIG.SHEET_CUSTOMER_REPORT] || [];
  let revenueByCode;
  if (Array.isArray(customerReportData) && customerReportData.length > 1) {
    revenueByCode = aggregateCustomerReportRevenueByCode(range, customerReportData);
  } else {
    // Nguon Postgres khong co tab tong hop "Báo cáo bán hàng" -> luon tinh
    // truc tiep tu Hoa don + Khach hang + Tra hang.
    revenueByCode = aggregateCustomerRevenueFromSheetRows(
      range,
      rawSheets[CONFIG.SHEET_INVOICES] || [],
      rawSheets[CONFIG.SHEET_CUSTOMERS] || [],
      rawSheets[CONFIG.SHEET_RETURNS] || []
    );
  }
  results.forEach(result => {
    const entry = revenueByCode.get(result.code) || (result.name ? revenueByCode.get('name:' + result.name.toLocaleLowerCase('vi-VN')) : null);
    result.revenue = entry ? entry.revenue : 0;
  });
  return results;
}

function parseMultiSearchCodes(rawQuery) {
  const seenCodes = new Set();
  return normalizeWhitespace(rawQuery).split(' ').filter(Boolean).reduce((list, code) => {
    const normalizedCode = normalizeSearchValue(code);
    if (!normalizedCode || seenCodes.has(normalizedCode)) return list;
    seenCodes.add(normalizedCode);
    list.push({ value: code, normalizedValue: normalizedCode, order: list.length });
    return list;
  }, []);
}

function assertMultiSearchCodeLimit(codes) {
  if (codes.length <= MAX_MULTI_SEARCH_CODES) return;
  const error = new RangeError(`Chi duoc tim toi da ${MAX_MULTI_SEARCH_CODES} ma moi lan.`);
  error.statusCode = 400;
  error.code = 'TOO_MANY_SEARCH_CODES';
  throw error;
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

// Doc 1 cot theo TEN COT tu ket qua buildSearchFields — dung cho cac tinh
// nang doc them du lieu tu chi muc tim kiem san co (vd Ton kho/Gia von/Gia
// ban) thay vi phai quet lai toan bo sheet "Hang hoa" mot lan nua.
function searchFieldValue(fields, label) {
  const field = fields.find(entry => entry.label === label);
  return field && field.value !== '—' ? field.value : '';
}

// Nguon giao dich: cung ma co the ton tai o ca hai co so nen ket qua "Ca hai" phai
// kem co so vat ly (cot "Chi nhánh" da duoc mergeTransactionalSheet ghi de).
const TRANSACTIONAL_SEARCH_SOURCES = new Set(['invoices', 'orders', 'returns', 'purchases']);

function toSearchResult(source, indexedSource, record, aggregate) {
  const result = {
    id: `${source}:${record.rowIndex + 1}`,
    source,
    sourceLabel: indexedSource.source.label,
    code: record.code,
    name: record.name,
    fields: buildSearchFields(indexedSource.headers, record.row)
  };
  if (aggregate && TRANSACTIONAL_SEARCH_SOURCES.has(source)) {
    const branchIndex = sheetHeaderIndex(indexedSource.headers, 'Chi nhánh');
    result.branch = branchIndex >= 0 ? String(record.row[branchIndex] || '') : '';
  }
  return result;
}

/**
 * Tim ban ghi co ma hoac ten chua tu khoa trong pham vi dashboard hien tai.
 * Uu tien: trung hoan toan, trung tien to, chua cum tu, roi den du cac tu don.
 * Ket qua kem toan bo cot cua dong nguon de giao dien hien thi dung nhu Sheet.
 */
async function searchDashboardRecords(view, rawQuery, rawLimit, rawMode, filterSpec, branch, allowedEntities) {
  const rawScope = SEARCH_SCOPES[view] || SEARCH_SCOPES.overview;
  // allowedEntities (neu duoc truyen) la cac nhom du lieu tai khoan duoc phep
  // tim kiem — xem dashboardPermissionFilter.js. View 'overview' quet moi nhom
  // nen khong giao cat thi nguoi bi chan tab van tim thay du lieu cua tab do.
  const scope = Array.isArray(allowedEntities)
    ? rawScope.filter(entity => allowedEntities.includes(entity))
    : rawScope;
  const isMultiCodeSearch = String(rawMode || '').toLocaleLowerCase('vi-VN') === 'codes';
  const normalizedInput = normalizeWhitespace(rawQuery);
  const queryText = isMultiCodeSearch ? normalizedInput : normalizedInput.slice(0, 120);

  if (isMultiCodeSearch) {
    const codes = parseMultiSearchCodes(queryText);
    assertMultiSearchCodeLimit(codes);

    if (!codes.length) {
      return {
        view,
        mode: 'codes',
        query: queryText,
        requestedCount: 0,
        matchedCount: 0,
        missingCount: 0,
        total: 0,
        results: []
      };
    }

    const codeOrder = new Map(codes.map(code => [code.normalizedValue, code.order]));
    const matchedCodeOrders = new Set();
    const indexedSources = await getSearchSheets(branch);
    const matches = [];

    scope.forEach(sourceKey => {
      const indexedSource = indexedSources[sourceKey];
      if (!indexedSource) return;

      indexedSource.records.forEach(record => {
        const requestOrder = codeOrder.get(record.normalizedCode);
        if (requestOrder === undefined) return;
        matchedCodeOrders.add(requestOrder);
        matches.push({ indexedSource, record, source: sourceKey, requestOrder });
      });
    });

    matches.sort((a, b) =>
      a.requestOrder - b.requestOrder ||
      a.indexedSource.sourceOrder - b.indexedSource.sourceOrder ||
      a.record.rowIndex - b.record.rowIndex
    );

    const results = matches.map(({ indexedSource, record, source }) =>
      toSearchResult(source, indexedSource, record, branch === BRANCH_BOTH));
    await attachCustomerRevenue(view, results, filterSpec, branch);

    return {
      view,
      mode: 'codes',
      query: codes.map(code => code.value).join(' '),
      requestedCount: codes.length,
      matchedCount: matchedCodeOrders.size,
      missingCount: codes.length - matchedCodeOrders.size,
      total: matches.length,
      results
    };
  }

  const normalizedQuery = normalizeSearchValue(queryText);
  const query = {
    value: normalizedQuery,
    compactValue: compactSearchValue(normalizedQuery),
    tokens: normalizedQuery.split(' ').filter(Boolean)
  };
  const wantsAllResults = String(rawLimit || '').toLocaleLowerCase('vi-VN') === 'all';
  // Tran tren duoc nang tu 50 len 200 de searchProductRevenueOverview co the
  // truyen thang gioi han hien thi (200) vao day thay vi xin 'all' roi tu cat —
  // tranh buildSearchFields chay tren hang nghin dong khop moi lan go phim.
  const limit = wantsAllResults ? null : Math.min(Math.max(Number(rawLimit) || 8, 1), 200);
  if (!query.value) return { view, query: queryText, total: 0, results: [] };

  const indexedSources = await getSearchSheets(branch);
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

  const results = (limit === null ? matches : matches.slice(0, limit))
    .map(({ indexedSource, record, source }) => toSearchResult(source, indexedSource, record, branch === BRANCH_BOTH));
  // Doanh thu chi hien thi o bang ket qua day du (Enter/limit=all), khong hien
  // thi trong dropdown goi y (limit=8) nen bo qua tinh toan de goi y tra nhanh.
  if (limit === null) await attachCustomerRevenue(view, results, filterSpec, branch);

  return {
    view,
    query: queryText,
    total: matches.length,
    results
  };
}

/**
 * Tim toi da 3 khach mua nhieu nhat cho tung ma hang trong ky da chon.
 * Nguon du lieu la SQL tren Postgres (customerProductTopRepository) thay cho
 * sheet tong hop "Khách theo hàng hóa" — shape tra ve cho
 * `/api/customer-product-top` KHONG doi.
 */
// `branch` dung sau `now` (khong phai truoc) vi `now` la tham so tiem cho test
// da co san — giu nguyen vi tri de moi loi goi cu khong phai sua.
async function searchTopCustomersByProducts(rawQuery, filterSpec, now = new Date(), branch) {
  const codes = parseMultiSearchCodes(rawQuery);
  assertMultiSearchCodeLimit(codes);
  const range = resolveFilterRange(filterSpec, now);

  if (!codes.length) {
    return {
      mode: 'customer-product-top',
      query: '',
      filter: range,
      requestedCount: 0,
      matchedCount: 0,
      missingCount: 0,
      total: 0,
      results: []
    };
  }

  const requestOrderByCode = new Map(codes.map(code => [code.normalizedValue, code.order]));
  const rows = await customerProductTopRepository.findTopCustomersByProducts({
    branch,
    codes: codes.map(code => code.value),
    range,
    limit: CUSTOMER_PRODUCT_TOP_LIMIT
  });

  const matchedProductCodes = new Set();
  const results = rows
    .map(row => ({ row, requestOrder: requestOrderByCode.get(normalizeSearchValue(row.productCode)) ?? Number.MAX_SAFE_INTEGER }))
    .sort((left, right) => left.requestOrder - right.requestOrder)
    .map(({ row }) => {
      matchedProductCodes.add(normalizeSearchValue(row.productCode));
      return {
        productCode: row.productCode,
        productName: row.productName || row.productCode,
        customerCode: row.customerCode,
        customerName: row.customerName,
        purchasedQuantity: row.purchasedQuantity,
        purchaseRevenue: row.purchaseRevenue,
        // Ten truong giu nguyen ("...AllTime") de khong doi contract cua
        // /api/customer-product-top, nhung gia tri nay duoc loc theo DUNG ky
        // dang chon giong so lieu mua — xem customerProductTopRepository.js.
        returnedQuantityAllTime: row.returnedQuantity,
        returnValueAllTime: row.returnValue,
        netRevenue: row.purchaseRevenue - row.returnValue,
        lastPurchaseDate: row.lastPurchaseDate ? formatDMY(row.lastPurchaseDate) : ''
      };
    });

  const matchedCount = matchedProductCodes.size;
  return {
    mode: 'customer-product-top',
    query: codes.map(code => code.value).join(' '),
    filter: range,
    requestedCount: codes.length,
    matchedCount,
    missingCount: codes.length - matchedCount,
    total: results.length,
    results
  };
}

// ---------- Cache ngan han cho du lieu tho ----------
// Truoc day moi lan goi /api/dashboard deu batchGet lai TOAN BO cac sheet.
// Gio moi tab co bo loc rieng nen client co the goi API thuong xuyen hon han
// (moi lan doi bo loc o bat ky tab nao) — cache vai chuc giay de khong phai
// quet lai toan bo bang Postgres; tinh toan loc theo ngay van chay tren du
// lieu da cache nen van nhanh va luon phan anh dung bo loc moi nhat.
let dashboardSheetsCacheByBranch = new Map();

function dashboardSheetsCacheFor(branch) {
  const key = branch || BRANCHES.HANOI;
  if (!dashboardSheetsCacheByBranch.has(key)) {
    dashboardSheetsCacheByBranch.set(key, { data: null, version: 0, expiresAt: 0, loading: null });
  }
  return dashboardSheetsCacheByBranch.get(key);
}

// Fetch Postgres that su, khong dong bo voi request nao ca — dung
// chung cho ca duong "cho fetch xong" (cache rong/qua han qua lau) lan
// duong "lam moi nen" (stale-while-revalidate, xem getCachedDashboardSheets).
function fetchAndCacheDashboardSheets(branch, cache) {
  return Promise.all([
    dashboardPgReader.readDashboardSheets(branch),
    customerDebtActivityRepository.readOperationalPeriods(branch)
  ]).then(([pgSheets, debtPeriods]) => {
    const sheets = { ...pgSheets, ...debtPeriods };
    cache.data = sheets;
    cache.version += 1;
    cache.expiresAt = Date.now() + DASHBOARD_SHEETS_CACHE_TTL_MS;
    // Rebuild o day (chi khi vua fetch lai) thay vi trong getDashboardData —
    // truoc day rememberSearchSheets() bi goi lai o MOI request /api/dashboard
    // du raw data khong doi, ton CPU vo ich.
    rememberSearchSheets(sheets, branch);
    return sheets;
  });
}

// Doc Postgres ca 9 tab tren 1 co so mat ~14s (do luong that 2026-09-18,
// truy van "Nhap hang"/"Chi tiet hoa don" nang nhat) — neu de nguoi dung dau
// tien sau moi lan cache het han (90s) phai cho tron 14s thi rat cham. Ap
// dung stale-while-revalidate: qua han thi VAN tra du lieu cu ngay lap tuc,
// dong thoi am tham lam moi o nen — chi khi du lieu cu qua cu (qua
// MAX_STALE_MS, vd server moi khoi dong lai lau hoac Postgres loi lien tuc)
// moi bat nguoi dung dau tien cho fetch that.
const DASHBOARD_SHEETS_MAX_STALE_MS = 10 * 60 * 1000; // 10 phut

async function getCachedDashboardSheets(branch) {
  const cache = dashboardSheetsCacheFor(branch);
  const now = Date.now();
  if (cache.data && now < cache.expiresAt) {
    return cache.data;
  }

  const isUsableStale = cache.data && now < cache.expiresAt + DASHBOARD_SHEETS_MAX_STALE_MS;
  if (isUsableStale) {
    if (!cache.loading) {
      cache.loading = fetchAndCacheDashboardSheets(branch, cache)
        .catch(err => {
          console.error(`[Dashboard] Lam moi nen (stale-while-revalidate) that bai cho ${branch}, tiep tuc dung du lieu cu:`, err.message);
        })
        .finally(() => {
          if (cache.loading) cache.loading = null;
        });
    }
    return cache.data;
  }

  if (cache.loading) return cache.loading;
  const loading = fetchAndCacheDashboardSheets(branch, cache)
    .finally(() => {
      if (cache.loading === loading) cache.loading = null;
    });
  cache.loading = loading;
  return loading;
}

// ---------- Cache "core" (7/9 tab, nhanh) — dung RIENG cho /api/dashboard ----------
// Bo "Chi tiết hóa đơn"/"Nhập hàng" (2 tab nang nhat, ~14s/lan doc) — cac khoi
// tung can 2 tab nay trong computeDashboardData() gio doc tu
// dashboardRollupRepository.js thay the. KHONG goi rememberSearchSheets() —
// chi muc tim kiem van chi xay tu cache "full" (getCachedDashboardSheets),
// dung cho /api/search (xuat Excel khong con dung cache nay, xem exportService.js).
let dashboardCoreSheetsCacheByBranch = new Map();

function dashboardCoreSheetsCacheFor(branch) {
  const key = branch || BRANCHES.HANOI;
  if (!dashboardCoreSheetsCacheByBranch.has(key)) {
    dashboardCoreSheetsCacheByBranch.set(key, { data: null, version: 0, expiresAt: 0, loading: null });
  }
  return dashboardCoreSheetsCacheByBranch.get(key);
}

function fetchAndCacheDashboardCoreSheets(branch, cache) {
  return Promise.all([
    dashboardPgReader.readCoreDashboardSheets(branch),
    customerDebtActivityRepository.readOperationalPeriods(branch)
  ]).then(([pgSheets, debtPeriods]) => {
    const sheets = { ...pgSheets, ...debtPeriods };
    cache.data = sheets;
    cache.version += 1;
    cache.expiresAt = Date.now() + DASHBOARD_SHEETS_CACHE_TTL_MS;
    return sheets;
  });
}

// Y het pattern stale-while-revalidate cua getCachedDashboardSheets() o tren
// (xem ghi chu tai do) — chi khac nguon fetch (7 tab thay vi 9) va khong
// dong bo chi muc tim kiem.
async function getCachedDashboardCoreSheets(branch) {
  const cache = dashboardCoreSheetsCacheFor(branch);
  const now = Date.now();
  if (cache.data && now < cache.expiresAt) {
    return cache.data;
  }

  const isUsableStale = cache.data && now < cache.expiresAt + DASHBOARD_SHEETS_MAX_STALE_MS;
  if (isUsableStale) {
    if (!cache.loading) {
      cache.loading = fetchAndCacheDashboardCoreSheets(branch, cache)
        .catch(err => {
          console.error(`[Dashboard] Lam moi nen (core, stale-while-revalidate) that bai cho ${branch}, tiep tuc dung du lieu cu:`, err.message);
        })
        .finally(() => {
          if (cache.loading) cache.loading = null;
        });
    }
    return cache.data;
  }

  if (cache.loading) return cache.loading;
  const loading = fetchAndCacheDashboardCoreSheets(branch, cache)
    .finally(() => {
      if (cache.loading === loading) cache.loading = null;
    });
  cache.loading = loading;
  return loading;
}

// Workbook công nợ có vòng đời/cache riêng với spreadsheet vận hành. Mỗi cơ
// sở đọc đúng một tab trong cùng workbook và giữ version riêng để cache kết
// quả tổng hợp không thể che mất lần làm mới từ một trong hai nguồn.
let debtManagementSheetsCacheByBranch = new Map();

function debtManagementSheetsCacheFor(branch) {
  const key = branch || BRANCHES.HANOI;
  if (!debtManagementSheetsCacheByBranch.has(key)) {
    debtManagementSheetsCacheByBranch.set(key, { data: null, version: 0, expiresAt: 0, loading: null });
  }
  return debtManagementSheetsCacheByBranch.get(key);
}

async function getCachedDebtManagementSource(branch) {
  const cache = debtManagementSheetsCacheFor(branch);
  if (cache.data && Date.now() < cache.expiresAt) return cache.data;
  if (cache.loading) return cache.loading;

  const loading = debtManagementSheetsClient.getDebtManagementSheet(branch)
    .then(source => ({ ...source, error: null }))
    .catch(error => ({
      sourceSheet: branch === BRANCHES.SAIGON ? CONFIG.DEBT_MANAGEMENT_SHEET_SG : CONFIG.DEBT_MANAGEMENT_SHEET_HN,
      rows: null,
      error
    }))
    .then(source => {
      cache.data = source;
      cache.version += 1;
      cache.expiresAt = Date.now() + DASHBOARD_SHEETS_CACHE_TTL_MS;
      return source;
    })
    .finally(() => {
      if (cache.loading === loading) cache.loading = null;
    });
  cache.loading = loading;
  return loading;
}

let debtWorkflowCacheByBranch = new Map();

function debtWorkflowCacheFor(branch) {
  const key = branch || BRANCHES.HANOI;
  if (!debtWorkflowCacheByBranch.has(key)) {
    debtWorkflowCacheByBranch.set(key, { data: null, version: 0, expiresAt: 0, loading: null });
  }
  return debtWorkflowCacheByBranch.get(key);
}

async function getCachedDebtWorkflow(branch) {
  const cache = debtWorkflowCacheFor(branch);
  if (cache.data && Date.now() < cache.expiresAt) return cache.data;
  if (cache.loading) return cache.loading;

  const branchCode = branchLabelToCode(branch || BRANCHES.HANOI);
  const loading = debtCollectionStatusRepository.listByBranch(branchCode)
    .then(statuses => ({ available: true, statuses, error: null }))
    .catch(error => ({ available: false, statuses: [], error }))
    .then(data => {
      cache.data = data;
      cache.version += 1;
      cache.expiresAt = Date.now() + DASHBOARD_SHEETS_CACHE_TTL_MS;
      return data;
    })
    .finally(() => {
      if (cache.loading === loading) cache.loading = null;
    });
  cache.loading = loading;
  return loading;
}

/**
 * Cac co so (trong `branches`) that su co dong cong no cua `customerKey`, kem
 * CHU KY CANH BAO RIENG cua co so do.
 *
 * Dung khi GHI trang thai o pham vi "Cả hai". Hai vai tro:
 *  1. Mot dong da gop co the chi ton tai o mot co so — khong tao dong trang
 *     thai cho co so khong co khach nay.
 *  2. `debtManagement.js` huy trang thai ket thuc khi chu ky luu != chu ky
 *     TINH LAI TU SO LIEU CUA CHINH CO SO DO, nen moi co so phai duoc ghi chu
 *     ky cua chinh no (dong gop chi mang chu ky cua co so dau tien).
 *
 * Chu ky duoc tinh bang dung ham va dung nguon ma /api/dashboard dung
 * (`buildDebtManagementForBranch` + cache workbook cong no + cache 7 tab core
 * kem CN1/CN3/CN7), nen khong the lech voi luc doc. Co so khong doc duoc mot
 * trong hai nguon tra ve trong `undetermined` — o day KHONG doan la "khong
 * co" va cung khong doan chu ky.
 * @returns {Promise<{found: Array<{branch: string, alertSignature: string}>, undetermined: string[]}>}
 */
async function findDebtCustomerBranches(customerKey, branches) {
  const key = String(customerKey || '').trim().toLowerCase();
  const scope = Array.isArray(branches) ? branches : [];
  const results = await Promise.all(scope.map(async branch => {
    const [debtManagementSource, sheets] = await Promise.all([
      getCachedDebtManagementSource(branch),
      getCachedDashboardCoreSheets(branch).catch(() => null)
    ]);
    // Thieu CN1/CN3/CN7 se lam tat canh bao "Chưa thu" va cho ra chu ky khac
    // voi luc doc — coi nhu chua xac dinh thay vi ghi chu ky sai.
    if (!sheets) return { branch, determined: false };
    const derived = buildDebtManagementForBranch({ branch, sheets, debtManagementSource }, false);
    if (!derived.available) return { branch, determined: false };
    const customer = (derived.customers || []).find(item => item.customerKey === key);
    return { branch, determined: true, alertSignature: customer?.alertSignature || '' };
  }));
  return {
    found: results
      .filter(item => item.determined && item.alertSignature)
      .map(item => ({ branch: item.branch, alertSignature: item.alertSignature })),
    undetermined: results.filter(item => !item.determined).map(item => item.branch)
  };
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
 * Ban sao cua buildRevenuePeriod() nhung nguon la cac dong da tong hop san tu
 * daily_invoice_summary (dashboardRollupRepository.getInvoiceRevenueByDay) —
 * thay vi quet tung hoa don trong `invoiceRecords`. `rollupRows` da duoc SQL
 * loc dung status=3 (Hoan thanh) va sap xep tang dan theo ngay, nen o day CHI
 * can dien them cac ngay trong khoang khong phat sinh (che do 'days'/'range')
 * hoac giu nguyen thu tu tra ve (che do 'all', chi gom ngay THUC SU CO du
 * lieu — giong het hanh vi cu).
 */
function buildRevenuePeriodFromRollup(range, rollupRows) {
  const dayBuckets = {};
  const dayOrder = [];

  if (range.mode === 'all') {
    rollupRows.forEach(row => {
      if (!dayBuckets[row.dateKey]) {
        dayBuckets[row.dateKey] = { revenue: 0, count: 0 };
        dayOrder.push(row.dateKey);
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

  rollupRows.forEach(row => {
    const bucket = dayBuckets[row.dateKey];
    if (!bucket) return;
    bucket.revenue += row.revenue;
    bucket.count += row.invoiceCount;
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
function aggregateCustomerReportRevenueByCode(range, customerReportData) {
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

  return customers;
}

/**
 * Tinh tong doanh thu theo tung khach hang tu cac sheet co ban ("Hoa don",
 * "Khach hang", "Tra hang") khi sheet "Bao cao ban hang" khong ton tai hoac rong.
 */
function aggregateCustomerRevenueFromSheetRows(range, invData, custData, retData) {
  const customers = new Map();
  const custCodeByPhone = new Map();
  const custCodeByName = new Map();
  const custNameByCode = new Map();

  if (Array.isArray(custData)) {
    for (let r = 1; r < custData.length; r++) {
      const row = custData[r];
      const code = String(row[0] || '').trim();
      const name = String(row[1] || '').trim();
      const phone = normalizePhone(row[2]);
      if (code) {
        if (name) custNameByCode.set(code, name);
        if (phone) custCodeByPhone.set(phone, code);
        if (name) custCodeByName.set(name.toLocaleLowerCase('vi-VN'), code);
      }
    }
  }

  const invHeaders = (Array.isArray(invData) && invData[0]) || [];
  const invCodeIdx = invHeaders.findIndex(h => String(h || '').trim() === 'Mã khách hàng');
  const invStatusIdx = invHeaders.findIndex(h => String(h || '').trim() === 'Trạng thái');
  const invDateIdx = invHeaders.findIndex(h => String(h || '').trim() === 'Ngày bán');
  const invNameIdx = invHeaders.findIndex(h => String(h || '').trim() === 'Khách hàng');
  const invPhoneIdx = invHeaders.findIndex(h => String(h || '').trim() === 'SĐT khách');
  const invTotalIdx = invHeaders.findIndex(h => String(h || '').trim() === 'Tổng tiền hàng');

  if (Array.isArray(invData)) {
    for (let r = 1; r < invData.length; r++) {
      const row = invData[r];
      const status = String((invStatusIdx >= 0 ? row[invStatusIdx] : row[9]) || 'Hoàn thành').trim();
      if (status !== 'Hoàn thành') continue;

      const dateVal = invDateIdx >= 0 ? row[invDateIdx] : row[1];
      const dt = parseSheetDate(dateVal);
      if (!isWithinRange(dt, range)) continue;

      let code = String((invCodeIdx >= 0 ? row[invCodeIdx] : row[16]) || '').trim();
      let name = String((invNameIdx >= 0 ? row[invNameIdx] : row[2]) || '').trim();
      const phone = normalizePhone(invPhoneIdx >= 0 ? row[invPhoneIdx] : row[3]);

      if (!code && phone && custCodeByPhone.has(phone)) {
        code = custCodeByPhone.get(phone);
      }
      if (!code && name && custCodeByName.has(name.toLocaleLowerCase('vi-VN'))) {
        code = custCodeByName.get(name.toLocaleLowerCase('vi-VN'));
      }
      if (code && !name && custNameByCode.has(code)) {
        name = custNameByCode.get(code);
      }

      const key = code || ('name:' + name.toLocaleLowerCase('vi-VN'));
      if (!customers.has(key)) {
        customers.set(key, {
          code: code || '—',
          name: name || '(Không xác định)',
          saleOrderCount: 0,
          revenue: 0
        });
      }
      const entry = customers.get(key);
      const total = Number(invTotalIdx >= 0 ? row[invTotalIdx] : row[6]) || 0;
      entry.revenue += total;
      entry.saleOrderCount += 1;
    }
  }

  if (Array.isArray(retData) && retData.length > 1) {
    const retHeaders = retData[0] || [];
    const retCodeIdx = retHeaders.findIndex(h => String(h || '').trim() === 'Mã khách hàng');
    const retStatusIdx = retHeaders.findIndex(h => String(h || '').trim() === 'Trạng thái');
    const retDateIdx = retHeaders.findIndex(h => String(h || '').trim() === 'Ngày trả');
    const retNameIdx = retHeaders.findIndex(h => String(h || '').trim() === 'Khách hàng');
    const retTotalIdx = retHeaders.findIndex(h => String(h || '').trim() === 'Tổng tiền trả');

    for (let r = 1; r < retData.length; r++) {
      const row = retData[r];
      const status = String((retStatusIdx >= 0 ? row[retStatusIdx] : row[5]) || 'Hoàn thành').trim();
      if (status !== 'Hoàn thành') continue;

      const dateVal = retDateIdx >= 0 ? row[retDateIdx] : row[1];
      const dt = parseSheetDate(dateVal);
      if (!isWithinRange(dt, range)) continue;

      let code = String((retCodeIdx >= 0 ? row[retCodeIdx] : row[14]) || '').trim();
      let name = String((retNameIdx >= 0 ? row[retNameIdx] : row[3]) || '').trim();
      if (!code && name && custCodeByName.has(name.toLocaleLowerCase('vi-VN'))) {
        code = custCodeByName.get(name.toLocaleLowerCase('vi-VN'));
      }
      const key = code || ('name:' + name.toLocaleLowerCase('vi-VN'));
      if (customers.has(key)) {
        const entry = customers.get(key);
        const retTotal = Number(retTotalIdx >= 0 ? row[retTotalIdx] : row[4]) || 0;
        entry.revenue -= retTotal;
      }
    }
  }

  return customers;
}

function buildTopCustomersByRevenue(range, customerReportData, invData, custData, retData) {
  let customers;
  if (Array.isArray(customerReportData) && customerReportData.length > 1) {
    customers = aggregateCustomerReportRevenueByCode(range, customerReportData);
  } else {
    customers = aggregateCustomerRevenueFromSheetRows(range, invData, custData, retData);
  }
  const sorted = Array.from(customers.values()).sort((a, b) => b.revenue - a.revenue);

  return {
    label: range.label,
    top15: sorted.slice(0, TOP_CUSTOMER_REVENUE_CHART_LIMIT),
    top50: sorted.slice(0, TOP_CUSTOMER_REVENUE_TABLE_LIMIT)
  };
}

/**
 * Doanh thu 90 ngay gan nhat cua 1 khach hang cu the, tach theo tung san
 * pham (tab Khach hang — "Bao cao doanh thu theo khach"). Join truc tiep
 * "Hoa don" (de biet ngay ban + khach hang) voi "Chi tiet hoa don" (de biet
 * mat hang) qua Ma hoa don. KHONG dung cac sheet tong hop san co ("Bao cao
 * ban hang"/"Khach theo hang hoa") vi do la snapshot toan thoi gian, refresh
 * 1 lan/ngay va khong co san 3 bucket thang (0-29/30-59/60-89 ngay) can cho
 * bang so sanh doanh so theo thang.
 */
function computeCustomerProductRevenue(sheets, customerCode, customerName, now) {
  const targetCode = String(customerCode || '').trim();
  if (!targetCode) {
    const err = new Error('Thiếu mã khách hàng.');
    err.statusCode = 400;
    err.code = 'CUSTOMER_CODE_REQUIRED';
    throw err;
  }

  const range = resolveFilterRange({ mode: 'days', days: CUSTOMER_PRODUCT_REVENUE_WINDOW_DAYS }, now);
  const invData = sheets[CONFIG.SHEET_INVOICES] || [];
  const detailData = sheets[CONFIG.SHEET_INVOICE_DETAILS] || [];
  const custData = sheets[CONFIG.SHEET_CUSTOMERS] || [];

  // Cung mot chuoi fallback ma khach hang (ma -> SDT -> ten chuan hoa) nhu
  // aggregateCustomerRevenueFromSheetRows, de doanh thu tinh o day khop voi so
  // lieu "Top khach hang theo doanh thu" o phan 2 cua cung tab.
  const custCodeByPhone = new Map();
  const custCodeByName = new Map();
  let resolvedName = String(customerName || '').trim();
  for (let r = 1; r < custData.length; r++) {
    const row = custData[r];
    const code = String(row[0] || '').trim();
    const name = String(row[1] || '').trim();
    const phone = normalizePhone(row[2]);
    if (!code) continue;
    if (phone) custCodeByPhone.set(phone, code);
    if (name) custCodeByName.set(normalizeSearchValue(name), code);
    if (code === targetCode && name && !resolvedName) resolvedName = name;
  }

  const invHeaders = invData[0] || [];
  const invIndex = (header, fallback) => {
    const idx = invHeaders.findIndex(h => String(h || '').trim() === header);
    return idx >= 0 ? idx : fallback;
  };
  const invCodeIdx = invIndex('Mã hóa đơn', 0);
  const invDateIdx = invIndex('Ngày bán', 1);
  const invNameIdx = invIndex('Khách hàng', 2);
  const invPhoneIdx = invIndex('SĐT khách', 3);
  const invStatusIdx = invIndex('Trạng thái', 9);
  const invCustCodeIdx = invIndex('Mã khách hàng', 15);

  // Ma hoa don (da chuan hoa) -> ngay ban, chi giu hoa don hoan thanh, trong
  // 90 ngay va thuoc dung khach hang dang xem.
  const matchedInvoiceDates = new Map();
  for (let r = 1; r < invData.length; r++) {
    const row = invData[r];
    const status = String(row[invStatusIdx] || 'Hoàn thành').trim();
    if (status !== 'Hoàn thành') continue;

    const dt = parseSheetDate(row[invDateIdx]);
    if (!isWithinRange(dt, range)) continue;

    let code = String(row[invCustCodeIdx] || '').trim();
    const name = String(row[invNameIdx] || '').trim();
    const phone = normalizePhone(row[invPhoneIdx]);
    if (!code && phone && custCodeByPhone.has(phone)) code = custCodeByPhone.get(phone);
    if (!code && name && custCodeByName.has(normalizeSearchValue(name))) code = custCodeByName.get(normalizeSearchValue(name));
    if (code !== targetCode) continue;

    const invoiceCode = String(row[invCodeIdx] || '').trim();
    if (!invoiceCode) continue;
    matchedInvoiceDates.set(invoiceCode, dt);
    if (!resolvedName && name) resolvedName = name;
  }

  const dayKeys = [];
  for (let cursor = range.start; cursor.getTime() <= range.end.getTime(); cursor = new Date(cursor.getTime() + DAY_MS)) {
    dayKeys.push(formatDMY(cursor));
  }
  // Tuoi (so ngay truoc "now") cua tung ngay trong dayKeys, dung de xep vao
  // bucket T.nay/T.truoc/T.truoc nua. Tinh tu vi tri trong dayKeys (KHONG
  // dung ham daysSince() dung chung — ham do luon so voi new Date() THUC, bo
  // qua tham so `now` truyen vao nen se sai khi test truyen `now` gia dinh).
  const ageByDateKey = new Map();
  const lastDayIndex = dayKeys.length - 1;
  dayKeys.forEach((key, index) => ageByDateKey.set(key, lastDayIndex - index));
  const emptyDayBuckets = () => {
    const buckets = {};
    dayKeys.forEach(key => { buckets[key] = 0; });
    return buckets;
  };
  const toRevenueByDay = dayBuckets => dayKeys.map(key => ({
    date: key,
    label: key.substring(0, 5),
    revenue: dayBuckets[key] || 0
  }));

  const totalDayBuckets = emptyDayBuckets();
  const productsByCode = new Map();

  const detHeaders = detailData[0] || [];
  const detIndex = (header, fallback) => {
    const idx = detHeaders.findIndex(h => String(h || '').trim() === header);
    return idx >= 0 ? idx : fallback;
  };
  const detCodeIdx = detIndex('Mã hóa đơn', 0);
  const detItemCodeIdx = detIndex('Mã hàng', 1);
  const detItemNameIdx = detIndex('Tên hàng', 2);
  const detQtyIdx = detIndex('Số lượng', 3);
  const detTotalIdx = detIndex('Thành tiền', 6);

  for (let r = 1; r < detailData.length; r++) {
    const row = detailData[r];
    const invoiceCode = String(row[detCodeIdx] || '').trim();
    if (!invoiceCode || !matchedInvoiceDates.has(invoiceCode)) continue;

    const dt = matchedInvoiceDates.get(invoiceCode);
    const dateKey = formatDMY(dt);
    const quantity = Number(row[detQtyIdx]) || 0;
    const revenue = Number(row[detTotalIdx]) || 0;
    const itemCode = String(row[detItemCodeIdx] || '').trim() || '—';
    const itemName = String(row[detItemNameIdx] || '').trim() || itemCode;

    if (totalDayBuckets[dateKey] !== undefined) totalDayBuckets[dateKey] += revenue;

    if (!productsByCode.has(itemCode)) {
      productsByCode.set(itemCode, {
        code: itemCode,
        name: itemName,
        quantity: 0,
        revenue: 0,
        month1Revenue: 0,
        month2Revenue: 0,
        month3Revenue: 0,
        dayBuckets: emptyDayBuckets()
      });
    }
    const product = productsByCode.get(itemCode);
    product.quantity += quantity;
    product.revenue += revenue;
    if (product.dayBuckets[dateKey] !== undefined) product.dayBuckets[dateKey] += revenue;

    // T.nay = 0-29 ngay truoc, T.truoc = 30-59, T.truoc nua = 60-89 (hoa don
    // qua 90 ngay da bi loai o vong loc "Hoa don" phia tren nen khong can
    // nhanh else rieng cho "ngoai pham vi").
    const age = ageByDateKey.get(dateKey);
    if (age !== undefined) {
      if (age < CUSTOMER_PRODUCT_REVENUE_MONTH_DAYS) product.month1Revenue += revenue;
      else if (age < CUSTOMER_PRODUCT_REVENUE_MONTH_DAYS * 2) product.month2Revenue += revenue;
      else if (age < CUSTOMER_PRODUCT_REVENUE_MONTH_DAYS * 3) product.month3Revenue += revenue;
    }
  }

  const products = Array.from(productsByCode.values())
    .map(p => ({
      code: p.code,
      name: p.name,
      quantity: p.quantity,
      revenue: p.revenue,
      month1Revenue: p.month1Revenue,
      month2Revenue: p.month2Revenue,
      month3Revenue: p.month3Revenue,
      revenueByDay: toRevenueByDay(p.dayBuckets)
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    customer: { code: targetCode, name: resolvedName || targetCode },
    range: { from: formatDMY(range.start), to: formatDMY(range.end), days: CUSTOMER_PRODUCT_REVENUE_WINDOW_DAYS, label: range.label },
    totalRevenueByDay: toRevenueByDay(totalDayBuckets),
    totalRevenue: products.reduce((sum, p) => sum + p.revenue, 0),
    totalQuantity: products.reduce((sum, p) => sum + p.quantity, 0),
    products
  };
}

// Ten hien thi that (khac ma du phong) dau tien theo thu tu Ha Noi -> Sai Gon.
function isRealDisplayName(name, code) {
  const text = String(name || '').trim();
  return Boolean(text) && text !== String(code || '').trim();
}

/**
 * Gop bao cao doanh thu theo khach cua cac co so vat ly (moi bao cao da tinh
 * rieng tren hoa don + chi tiet cua CHINH co so do, nen hoa don trung ma giua hai
 * co so khong bao gio bi ghep nham). Cong theo ma hang chuan hoa va theo ngay.
 */
function mergeCustomerProductRevenueReports(reports) {
  const cloneDays = days => days.map(day => ({ ...day }));
  const addDays = (target, source) => {
    const byDate = new Map(target.map(day => [day.date, day]));
    source.forEach(day => {
      if (byDate.has(day.date)) byDate.get(day.date).revenue += day.revenue;
    });
  };
  const first = reports[0];
  const totalRevenueByDay = cloneDays(first.totalRevenueByDay);
  const productsByCode = new Map();
  let customerName = '';

  reports.forEach((report, reportIndex) => {
    if (reportIndex > 0) addDays(totalRevenueByDay, report.totalRevenueByDay);
    if (!customerName && isRealDisplayName(report.customer.name, report.customer.code)) customerName = report.customer.name;
    report.products.forEach(product => {
      const key = normalizeSearchValue(product.code);
      if (!productsByCode.has(key)) {
        productsByCode.set(key, { ...product, revenueByDay: cloneDays(product.revenueByDay) });
        return;
      }
      const target = productsByCode.get(key);
      if (!isRealDisplayName(target.name, target.code) && isRealDisplayName(product.name, product.code)) {
        target.name = product.name;
      }
      ['quantity', 'revenue', 'month1Revenue', 'month2Revenue', 'month3Revenue'].forEach(field => {
        target[field] += product[field];
      });
      addDays(target.revenueByDay, product.revenueByDay);
    });
  });

  const products = Array.from(productsByCode.values()).sort((a, b) => b.revenue - a.revenue);
  return {
    customer: { code: first.customer.code, name: customerName || first.customer.code },
    range: first.range,
    totalRevenueByDay,
    totalRevenue: products.reduce((sum, p) => sum + p.revenue, 0),
    totalQuantity: products.reduce((sum, p) => sum + p.quantity, 0),
    products
  };
}

async function getCustomerProductRevenueReport(customerCode, customerName, branch, now = new Date()) {
  if (branch === BRANCH_BOTH) {
    const reports = await Promise.all(resolveBranchScope(BRANCH_BOTH).map(async physicalBranch =>
      computeCustomerProductRevenue(await getCachedDashboardSheets(physicalBranch), customerCode, customerName, now)));
    return mergeCustomerProductRevenueReports(reports);
  }
  const sheets = await getCachedDashboardSheets(branch);
  return computeCustomerProductRevenue(sheets, customerCode, customerName, now);
}

// ========================================================================
// "Bao cao doanh thu theo hang" (tab Tong quan) — chieu nguoc lai cua
// "Bao cao doanh thu theo khach" o tren: gop doanh thu 90 ngay THEO MA HANG
// (khong loc theo 1 khach hang cu the).
// ========================================================================

/**
 * Tong hop doanh thu/SL ban 90 ngay gan nhat cho TUNG MA HANG, dung chung
 * logic loc hoa don ("Hoan thanh", trong 90 ngay) va bucket 3 thang
 * (0-29/30-59/60-89 ngay) nhu computeCustomerProductRevenue — chi khac o cho
 * KHONG loc theo khach hang. Ket qua phuc vu ca bang tong quan (DS/SL 90
 * ngay) lan phan "Chi tiet" (3 moc doanh thu) ma khong can quet lai.
 */
function computeProductRevenueMap(sheets, now) {
  const range = resolveFilterRange({ mode: 'days', days: CUSTOMER_PRODUCT_REVENUE_WINDOW_DAYS }, now);
  const invData = sheets[CONFIG.SHEET_INVOICES] || [];
  const detailData = sheets[CONFIG.SHEET_INVOICE_DETAILS] || [];

  const invHeaders = invData[0] || [];
  const invIndex = (header, fallback) => {
    const idx = invHeaders.findIndex(h => String(h || '').trim() === header);
    return idx >= 0 ? idx : fallback;
  };
  const invCodeIdx = invIndex('Mã hóa đơn', 0);
  const invDateIdx = invIndex('Ngày bán', 1);
  const invStatusIdx = invIndex('Trạng thái', 9);

  // Ma hoa don (chi "Hoan thanh", trong 90 ngay) -> ngay ban.
  const matchedInvoiceDates = new Map();
  for (let r = 1; r < invData.length; r++) {
    const row = invData[r];
    const status = String(row[invStatusIdx] || 'Hoàn thành').trim();
    if (status !== 'Hoàn thành') continue;

    const dt = parseSheetDate(row[invDateIdx]);
    if (!isWithinRange(dt, range)) continue;

    const invoiceCode = String(row[invCodeIdx] || '').trim();
    if (!invoiceCode) continue;
    matchedInvoiceDates.set(invoiceCode, dt);
  }

  const dayKeys = [];
  for (let cursor = range.start; cursor.getTime() <= range.end.getTime(); cursor = new Date(cursor.getTime() + DAY_MS)) {
    dayKeys.push(formatDMY(cursor));
  }
  const ageByDateKey = new Map();
  const lastDayIndex = dayKeys.length - 1;
  dayKeys.forEach((key, index) => ageByDateKey.set(key, lastDayIndex - index));

  const detHeaders = detailData[0] || [];
  const detIndex = (header, fallback) => {
    const idx = detHeaders.findIndex(h => String(h || '').trim() === header);
    return idx >= 0 ? idx : fallback;
  };
  const detCodeIdx = detIndex('Mã hóa đơn', 0);
  const detItemCodeIdx = detIndex('Mã hàng', 1);
  const detItemNameIdx = detIndex('Tên hàng', 2);
  const detQtyIdx = detIndex('Số lượng', 3);
  const detTotalIdx = detIndex('Thành tiền', 6);

  const productsByCode = new Map();

  for (let r = 1; r < detailData.length; r++) {
    const row = detailData[r];
    const invoiceCode = String(row[detCodeIdx] || '').trim();
    if (!invoiceCode || !matchedInvoiceDates.has(invoiceCode)) continue;

    const itemCode = String(row[detItemCodeIdx] || '').trim();
    if (!itemCode || isVatProductCode(itemCode)) continue;

    const dt = matchedInvoiceDates.get(invoiceCode);
    const dateKey = formatDMY(dt);
    const quantity = Number(row[detQtyIdx]) || 0;
    const revenue = Number(row[detTotalIdx]) || 0;
    const itemName = String(row[detItemNameIdx] || '').trim() || itemCode;
    const normalizedCode = normalizeSearchValue(itemCode);

    if (!productsByCode.has(normalizedCode)) {
      productsByCode.set(normalizedCode, {
        code: itemCode,
        name: itemName,
        quantity: 0,
        revenue: 0,
        month1Revenue: 0,
        month2Revenue: 0,
        month3Revenue: 0
      });
    }
    const product = productsByCode.get(normalizedCode);
    product.quantity += quantity;
    product.revenue += revenue;

    // T.nay = 0-29 ngay truoc, T.truoc = 30-59, T.truoc nua = 60-89 (hoa don
    // qua 90 ngay da bi loai o vong loc "Hoa don" phia tren).
    const age = ageByDateKey.get(dateKey);
    if (age !== undefined) {
      if (age < CUSTOMER_PRODUCT_REVENUE_MONTH_DAYS) product.month1Revenue += revenue;
      else if (age < CUSTOMER_PRODUCT_REVENUE_MONTH_DAYS * 2) product.month2Revenue += revenue;
      else if (age < CUSTOMER_PRODUCT_REVENUE_MONTH_DAYS * 3) product.month3Revenue += revenue;
    }
  }

  return productsByCode;
}

// Cache theo co so, khoa boi sheetsVersion (giong dashboardResultCache) — chi
// 1 entry moi co so (khong co bo loc rieng nhu bang tong quan chinh) nen
// khong can don dep entry cu theo TTL rieng.
let productRevenueMapCacheByBranch = new Map();

function mergeProductRevenueMaps(maps) {
  const merged = new Map();
  maps.forEach(map => map.forEach((entry, key) => {
    if (!merged.has(key)) {
      merged.set(key, { ...entry });
      return;
    }
    const target = merged.get(key);
    ['quantity', 'revenue', 'month1Revenue', 'month2Revenue', 'month3Revenue'].forEach(field => {
      target[field] += entry[field];
    });
  }));
  return merged;
}

async function getProductRevenueMap(branch, now = new Date()) {
  if (branch === BRANCH_BOTH) {
    // Moi co so tinh + cache rieng; ban gop duoc cache theo tong hop phien ban.
    const scope = resolveBranchScope(BRANCH_BOTH);
    const maps = await Promise.all(scope.map(physicalBranch => getProductRevenueMap(physicalBranch, now)));
    const version = scope.map(physicalBranch => dashboardSheetsCacheFor(physicalBranch).version).join(':');
    const cached = productRevenueMapCacheByBranch.get(BRANCH_BOTH);
    if (cached && cached.version === version) return cached.map;
    const map = mergeProductRevenueMaps(maps);
    productRevenueMapCacheByBranch.set(BRANCH_BOTH, { version, map });
    return map;
  }
  const sheets = await getCachedDashboardSheets(branch);
  const version = dashboardSheetsCacheFor(branch).version;
  const key = branch || BRANCHES.HANOI;
  const cached = productRevenueMapCacheByBranch.get(key);
  if (cached && cached.version === version) return cached.map;

  const map = computeProductRevenueMap(sheets, now);
  productRevenueMapCacheByBranch.set(key, { version, map });
  return map;
}

/**
 * Top 3 khach mua nhieu nhat theo DOANH SO (khong phai so luong), tinh tren
 * TOAN BO lich su (khong loc ngay) cho 1 ma hang — dung cho phan "Chi tiet"
 * cua "Bao cao doanh thu theo hang". Cung nguon SQL voi
 * searchTopCustomersByProducts nhung xep hang theo doanh thu va bo loc ngay.
 */
async function computeTopCustomersByRevenueForProduct(productCode, branch) {
  const rows = await customerProductTopRepository.findTopCustomersByRevenueForProduct({
    branch,
    code: productCode,
    limit: CUSTOMER_PRODUCT_TOP_LIMIT
  });

  return rows.map(({ customerCode, customerName, purchaseRevenue }) => ({
    customerCode,
    customerName,
    purchaseRevenue
  }));
}

function productRevenueNotFoundError() {
  const err = new Error('Không tìm thấy mã hàng.');
  err.statusCode = 404;
  err.code = 'PRODUCT_NOT_FOUND';
  return err;
}

/**
 * Bang tong quan cho "Bao cao doanh thu theo hang": tim san pham (thuong
 * hoac dan nhieu ma — dung chung logic voi searchDashboardRecords, view
 * 'products') roi gan them DS/SL 90 ngay va ton kho hien tai. `total` luon la
 * so luong khop thuc te; `resultLimit` (neu co) chi cat bot SO DONG TRA VE de
 * ban go-tim-truc-tiep tren UI khong phai render hang nghin dong moi lan go
 * phim — xuat Excel goi ham nay KHONG truyen resultLimit nen van lay day du.
 */
async function searchProductRevenueOverview(rawQuery, rawMode, branch, now = new Date(), resultLimit) {
  // Truyen thang resultLimit lam gioi han cho searchDashboardRecords (thay vi
  // 'all' roi tu cat sau) de no CHI dung toSearchResult/buildSearchFields tren
  // so dong thuc su can hien thi — tranh dung fields cho hang nghin san pham
  // khop tu khoa ngan (vd go 1 ky tu dau tien) tren MOI lan go phim. `total`
  // van chinh xac vi duoc dem tu buoc quet ban dau, truoc khi cat.
  const hasResultLimit = Number.isFinite(resultLimit) && resultLimit > 0;
  const base = await searchDashboardRecords('products', rawQuery, hasResultLimit ? resultLimit : 'all', rawMode, { mode: 'all' }, branch);
  const revenueMap = await getProductRevenueMap(branch, now);

  const results = base.results.map(record => {
    const revenueEntry = revenueMap.get(normalizeSearchValue(record.code));
    return {
      code: record.code,
      name: record.name,
      ds90: revenueEntry ? revenueEntry.revenue : 0,
      sl90: revenueEntry ? revenueEntry.quantity : 0,
      tonKho: Number(searchFieldValue(record.fields, 'Tồn kho')) || 0
    };
  });

  return {
    mode: base.mode || 'normal',
    query: base.query,
    total: base.total,
    results
  };
}

/**
 * Chi tiet mo rong cho 1 ma hang (nut "Chi tiet" trong bang tong quan):
 * trang thai/gia von/gia ban doc tu chi muc tim kiem san co (khong quet lai
 * sheet "Hang hoa"), doanh thu 3 moc 30 ngay tu getProductRevenueMap (khong
 * quet lai hoa don), va top 3 khach hang toan lich su.
 */
async function getProductRevenueDetail(code, branch, now = new Date()) {
  const targetCode = String(code || '').trim();
  if (!targetCode || isVatProductCode(targetCode)) {
    throw productRevenueNotFoundError();
  }

  const normalizedTargetCode = normalizeSearchValue(targetCode);
  const indexedSources = await getSearchSheets(branch);
  const productSource = indexedSources.products;
  const record = productSource && productSource.records.find(r => r.normalizedCode === normalizedTargetCode);
  if (!record) throw productRevenueNotFoundError();

  const fields = buildSearchFields(productSource.headers, record.row);
  const revenueMap = await getProductRevenueMap(branch, now);
  const revenueEntry = revenueMap.get(normalizedTargetCode) || { month1Revenue: 0, month2Revenue: 0, month3Revenue: 0 };
  const topCustomers = await computeTopCustomersByRevenueForProduct(targetCode, branch);

  const detail = {
    code: record.code,
    name: record.name,
    status: searchFieldValue(fields, 'Trạng thái') || 'Đang kinh doanh',
    cost: Math.max(Number(searchFieldValue(fields, 'Giá vốn')) || 0, 0),
    price: Math.max(Number(searchFieldValue(fields, 'Giá bán')) || 0, 0),
    month1Revenue: revenueEntry.month1Revenue,
    month2Revenue: revenueEntry.month2Revenue,
    month3Revenue: revenueEntry.month3Revenue,
    topCustomers
  };
  if (branch === BRANCH_BOTH) {
    detail.branchDetails = await buildProductBranchDetails(normalizedTargetCode, now);
  }
  return detail;
}

/**
 * "Ca hai": tach ton kho/gia von/gia ban/doanh thu tung co so vat ly cua 1 ma
 * hang de nguoi xem khong bi che mat nguon khi cac so da duoc cong gop.
 */
async function buildProductBranchDetails(normalizedCode, now) {
  const details = [];
  for (const physicalBranch of resolveBranchScope(BRANCH_BOTH)) {
    const productSource = (await getSearchSheets(physicalBranch)).products;
    const record = productSource && productSource.records.find(r => r.normalizedCode === normalizedCode);
    if (!record) continue;
    const fields = buildSearchFields(productSource.headers, record.row);
    const revenueEntry = (await getProductRevenueMap(physicalBranch, now)).get(normalizedCode)
      || { month1Revenue: 0, month2Revenue: 0, month3Revenue: 0 };
    details.push({
      branch: physicalBranch,
      status: searchFieldValue(fields, 'Trạng thái') || 'Đang kinh doanh',
      stock: Number(searchFieldValue(fields, 'Tồn kho')) || 0,
      cost: Math.max(Number(searchFieldValue(fields, 'Giá vốn')) || 0, 0),
      price: Math.max(Number(searchFieldValue(fields, 'Giá bán')) || 0, 0),
      month1Revenue: revenueEntry.month1Revenue,
      month2Revenue: revenueEntry.month2Revenue,
      month3Revenue: revenueEntry.month3Revenue
    });
  }
  return details;
}

/**
 * Bao cao chi tiet giao dich trong `range` cho tab Hoa don (truoc day nam o tab
 * Tong quan, thay cho khai niem "cuoi ngay" co dinh). Tong hop (summary) luon tinh tren TOAN
 * BO giao dich trong ky; danh sach chi tiet (transactions) gioi han
 * MAX_REPORT_TRANSACTIONS dong gan nhat de khong lam nang trang khi chon ky dai.
 */
function invoiceIdentity(branch, code) {
  return `${String(branch || '').trim()}\u0000${String(code || '').trim()}`;
}

function buildTransactionsReport(range, invoiceRecords, invoiceQuantityMap, includeBranch = false) {
  const singleDay = isSingleDayRange(range);
  const inRangeRecords = invoiceRecords.filter(r => isWithinRange(r._dt, range));

  const allTransactions = inRangeRecords
    .map(r => {
      const normalizedCode = String(r.code).trim();
      const branchQuantityKey = invoiceIdentity(r.branch, normalizedCode);
      const quantityKey = r.branch && invoiceQuantityMap.has(branchQuantityKey) ? branchQuantityKey : normalizedCode;
      return {
        code: r.code,
        ...(includeBranch ? { branch: r.branch } : {}),
        time: r._dt ? (singleDay ? formatHM(r._dt) : formatDMYHM(r._dt)) : '—',
        customer: r.customer,
        employee: r.employee,
        quantity: invoiceQuantityMap.get(quantityKey) || 0,
        quantityKnown: invoiceQuantityMap.has(quantityKey),
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

function sheetHeaderIndex(headers, name) {
  return headers.findIndex(header => String(header || '').trim() === name);
}

function alignSheetRow(sourceHeaders, targetHeaders, row) {
  const sourceIndex = new Map(sourceHeaders.map((header, index) => [String(header || '').trim(), index]));
  return targetHeaders.map(header => {
    const index = sourceIndex.get(String(header || '').trim());
    return index === undefined ? '' : row[index];
  });
}

function firstSheetHeaders(branchSources, sheetName) {
  for (const source of branchSources) {
    const sheet = source.sheets[sheetName];
    if (Array.isArray(sheet) && Array.isArray(sheet[0])) return sheet[0].slice();
  }
  return null;
}

function mergeEntitySheet(branchSources, sheetName, codeHeader, additiveHeaders = [], options = {}) {
  const targetHeaders = firstSheetHeaders(branchSources, sheetName);
  if (!targetHeaders) return [];
  const codeIndex = sheetHeaderIndex(targetHeaders, codeHeader);
  const additiveIndexes = new Map(additiveHeaders.map(header => [header, sheetHeaderIndex(targetHeaders, header)]));
  const costIndex = options.weightedInventoryCost ? sheetHeaderIndex(targetHeaders, 'Giá vốn') : -1;
  const stockIndex = options.weightedInventoryCost ? sheetHeaderIndex(targetHeaders, 'Tồn kho') : -1;
  const entities = new Map();

  branchSources.forEach(source => {
    const sheet = source.sheets[sheetName];
    if (!Array.isArray(sheet) || !Array.isArray(sheet[0])) return;
    const sourceHeaders = sheet[0];
    for (let index = 1; index < sheet.length; index += 1) {
      const aligned = alignSheetRow(sourceHeaders, targetHeaders, sheet[index] || []);
      const code = String(aligned[codeIndex] || '').trim();
      if (!code) continue;
      const key = normalizeSearchValue(code);
      if (!entities.has(key)) {
        entities.set(key, {
          row: new Array(targetHeaders.length).fill(''),
          sums: new Map(additiveHeaders.map(header => [header, 0])),
          inventoryValue: 0
        });
      }
      const entity = entities.get(key);
      aligned.forEach((value, columnIndex) => {
        if ((entity.row[columnIndex] === '' || entity.row[columnIndex] == null) && value !== '' && value != null) {
          entity.row[columnIndex] = value;
        }
      });
      additiveHeaders.forEach(header => {
        const columnIndex = additiveIndexes.get(header);
        entity.sums.set(header, entity.sums.get(header) + (Number(aligned[columnIndex]) || 0));
      });
      if (costIndex >= 0 && stockIndex >= 0) {
        entity.inventoryValue += Math.max(Number(aligned[stockIndex]) || 0, 0) * Math.max(Number(aligned[costIndex]) || 0, 0);
      }
    }
  });

  const rows = Array.from(entities.values()).map(entity => {
    additiveHeaders.forEach(header => {
      const columnIndex = additiveIndexes.get(header);
      if (columnIndex >= 0) entity.row[columnIndex] = entity.sums.get(header);
    });
    if (costIndex >= 0 && stockIndex >= 0) {
      const positiveStock = Math.max(Number(entity.row[stockIndex]) || 0, 0);
      if (positiveStock > 0) entity.row[costIndex] = entity.inventoryValue / positiveStock;
    }
    return entity.row;
  });
  return [targetHeaders, ...rows];
}

function mergeTransactionalSheet(branchSources, sheetName) {
  const targetHeaders = firstSheetHeaders(branchSources, sheetName);
  if (!targetHeaders) return [];
  const branchIndex = sheetHeaderIndex(targetHeaders, 'Chi nhánh');
  const rows = [];
  branchSources.forEach(source => {
    const sheet = source.sheets[sheetName];
    if (!Array.isArray(sheet) || !Array.isArray(sheet[0])) return;
    for (let index = 1; index < sheet.length; index += 1) {
      const aligned = alignSheetRow(sheet[0], targetHeaders, sheet[index] || []);
      if (branchIndex >= 0) aligned[branchIndex] = source.branch;
      rows.push(aligned);
    }
  });
  return [targetHeaders, ...rows];
}

function concatenateSheet(branchSources, sheetName) {
  const targetHeaders = firstSheetHeaders(branchSources, sheetName);
  if (!targetHeaders) return [];
  const rows = [];
  branchSources.forEach(source => {
    const sheet = source.sheets[sheetName];
    if (!Array.isArray(sheet) || !Array.isArray(sheet[0])) return;
    for (let index = 1; index < sheet.length; index += 1) {
      rows.push(alignSheetRow(sheet[0], targetHeaders, sheet[index] || []));
    }
  });
  return [targetHeaders, ...rows];
}

// Quy tac gop thuc the theo ma (cot cong don, gia von binh quan theo ton kho) —
// dung chung cho man hinh (mergeDashboardSheets) va xuat Excel (mergeEntityRows).
const ENTITY_MERGE_SPECS = {
  [CONFIG.SHEET_PRODUCTS]: {
    codeHeader: 'Mã hàng', additiveHeaders: ['Tồn kho', 'Khách đặt'], options: { weightedInventoryCost: true }
  },
  [CONFIG.SHEET_CUSTOMERS]: {
    codeHeader: 'Mã khách hàng', additiveHeaders: ['Nợ hiện tại', 'Tổng bán', 'Tổng doanh thu'], options: {}
  },
  [CONFIG.SHEET_SUPPLIERS]: {
    codeHeader: 'Mã NCC', additiveHeaders: ['Nợ cần trả', 'Tổng mua', 'Tổng mua trừ trả hàng'], options: {}
  },
  [CONFIG.SHEET_CATEGORIES]: { codeHeader: 'Mã nhóm hàng', additiveHeaders: [], options: {} }
};

/**
 * Gop cac dong thuc the (san pham/khach/NCC) cua nhieu co so vat ly theo ma —
 * `branchSources` = [{ branch, sheets: { [sheetName]: [header, ...rows] } }].
 * Tra ve [header, ...rows] (hoac null neu sheet khong co quy tac gop thuc the).
 */
function mergeEntityRows(branchSources, sheetName) {
  const spec = Object.prototype.hasOwnProperty.call(ENTITY_MERGE_SPECS, sheetName) ? ENTITY_MERGE_SPECS[sheetName] : null;
  if (!spec) return null;
  return mergeEntitySheet(branchSources, sheetName, spec.codeHeader, spec.additiveHeaders, spec.options);
}

function mergeDashboardSheets(branchSources) {
  const sheetNames = new Set(branchSources.flatMap(source => Object.keys(source.sheets || {})));
  const merged = {};
  sheetNames.forEach(sheetName => {
    if ([CONFIG.SHEET_INVOICES, CONFIG.SHEET_ORDERS, CONFIG.SHEET_RETURNS, CONFIG.SHEET_INVOICE_DETAILS, CONFIG.SHEET_PURCHASES].includes(sheetName)) {
      merged[sheetName] = mergeTransactionalSheet(branchSources, sheetName);
    } else if (Object.prototype.hasOwnProperty.call(ENTITY_MERGE_SPECS, sheetName)) {
      merged[sheetName] = mergeEntityRows(branchSources, sheetName);
    } else {
      merged[sheetName] = concatenateSheet(branchSources, sheetName);
    }
  });
  return merged;
}

function mergeRollupRows(branchSources, field, keyOf, additiveFields, sort) {
  const merged = new Map();
  branchSources.forEach(source => {
    const rows = source.rollups[field] || [];
    rows.forEach(row => {
      const key = keyOf(row);
      if (!merged.has(key)) merged.set(key, { ...row });
      else {
        const target = merged.get(key);
        additiveFields.forEach(additiveField => {
          target[additiveField] = (Number(target[additiveField]) || 0) + (Number(row[additiveField]) || 0);
        });
        if (
          (!target.name && row.name) ||
          (target._hasDisplayName === false && row._hasDisplayName === true)
        ) {
          target.name = row.name;
          if (row._hasDisplayName === true) target._hasDisplayName = true;
        }
      }
    });
  });
  const rows = Array.from(merged.values());
  if (sort) rows.sort(sort);
  return rows;
}

function mergeDashboardRollups(branchSources) {
  const firstPurchaseByCode = new Map();
  branchSources.forEach(source => (source.rollups.firstPurchaseRows || []).forEach(row => {
    const key = normalizeSearchValue(row.code);
    const current = firstPurchaseByCode.get(key);
    const date = parseSheetDate(row.firstPurchaseDateText);
    const currentDate = current && parseSheetDate(current.firstPurchaseDateText);
    if (!current) firstPurchaseByCode.set(key, { ...row });
    else if (date && (!currentDate || date.getTime() < currentDate.getTime())) current.firstPurchaseDateText = row.firstPurchaseDateText;
  }));

  const newPurchaseOrdersRaw = branchSources
    .flatMap(source => (source.rollups.newPurchaseOrdersRaw || []).map(row => ({ ...row, branch: source.branch })))
    .sort((a, b) => (parseSheetDate(b.date)?.getTime() || 0) - (parseSheetDate(a.date)?.getTime() || 0));
  const invoiceQuantityRows = branchSources.flatMap(source =>
    (source.rollups.invoiceQuantityRows || []).map(row => ({ ...row, branch: source.branch }))
  );

  return {
    overviewRevenueRows: mergeRollupRows(
      branchSources,
      'overviewRevenueRows',
      row => row.dateKey,
      ['revenue', 'invoiceCount'],
      (a, b) => (parseSheetDate(a.dateKey)?.getTime() || 0) - (parseSheetDate(b.dateKey)?.getTime() || 0)
    ),
    invoicesRevenueRows: mergeRollupRows(
      branchSources,
      'invoicesRevenueRows',
      row => row.dateKey,
      ['revenue', 'invoiceCount'],
      (a, b) => (parseSheetDate(a.dateKey)?.getTime() || 0) - (parseSheetDate(b.dateKey)?.getTime() || 0)
    ),
    productSalesRows: mergeRollupRows(
      branchSources,
      'productSalesRows',
      row => normalizeSearchValue(row.code),
      ['qty', 'revenue']
    ),
    firstPurchaseRows: Array.from(firstPurchaseByCode.values()),
    purchaseTotals: branchSources.reduce((totals, source) => ({
      orderCount: totals.orderCount + (Number(source.rollups.purchaseTotals?.orderCount) || 0),
      total: totals.total + (Number(source.rollups.purchaseTotals?.total) || 0)
    }), { orderCount: 0, total: 0 }),
    newPurchaseOrdersRaw,
    invoiceQuantityRows
  };
}

function buildDebtManagementForBranch(source, canEditDebtStatus) {
  const debtManagement = deriveDebtManagement({
    managementRows: source.debtManagementSource?.rows,
    branch: source.branch,
    sourceSheet: source.debtManagementSource?.sourceSheet || (source.branch === BRANCHES.SAIGON
      ? CONFIG.DEBT_MANAGEMENT_SHEET_SG
      : CONFIG.DEBT_MANAGEMENT_SHEET_HN),
    operationalSheets: {
      HN1: source.sheets.HN1,
      HN3: source.sheets.HN3,
      HN7: source.sheets.HN7
    },
    workflowStatuses: source.debtWorkflow?.statuses || [],
    workflowAvailable: source.debtWorkflow?.available !== false,
    userCanEdit: canEditDebtStatus
  });
  if (source.debtManagementSource?.error) {
    debtManagement.dataWarnings.unshift(`Không tải được workbook công nợ: ${source.debtManagementSource.error.message || 'Lỗi không xác định'}.`);
  }
  return debtManagement;
}

function mergeDebtManagementSources(branchSources, canEditDebtStatus) {
  const derivedSources = branchSources.map(source => ({
    branch: source.branch,
    source: source.debtManagementSource,
    data: buildDebtManagementForBranch(source, canEditDebtStatus)
  }));
  const sources = derivedSources.map(item => ({
    branch: item.branch,
    sourceSheet: item.data.sourceSheet,
    available: item.data.available,
    error: item.source?.error?.message || null
  }));
  const dataWarnings = derivedSources.flatMap(item =>
    (item.data.dataWarnings || []).map(warning => `${item.branch}: ${warning}`)
  );
  const customersByKey = new Map();
  derivedSources.forEach(item => (item.data.customers || []).forEach(customer => {
    const key = customer.customerKey || normalizeSearchValue(customer.customerName);
    const detail = { branch: item.branch, sourceSheet: item.data.sourceSheet, ...customer };
    if (!customersByKey.has(key)) {
      customersByKey.set(key, {
        ...customer,
        openingDebt: 0,
        currentDebt: 0,
        overdueDebt: 0,
        alertCodes: [],
        dataIssues: [],
        branchDetails: []
      });
    }
    const merged = customersByKey.get(key);
    merged.openingDebt += Number(customer.openingDebt) || 0;
    merged.currentDebt += Number(customer.currentDebt) || 0;
    merged.overdueDebt += Number(customer.overdueDebt) || 0;
    merged.alertCodes = Array.from(new Set([...merged.alertCodes, ...(customer.alertCodes || [])]));
    merged.dataIssues = Array.from(new Set([...merged.dataIssues, ...(customer.dataIssues || [])]));
    merged.needsAction = Boolean(merged.needsAction || customer.needsAction);
    merged.canEditStatus = Boolean(merged.canEditStatus || customer.canEditStatus);
    merged.branchDetails.push(detail);
  }));
  const customers = Array.from(customersByKey.values());
  const totalCurrentDebt = customers.reduce((sum, customer) => sum + (Number(customer.currentDebt) || 0), 0);
  const totalOverdueDebt = customers.reduce((sum, customer) => sum + (Number(customer.overdueDebt) || 0), 0);
  const totalAverageSales = derivedSources.reduce((sum, item) => {
    return sum + (Number(item.data[DEBT_TOTAL_AVERAGE_SALES]) || 0);
  }, 0);
  const toTopItem = customer => ({
    customerKey: customer.customerKey,
    customerName: customer.customerName,
    sale: customer.sale,
    paymentSchedule: customer.paymentSchedule,
    currentDebt: customer.currentDebt,
    overdueDebt: customer.overdueDebt,
    needsAction: customer.needsAction
  });
  const summarizeBy = (field, values) => {
    const map = new Map((values || []).map(value => [value, {
      [field]: value, totalCurrentDebt: 0, totalOverdueDebt: 0, actionCustomerCount: 0, customerCount: 0
    }]));
    customers.forEach(customer => {
      const value = customer[field];
      if (!map.has(value)) map.set(value, {
        [field]: value, totalCurrentDebt: 0, totalOverdueDebt: 0, actionCustomerCount: 0, customerCount: 0
      });
      const summary = map.get(value);
      summary.totalCurrentDebt += Number(customer.currentDebt) || 0;
      summary.totalOverdueDebt += Number(customer.overdueDebt) || 0;
      summary.customerCount += 1;
      if (customer.needsAction) summary.actionCustomerCount += 1;
    });
    return Array.from(map.values());
  };
  const bySale = summarizeBy('sale')
    .sort((a, b) => b.totalOverdueDebt - a.totalOverdueDebt || b.totalCurrentDebt - a.totalCurrentDebt || String(a.sale).localeCompare(String(b.sale), 'vi'))
    .slice(0, 15);
  const scheduleSummaries = summarizeBy('paymentSchedule', PAYMENT_SCHEDULES);
  const scheduleMap = new Map(scheduleSummaries.map(summary => [summary.paymentSchedule, summary]));

  return {
    available: derivedSources.some(item => item.data.available),
    sourceSheet: sources.map(source => source.sourceSheet).filter(Boolean).join(' + '),
    sources,
    dataWarnings,
    kpi: {
      totalCurrentDebt,
      totalOverdueDebt,
      actionCustomerCount: customers.filter(customer => customer.needsAction).length,
      overdueToSalesRatio: totalAverageSales > 0 ? totalOverdueDebt / totalAverageSales : 0
    },
    bySale,
    byPaymentSchedule: PAYMENT_SCHEDULES.map(paymentSchedule => scheduleMap.get(paymentSchedule)),
    topCurrentDebt: customers.filter(customer => customer.currentDebt > 0)
      .sort((a, b) => b.currentDebt - a.currentDebt).slice(0, 10).map(toTopItem),
    topOverdueDebt: customers.filter(customer => customer.overdueDebt > 0)
      .sort((a, b) => b.overdueDebt - a.overdueDebt).slice(0, 10).map(toTopItem),
    customers
  };
}

const DASHBOARD_RESULT_CACHE_TTL_MS = DASHBOARD_SHEETS_CACHE_TTL_MS; // ket qua tinh toan khong the "tuoi" hon du lieu tho dung de tinh ra no
const DASHBOARD_RESULT_CACHE_MAX_ENTRIES = 32; // chan bo nho: filters den tu query string nen so bo loc khac nhau la khong gioi han
let dashboardResultCache = new Map(); // key: `${branch}|${sheetsVersion}|${JSON.stringify(filters)}` -> { data, expiresAt }
let computeCallCountForTest = 0; // chi dung trong test, xem __test__ o cuoi file

// Co so nam TRONG key (khong phai Map rieng) de mot key cu the luon thuoc dung
// mot co so — hai co so co the trung sheetsVersion nhung khong bao gio trung key.
function dashboardResultCacheKey(branch, sourceVersions, filters) {
  return (branch || BRANCHES.HANOI) + '|' + sourceVersions + '|' + JSON.stringify(filters || {});
}

/**
 * Goi song song toan bo du lieu tu dashboardRollupRepository.js can cho
 * computeDashboardData() — thay cho viec quet "Chi tiết hóa đơn"/"Nhập hàng"
 * trong Node.js. KHONG co cache rieng o day (moi bang rollup da nho + co
 * index, ban than Postgres du nhanh); dashboardResultCache o getDashboardData
 * chiu trach nhiem tranh goi lai ham nay khi bo loc + phien ban sheets/debt
 * khong doi (xem "precheck" trong getDashboardData).
 */
async function fetchDashboardRollups(branch, { overviewRange, productsRange, invoicesRange, newPurchasesRange }) {
  const overviewBounds = rangeToDateBounds(overviewRange);
  const invoicesBounds = rangeToDateBounds(invoicesRange);
  const productsBounds = rangeToDateBounds(productsRange);
  const newPurchasesBounds = rangeToDateBounds(newPurchasesRange);

  const [
    overviewRevenueRows, invoicesRevenueRows, productSalesRows,
    firstPurchaseRows, purchaseTotals, newPurchaseOrdersRaw, invoiceQuantityRows
  ] = await Promise.all([
    dashboardRollupRepository.getInvoiceRevenueByDay({ branch, from: overviewBounds.from, to: overviewBounds.to }),
    dashboardRollupRepository.getInvoiceRevenueByDay({ branch, from: invoicesBounds.from, to: invoicesBounds.to }),
    dashboardRollupRepository.getProductSalesBreakdown({
      branch,
      from: productsBounds.from,
      to: productsBounds.to,
      preserveNameSource: true
    }),
    dashboardRollupRepository.getFirstPurchaseDates({ branch }),
    dashboardRollupRepository.getPurchaseTotals({ branch }),
    dashboardRollupRepository.listPurchaseOrders({ branch, from: newPurchasesBounds.from, to: newPurchasesBounds.to }),
    dashboardRollupRepository.getInvoiceQuantitiesByCode({ branch, from: invoicesBounds.from, to: invoicesBounds.to })
  ]);

  return {
    overviewRevenueRows, invoicesRevenueRows, productSalesRows,
    firstPurchaseRows, purchaseTotals, newPurchaseOrdersRaw, invoiceQuantityRows
  };
}

async function loadDashboardBranchSources(branch, ranges, physicalBranch = branch || BRANCHES.HANOI) {
  const [sheets, debtManagementSource, debtWorkflow, rollups] = await Promise.all([
    getCachedDashboardCoreSheets(branch),
    getCachedDebtManagementSource(branch),
    getCachedDebtWorkflow(branch),
    fetchDashboardRollups(branch, ranges)
  ]);
  return { branch: physicalBranch, sheets, debtManagementSource, debtWorkflow, rollups };
}

function dashboardSourceVersion(branch) {
  return `${branch}:${dashboardCoreSheetsCacheFor(branch).version}:${debtManagementSheetsCacheFor(branch).version}:${debtWorkflowCacheFor(branch).version}`;
}

/**
 * Ham chinh lay du lieu cho dashboard — wrapper them cache ket qua da tinh
 * theo tung bo loc, tranh chay lai toan bo tinh toan ben duoi khi client doi
 * tab/poll lai voi CUNG bo loc trong luc du lieu tho (dashboardCoreSheetsCache)
 * chua het han.
 * @param {Object} filters - xem computeDashboardData
 * @returns {Object} Du lieu KPI, bieu do, bang xep hang cho dashboard
 */
async function getDashboardData(filters, branch, viewer) {
  const f = filters || {};
  // Khop CHINH XAC voi guard cua PATCH /api/debt-management/status — neu khac
  // thi nut sua trong bang se hien ra roi API tra 403 (hoac nguoc lai).
  const canEditDebtStatus = hasFeature(viewer, 'reports.debt.edit');
  const requestedBranch = branch || BRANCHES.HANOI;
  const branchScope = resolveBranchScope(requestedBranch);
  if (!branchScope.length) {
    const error = new Error(`Cơ sở không hợp lệ: ${branch}`);
    error.code = 'INVALID_BRANCH';
    error.statusCode = 400;
    throw error;
  }
  const now = new Date();
  const overviewRange = resolveFilterRange(f.overview, now);
  const productsRange = resolveFilterRange(f.products, now);
  const invoicesRange = resolveFilterRange(f.invoices, now);
  const newPurchasesRange = resolveFilterRange(f.newPurchases, now);
  const ranges = { overviewRange, productsRange, invoicesRange, newPurchasesRange };
  const branchSources = await Promise.all(branchScope.map(physicalBranch => {
    const sourceArgument = branch == null && branchScope.length === 1 ? undefined : physicalBranch;
    return loadDashboardBranchSources(sourceArgument, ranges, physicalBranch);
  }));
  const sourceVersions = branchScope.map(dashboardSourceVersion).join(';');
  const cacheKey = dashboardResultCacheKey(requestedBranch, `${sourceVersions}:${canEditDebtStatus ? 'edit' : 'read'}`, f);

  const cached = dashboardResultCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  // Du lieu tho da sang phien ban moi (fetch lai) -> moi ket qua cache cu deu
  // tinh tu du lieu cu, don sach de Map khong phinh vo han qua nhieu phien ban.
  // Chi don entry CUA CHINH CO SO nay (tien to `${branch}|`) — entry cua co so
  // khac co vong doi rieng.
  const branchPrefix = requestedBranch + '|';
  for (const key of dashboardResultCache.keys()) {
    if (key.startsWith(branchPrefix) && !key.startsWith(branchPrefix + sourceVersions + ':')) {
      dashboardResultCache.delete(key);
    }
  }

  let data;
  if (branchSources.length === 1) {
    const source = branchSources[0];
    data = computeDashboardData(
      source.sheets,
      f,
      now,
      source.debtManagementSource,
      source.branch,
      source.debtWorkflow,
      canEditDebtStatus,
      source.rollups
    );
  } else {
    const debtManagement = mergeDebtManagementSources(branchSources, canEditDebtStatus);
    data = computeDashboardData(
      mergeDashboardSheets(branchSources),
      f,
      now,
      null,
      BRANCH_BOTH,
      null,
      canEditDebtStatus,
      mergeDashboardRollups(branchSources),
      debtManagement
    );
  }
  dashboardResultCache.set(cacheKey, { data, expiresAt: Date.now() + DASHBOARD_RESULT_CACHE_TTL_MS });
  // Gioi han so entry trong Map — Map giu thu tu insertion nen phan tu dau tien
  // luon la entry cu nhat, xoa dan cho toi khi ve lai duoi muc tran.
  while (dashboardResultCache.size > DASHBOARD_RESULT_CACHE_MAX_ENTRIES) {
    dashboardResultCache.delete(dashboardResultCache.keys().next().value);
  }
  return data;
}

/**
 * Tinh toan toan bo du lieu dashboard tu du lieu tho da doc (sheets) va bo
 * loc. Ham thuan (khong tu fetch, khong cache) de getDashboardData ben tren
 * co the cache ket qua theo (phien ban du lieu tho + bo loc).
 * @param {Object} sheets - map ten sheet -> mang 2 chieu, tu getCachedDashboardSheets()
 * @param {Object} filters - Bo loc rieng cho tung tab. Moi bo loc thoi gian co
 *   dang { mode: 'days'|'range'|'all', days?, from?, to? }; products co them
 *   status: 'all'|'Đang kinh doanh'|'Ngừng kinh doanh'.
 * @param {Date} now
 * @returns {Object} Du lieu KPI, bieu do, bang xep hang cho dashboard
 */
function computeDashboardData(sheets, filters, now, debtManagementSource, branch, debtWorkflow, canEditDebtStatus, rollups, debtManagementOverride) {
  computeCallCountForTest += 1;
  const f = filters || {};
  rollups = rollups || {};
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

  const debtManagement = debtManagementOverride || buildDebtManagementForBranch({
    branch,
    sheets,
    debtManagementSource,
    debtWorkflow
  }, canEditDebtStatus);

  const categoryData = sheets[CONFIG.SHEET_CATEGORIES];
  const prodData = sheets[CONFIG.SHEET_PRODUCTS];
  const invData = sheets[CONFIG.SHEET_INVOICES];
  // "Chi tiết hóa đơn"/"Nhập hàng" KHONG con doc tu `sheets` o day — 2 tab
  // nang nhat, da bo khoi cache "core" (xem getCachedDashboardCoreSheets()) va
  // duoc thay bang dashboardRollupRepository.js qua tham so `rollups`.
  const orderData = sheets[CONFIG.SHEET_ORDERS];
  const returnData = sheets[CONFIG.SHEET_RETURNS];
  const custData = sheets[CONFIG.SHEET_CUSTOMERS];
  const customerReportData = sheets[CONFIG.SHEET_CUSTOMER_REPORT] || [];
  const supplierData = sheets[CONFIG.SHEET_SUPPLIERS];

  // ---------- HÀNG HÓA ----------
  // Doc theo ten cot de schema co the bo cot khong dung ma khong lam lech KPI.
  // Toan bo phan nay la so lieu TON KHO TAI THOI DIEM HIEN TAI (snapshot) —
  // khong gan voi 1 ngay phat sinh cu the nen KHONG loc theo bo loc thoi gian.
  let totalProducts = 0, totalStock = 0, inStockCodes = 0, activeProducts = 0, inactiveProducts = 0, lowStock = [];
  let stockList = [];
  const parentCategoryMap = {};
  const productParentCategoryByCode = new Map();
  const productChildCategoryByCode = new Map();
  const productStatusByCode = new Map();
  const resolveParentCategory = buildParentCategoryResolver(categoryData);
  const productHeaders = prodData[0] || [];
  const productIndex = (header, fallback) => {
    const index = productHeaders.findIndex(value => String(value || '').trim() === header);
    return index >= 0 ? index : fallback;
  };
  const productCodeIndex = productIndex('Mã hàng', 0);
  const productNameIndex = productIndex('Tên hàng', 1);
  const productCategoryIndex = productIndex('Nhóm hàng', 2);
  const productTypeIndex = productIndex('Loại hàng', 4);
  const productCostIndex = productIndex('Giá vốn', 5);
  const productPriceIndex = productIndex('Giá bán', 6);
  const productStockIndex = productIndex('Tồn kho', 7);
  const productReservedIndex = productIndex('Khách đặt', 8);
  const productStatusIndex = productIndex('Trạng thái', 9);
  const productCategoryIdIndex = productIndex('Mã nhóm hàng', 11);
  const productCreatedDateIndex = productHeaders.findIndex(header => String(header || '').trim() === 'Ngày tạo');
  const todayNewProducts = [];

  for (let r = 1; r < prodData.length; r++) {
    const row = prodData[r];
    const code = row[productCodeIndex];
    if (!code || isVatProductCode(code)) continue;
    const ton = Number(row[productStockIndex]) || 0;
    const cost = Math.max(Number(row[productCostIndex]) || 0, 0);
    const price = Math.max(Number(row[productPriceIndex]) || 0, 0);
    const stockValue = Math.max(ton, 0) * cost;
    const reserved = Number(row[productReservedIndex]) || 0;
    const status = String(row[productStatusIndex] || 'Đang kinh doanh').trim();
    productStatusByCode.set(String(code).trim(), status);
    const categoryName = (row[productCategoryIndex] && String(row[productCategoryIndex]).trim()) || '';
    const categoryId = productCategoryIdIndex >= 0 ? row[productCategoryIdIndex] : '';
    const parentCategoryName = resolveParentCategory(categoryName, categoryId);

    const createdAt = productCreatedDateIndex >= 0 ? parseSheetDate(row[productCreatedDateIndex]) : null;
    if (createdAt && isWithinRange(createdAt, newProductsRange)) {
      todayNewProducts.push({
        code,
        name: row[productNameIndex] || code,
        category: row[productCategoryIndex] || 'Chưa phân nhóm',
        parentCategory: parentCategoryName,
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
    stockList.push({ code, name: row[productNameIndex], stock: ton, reserved, status });
    if (ton === OUT_OF_STOCK_LEVEL) {
      lowStock.push({
        code,
        name: row[productNameIndex],
        type: row[productTypeIndex] || '—',
        status,
        cost,
        price
      });
    }

    productParentCategoryByCode.set(String(code).trim(), parentCategoryName);
    productChildCategoryByCode.set(String(code).trim(), categoryName || 'Chưa phân nhóm');
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
  // Ngay nhap SOM NHAT cho tung ma hang, tu product_first_purchase (rollup
  // toan bo lich su, khong gioi han cua so refresh — xem
  // dashboardRollupRepository.getFirstPurchaseDates()) thay vi tu quet sheet
  // "Nhập hàng" (da bo khoi cache "core", xem ke hoach rollup dashboard). Mot
  // ma chi xuat hien neu ngay nhap dau tien nam trong khoang cua tab Hang hoa
  // va khop bo loc trang thai kinh doanh dang chon.
  const firstPurchaseRows = (rollups && rollups.firstPurchaseRows) || [];
  const newlyImportedProducts = [];
  firstPurchaseRows.forEach(entry => {
    const code = entry.code;
    if (!code || isVatProductCode(code)) return;
    const importDate = parseSheetDate(entry.firstPurchaseDateText);
    if (!importDate || !isWithinRange(importDate, productsRange)) return;
    const currentProductStatus = productStatusByCode.get(String(code).trim());
    if (productStatusFilter !== 'all' && currentProductStatus !== productStatusFilter) return;
    newlyImportedProducts.push({
      code,
      name: entry.name || code,
      firstImportDate: formatDMY(importDate),
      daysOnHand: daysSince(importDate),
      _sortTime: importDate.getTime()
    });
  });
  newlyImportedProducts.sort((a, b) => b._sortTime - a._sortTime);
  const newlyImportedCodeSet = new Set(newlyImportedProducts.map(p => String(p.code).trim()));

  // ---------- HÓA ĐƠN: index 1 lần, dùng lại cho mọi bộ lọc ----------
  // Cột: [0]Mã hóa đơn [1]Ngày bán [2]Khách hàng [3]SĐT khách [4]Nhân viên bán [5]Chi nhánh [6]Tổng tiền hàng [7]Giảm giá [8]Khách đã trả [9]Trạng thái
  // Tong so luong tung hoa don de bao cao co cot SL nhu KiotViet — truy van
  // rieng, gioi han theo invoicesRange (dashboardRollupRepository truy van
  // truc tiep invoice_details/invoices, KHONG dung "Chi tiết hóa đơn" da bo
  // khoi cache "core"; xem fetchDashboardRollups()).
  const invoiceQuantityMap = new Map();
  ((rollups && rollups.invoiceQuantityRows) || []).forEach(row => {
    const code = String(row.code || '').trim();
    invoiceQuantityMap.set(row.branch ? invoiceIdentity(row.branch, code) : code, row.quantity);
  });

  let revenueToday = 0, invoicesToday = 0, cancelledToday = 0;
  const invoiceRecords = [];
  const invoiceHeaders = invData[0] || [];
  const invoiceBranchIndex = sheetHeaderIndex(invoiceHeaders, 'Chi nhánh');

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
      branch: branch === BRANCH_BOTH ? row[invoiceBranchIndex] || '' : undefined,
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
  }

  // Doanh thu theo ngay cua tab Tong quan/Hoa don — tu daily_invoice_summary
  // (rollup, chi gom status=3 Hoan thanh, xem dashboardRollupRepository.getInvoiceRevenueByDay())
  // thay vi tu gom lai `invoiceRecords` trong JS moi request.
  const overviewPeriod = buildRevenuePeriodFromRollup(overviewRange, (rollups && rollups.overviewRevenueRows) || []);
  const transactionsReport = buildTransactionsReport(invoicesRange, invoiceRecords, invoiceQuantityMap, branch === BRANCH_BOTH);

  const invoicesPeriod = buildRevenuePeriodFromRollup(invoicesRange, (rollups && rollups.invoicesRevenueRows) || []);
  const periodCancelledInvoices = invoiceRecords.filter(
    record => record.isCancelled && isWithinRange(record._dt, invoicesRange)
  ).length;

  // ---------- SẢN PHẨM BÁN CHẠY -> TOP SẢN PHẨM/NHÓM HÀNG (theo bộ lọc Hàng hóa) ----------
  // Nguon: daily_product_sales (rollup, da tong hop san theo ma hang cho
  // productsRange, loai hoa don status=2 "Đã hủy" tu luc refresh — xem
  // dashboardRollupRepository.getProductSalesBreakdown()) thay vi quet "Chi
  // tiết hóa đơn" (da bo khoi cache "core"). Nhom cha/con van tra cuu qua
  // productParentCategoryByCode/productChildCategoryByCode (tu tab Hang
  // hoa/Nhom hang, van con trong cache "core").
  const productSalesMap = {};
  const parentCategorySalesMap = {};
  const childCategorySalesMap = {};
  const newlyImportedCategorySalesMap = {};
  const newlyImportedProductSalesMap = new Map();
  const productSalesRows = (rollups && rollups.productSalesRows) || [];
  productSalesRows.forEach(row => {
    const code = row.code;
    if (!code) return;
    const trimmedCode = String(code).trim();
    const currentProductStatus = productStatusByCode.get(trimmedCode);
    if (productStatusFilter !== 'all' && currentProductStatus !== productStatusFilter) return;

    const name = row.name || code;
    const qty = row.qty;
    const revenue = row.revenue;

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

    const childCategoryName = productChildCategoryByCode.get(trimmedCode) || 'Chưa phân nhóm';
    if (!childCategorySalesMap[parentCategoryName]) childCategorySalesMap[parentCategoryName] = {};
    if (!childCategorySalesMap[parentCategoryName][childCategoryName]) {
      childCategorySalesMap[parentCategoryName][childCategoryName] = {
        name: childCategoryName,
        qty: 0,
        revenue: 0,
        productCodes: new Set()
      };
    }
    childCategorySalesMap[parentCategoryName][childCategoryName].qty += qty;
    childCategorySalesMap[parentCategoryName][childCategoryName].revenue += revenue;
    childCategorySalesMap[parentCategoryName][childCategoryName].productCodes.add(trimmedCode);

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
  });
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

  // ---------- DOANH THU/SL BÁN THEO NHÓM CON, GOM THEO TỪNG NHÓM CHA ----------
  // Dung cho phan "chon 1 nhom cha -> xem chi tiet nhom con" o tab Hang hoa.
  const childCategorySalesByParent = {};
  Object.keys(childCategorySalesMap).forEach(parentName => {
    childCategorySalesByParent[parentName] = Object.values(childCategorySalesMap[parentName])
      .map(category => ({
        name: category.name,
        qty: category.qty,
        revenue: category.revenue,
        productCount: category.productCodes.size
      }))
      .sort((a, b) => b.revenue - a.revenue);
  });
  const availableParentCategories = Object.keys(parentCategoryMap).sort((a, b) => a.localeCompare(b, 'vi'));

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

  // Gom nhóm sản phẩm mới nhập theo nhóm hàng cha (số lượng sản phẩm)
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
      ...(branch === BRANCH_BOTH ? { branch: row[4] || '' } : {}),
      _dt: dt, _sortTime: dt ? dt.getTime() : 0
    });
  }
  const ordersInRange = orderRecords.filter(o => isWithinRange(o._dt, invoicesRange));
  let pendingOrdersCount = 0, pendingOrdersTotal = 0;
  ordersInRange.forEach(o => {
    if (PENDING_ORDER_STATUSES.has(o.status)) { pendingOrdersCount++; pendingOrdersTotal += o.total; }
  });
  // Toan bo dat hang trong khoang loc (khong cat top-N) — bang FE tu phan trang 100 dong/trang.
  const periodOrders = ordersInRange
    .slice()
    .sort((a, b) => b._sortTime - a._sortTime)
    .map(({ _dt, _sortTime, ...rest }) => rest);

  // ---------- TRẢ HÀNG (theo bộ lọc Hóa đơn) ----------
  const returnHeaders = returnData[0] || [];
  const returnIndex = (header, fallback) => {
    const index = returnHeaders.findIndex(value => String(value || '').trim() === header);
    return index >= 0 ? index : fallback;
  };
  const returnCodeIndex = returnIndex('Mã trả hàng', 0);
  const returnDateIndex = returnIndex('Ngày trả', 1);
  const returnCustomerIndex = returnIndex('Khách hàng', 3);
  const returnTotalIndex = returnIndex('Tổng tiền trả', 4);
  const returnStatusIndex = returnIndex('Trạng thái', 5);
  const returnBranchIndex = returnIndex('Chi nhánh', -1);
  const returnRecords = [];
  for (let r = 1; r < returnData.length; r++) {
    const row = returnData[r];
    const code = row[returnCodeIndex];
    if (!code) continue;
    const dt = parseSheetDate(row[returnDateIndex]);
    returnRecords.push({
      code, date: row[returnDateIndex] || '', originalInvoiceCode: '', customer: row[returnCustomerIndex] || '',
      total: Number(row[returnTotalIndex]) || 0, status: row[returnStatusIndex] || '',
      ...(branch === BRANCH_BOTH ? { branch: returnBranchIndex >= 0 ? row[returnBranchIndex] || '' : '' } : {}),
      _dt: dt, _sortTime: dt ? dt.getTime() : 0
    });
  }
  const returnsInRange = returnRecords.filter(rt => isWithinRange(rt._dt, invoicesRange));
  const returnsCount = returnsInRange.length;
  const totalReturns = returnsInRange.reduce((sum, rt) => sum + rt.total, 0);
  // Toan bo tra hang trong khoang loc (khong cat top-N).
  const periodReturns = returnsInRange
    .slice()
    .sort((a, b) => b._sortTime - a._sortTime)
    .map(({ _dt, _sortTime, ...rest }) => rest);

  // ---------- KHÁCH HÀNG ----------
  const customerHeaders = custData[0] || [];
  const customerIndex = (header, fallback) => {
    const index = customerHeaders.findIndex(value => String(value || '').trim() === header);
    return index >= 0 ? index : fallback;
  };
  const customerCodeIndex = customerIndex('Mã khách hàng', 0);
  const customerNameIndex = customerIndex('Tên khách hàng', 1);
  const customerPhoneIndex = customerIndex('Điện thoại', 2);
  const customerDebtIndex = customerIndex('Nợ hiện tại', 7);
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
    const code = row[customerCodeIndex];
    if (!code) continue;
    totalCustomers++;
    const debt = Number(row[customerDebtIndex]) || 0;
    if (debt > 0) {
      customersWithDebt++;
      totalDebt += debt;
      const phoneKey = normalizePhone(row[customerPhoneIndex]);
      const periodRevenue = customerRevenueByPhone.get(phoneKey) || 0;
      const includeInPeriod = customersRange.mode === 'all' || customerRevenueByPhone.has(phoneKey);
      if (includeInPeriod) {
        topDebt.push({ code, name: row[customerNameIndex], phone: row[customerPhoneIndex], debt, periodRevenue });
      }
    }
  }
  topDebt.sort((a, b) => b.debt - a.debt);

  const topCustomersByRevenue = buildTopCustomersByRevenue(customersRange, customerReportData, invData, custData, returnData);

  // ---------- NHÀ CUNG CẤP ----------
  const supplierHeaders = supplierData[0] || [];
  const supplierIndex = (header, fallback) => {
    const index = supplierHeaders.findIndex(value => String(value || '').trim() === header);
    return index >= 0 ? index : fallback;
  };
  const supplierCodeIndex = supplierIndex('Mã NCC', 0);
  const supplierNameIndex = supplierIndex('Tên NCC', 1);
  const supplierPhoneIndex = supplierIndex('Điện thoại', 2);
  const supplierAddressIndex = supplierIndex('Địa chỉ', 4);
  const supplierDebtIndex = supplierIndex('Nợ cần trả', 5);
  let suppliers = [];
  let totalSupplierDebt = 0, suppliersWithDebt = 0;
  for (let r = 1; r < supplierData.length; r++) {
    const row = supplierData[r];
    const code = row[supplierCodeIndex];
    if (!code) continue;
    const debt = Number(row[supplierDebtIndex]) || 0;
    if (debt > 0) { suppliersWithDebt++; totalSupplierDebt += debt; }
    suppliers.push({
      code,
      name: row[supplierNameIndex],
      phone: row[supplierPhoneIndex],
      email: '',
      address: row[supplierAddressIndex],
      debt
    });
  }
  suppliers.sort((a, b) => b.debt - a.debt);
  const totalSuppliers = suppliers.length;

  // ---------- NHẬP HÀNG ----------
  // purchaseOrdersCount/totalPurchaseSpend la KPI TOAN THOI GIAN (khong loc
  // ngay) — tu daily_purchase_summary (rollup), xem
  // dashboardRollupRepository.getPurchaseTotals(). KHONG con quet sheet
  // "Nhập hàng" (da bo khoi cache "core").
  const purchaseTotalsRollup = (rollups && rollups.purchaseTotals) || { orderCount: 0, total: 0 };
  const purchaseOrdersCount = purchaseTotalsRollup.orderCount;
  const totalPurchaseSpend = purchaseTotalsRollup.total;

  // ---------- HÀNG NHẬP (tab Nhà cung cấp) ----------
  // Danh sach PHIEU NHAP rieng le trong newPurchasesRange — tu
  // dashboardRollupRepository.listPurchaseOrders() (doc THANG tu bang
  // `purchases`, KHONG dung bang rollup gom theo NCC vi can giu dung tung
  // phieu rieng le cho bang UI; xem ghi chu o do). Da duoc SQL loc dung
  // khoang ngay + sap xep moi nhat truoc, khong can loc/sap xep lai trong JS.
  const newPurchaseOrders = (rollups && rollups.newPurchaseOrdersRaw) || [];

  const newPurchaseSupplierMap = new Map();
  newPurchaseOrders.forEach(p => {
    const supplierName = String(p.supplier || '').trim();
    const normalizedSupplierCode = normalizeSearchValue(p.supplierCode);
    const normalizedSupplierName = normalizeSearchValue(supplierName);
    const supplierKey = normalizedSupplierCode
      ? `code:${normalizedSupplierCode}`
      : `name:${normalizedSupplierName || '(không xác định)'}`;
    if (!newPurchaseSupplierMap.has(supplierKey)) {
      newPurchaseSupplierMap.set(supplierKey, { name: '', namePriority: Infinity, orderCount: 0, total: 0 });
    }
    const supplier = newPurchaseSupplierMap.get(supplierKey);
    const sourceBranch = branch === BRANCH_BOTH ? p.branch : branch;
    const namePriority = sourceBranch === BRANCHES.HANOI ? 0 : sourceBranch === BRANCHES.SAIGON ? 1 : 2;
    if (supplierName && namePriority < supplier.namePriority) {
      supplier.name = supplierName;
      supplier.namePriority = namePriority;
    }
    supplier.orderCount += 1;
    supplier.total += p.total;
  });
  const newPurchasesBySupplier = Array.from(newPurchaseSupplierMap.values())
    .map(({ namePriority, ...supplier }) => ({ ...supplier, name: supplier.name || '(Không xác định)' }))
    .sort((a, b) => b.total - a.total)
    .slice(0, NEW_PURCHASES_SUPPLIER_LIMIT);

  const newPurchasesOrderCount = newPurchaseOrders.length;
  const newPurchasesTotalAmount = newPurchaseOrders.reduce((sum, p) => sum + p.total, 0);
  const newPurchasesSupplierCount = newPurchaseSupplierMap.size;

  return {
    updatedAt: formatDMYHMS(now),
    filters: {
      overview: overviewRange,
      products: productsRange,
      productStatus: productStatusFilter,
      invoices: invoicesRange,
      customers: customersRange,
      newPurchases: newPurchasesRange,
      newProducts: newProductsRange
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
      periodInvoices: overviewPeriod.periodInvoices
    },
    products: {
      newProducts: {
        label: newProductsRange.label,
        count: todayNewProductRows.length,
        dateColumnAvailable: productCreatedDateIndex >= 0,
        products: todayNewProductRows
      },
      topSellingProducts,
      topSellingParentCategories,
      childCategorySalesByParent,
      availableParentCategories,
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
      transactionsReport,
      periodOrders,
      periodReturns,
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
    debtManagement
  };
}

function invalidateDebtWorkflowCache(branch) {
  const cache = debtWorkflowCacheFor(branch);
  cache.data = null;
  cache.expiresAt = 0;
  cache.version += 1;
  const prefix = (branch || BRANCHES.HANOI) + '|';
  for (const key of dashboardResultCache.keys()) {
    if (key.startsWith(prefix)) dashboardResultCache.delete(key);
  }
}

module.exports = {
  getDashboardData,
  findDebtCustomerBranches,
  invalidateDebtWorkflowCache,
  searchDashboardRecords,
  searchTopCustomersByProducts,
  getCustomerProductRevenueReport,
  searchProductRevenueOverview,
  getProductRevenueDetail,
  mergeEntityRows,
  // Cac hook duoi day CHI phuc vu test (dashboardData.test.js) — khong dung
  // trong code san pham.
  __test__: {
    resetCaches() {
      dashboardSheetsCacheByBranch = new Map();
      dashboardCoreSheetsCacheByBranch = new Map();
      debtManagementSheetsCacheByBranch = new Map();
      debtWorkflowCacheByBranch = new Map();
      searchSheetCacheByBranch = new Map();
      aggregateFullSheetsCache = null;
      dashboardResultCache = new Map();
      productRevenueMapCacheByBranch = new Map();
      searchIndexBuildCountForTest = 0;
      computeCallCountForTest = 0;
    },
    // Cache "core" (7/9 tab) — dung cho getDashboardData() (kem xuat Excel qua exportService.js).
    expireSheetsCache(branch) {
      dashboardCoreSheetsCacheFor(branch).expiresAt = 0;
    },
    // Khac expireSheetsCache(): dat "vua qua han" (con trong cua so
    // DASHBOARD_SHEETS_MAX_STALE_MS) de test duong stale-while-revalidate —
    // expireSheetsCache() dat expiresAt=0 lam cache qua han QUA LAU (roi vao
    // nhanh phai cho fetch that, khac hanh vi can test o day).
    expireSheetsCacheSoftly(branch) {
      dashboardCoreSheetsCacheFor(branch).expiresAt = Date.now() - 1000;
    },
    // Cache "full" (9 tab) — dung cho /api/search.
    expireFullSheetsCache(branch) {
      dashboardSheetsCacheFor(branch).expiresAt = 0;
    },
    expireFullSheetsCacheSoftly(branch) {
      dashboardSheetsCacheFor(branch).expiresAt = Date.now() - 1000;
    },
    expireDebtManagementCache(branch) {
      debtManagementSheetsCacheFor(branch).expiresAt = 0;
    },
    getSearchIndexBuildCount: () => searchIndexBuildCountForTest,
    getComputeCallCount: () => computeCallCountForTest,
    getResultCacheSize: () => dashboardResultCache.size
  }
};
