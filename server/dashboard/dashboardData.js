// ==========================================
// DASHBOARD DATA — cung cap du lieu cho Web App (GET /api/dashboard)
// Doc tu sheet KiotViet export 9-tab (dong bo boi appsscript/KiotVietExport.gs)
// ==========================================
const CONFIG = require('../config');
const sheetsClient = require('../sheets/sheetsClient');

const OUT_OF_STOCK_LEVEL = 0;
const TOP_SELLING_LIMIT = 10;
const MAX_PARENT_CATEGORY_BARS = 30;
const SEARCH_CACHE_TTL_MS = 2 * 60 * 1000;
const PENDING_ORDER_STATUSES = new Set(['Phiếu tạm', 'Đang xử lý', 'Đã xác nhận']);
const DASHBOARD_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const DASHBOARD_UTC_OFFSET = '+07:00';
const DAY_MS = 24 * 60 * 60 * 1000;

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

  // Chuoi ISO khong kem offset cung la gio Viet Nam tu Google Sheets.
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

function stripSortKey(list) {
  return list.map(({ _sortTime, ...rest }) => rest);
}

function normalizeCategoryName(value) {
  return String(value || '').trim().toLocaleLowerCase('vi-VN');
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
  CONFIG.SHEET_PURCHASES
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
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeSearchValue(value) {
  return normalizeWhitespace(value)
    .toLocaleLowerCase('vi-VN')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

function rememberSearchSheets(sheets) {
  searchSheetCache.data = sheets;
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
      return sheets;
    })
    .finally(() => {
      if (searchSheetCache.loading === loading) searchSheetCache.loading = null;
    });
  searchSheetCache.loading = loading;
  return loading;
}

function getSearchMatchRank(code, name, query) {
  if (code === query) return 0;
  if (name === query) return 1;

  const compactCode = code.replace(/\s/g, '');
  const compactName = name.replace(/\s/g, '');
  const compactQuery = query.replace(/\s/g, '');
  if (compactCode === compactQuery) return 2;
  if (compactName === compactQuery) return 3;
  if (code.startsWith(query)) return 4;
  if (name.startsWith(query)) return 5;
  if (compactCode.startsWith(compactQuery)) return 6;
  if (compactName.startsWith(compactQuery)) return 7;
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
 * Tim ban ghi theo tien to cua ma hoac ten trong pham vi dashboard hien tai.
 * Ket qua kem toan bo cot cua dong nguon de giao dien hien thi dung nhu Sheet.
 */
async function searchDashboardRecords(view, rawQuery, rawLimit) {
  const scope = SEARCH_SCOPES[view] || SEARCH_SCOPES.overview;
  const queryText = normalizeWhitespace(rawQuery).slice(0, 120);
  const query = normalizeSearchValue(queryText);
  const wantsAllResults = String(rawLimit || '').toLocaleLowerCase('vi-VN') === 'all';
  const limit = wantsAllResults ? null : Math.min(Math.max(Number(rawLimit) || 8, 1), 50);
  if (!query) return { view, query: queryText, total: 0, results: [] };

  const sheets = await getSearchSheets();
  const matches = [];

  scope.forEach((sourceKey, sourceOrder) => {
    const source = SEARCH_SOURCES[sourceKey];
    const rows = sheets[source.sheetName] || [];
    const headers = rows[0] || [];

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex] || [];
      const code = normalizeWhitespace(row[source.codeIndex]);
      const name = normalizeWhitespace(row[source.nameIndex]);
      if (!code && !name) continue;

      const rank = getSearchMatchRank(
        normalizeSearchValue(code),
        normalizeSearchValue(name),
        query
      );
      if (rank < 0) continue;

      matches.push({
        id: `${sourceKey}:${rowIndex + 1}`,
        source: sourceKey,
        sourceLabel: source.label,
        code,
        name: name || code,
        fields: buildSearchFields(headers, row),
        _rank: rank,
        _sourceOrder: sourceOrder
      });
    }
  });

  matches.sort((a, b) =>
    a._rank - b._rank ||
    a._sourceOrder - b._sourceOrder ||
    a.code.localeCompare(b.code, 'vi', { numeric: true, sensitivity: 'base' }) ||
    a.name.localeCompare(b.name, 'vi', { sensitivity: 'base' })
  );

  return {
    view,
    query: queryText,
    total: matches.length,
    results: (limit === null ? matches : matches.slice(0, limit))
      .map(({ _rank, _sourceOrder, ...result }) => result)
  };
}

/**
 * Ham chinh lay du lieu cho dashboard.
 * @param {number} days - So ngay gan nhat de ve bieu do doanh thu (7/30/90). Mac dinh 30.
 * @returns {Object} Du lieu KPI, bieu do, bang xep hang cho dashboard
 */
async function getDashboardData(days) {
  days = Number(days) || 30;
  const now = new Date();
  const todayStr = formatDMY(now);

  const sheets = await sheetsClient.getMultipleSheetValues(SHEET_NAMES);
  rememberSearchSheets(sheets);
  const categoryData = sheets[CONFIG.SHEET_CATEGORIES];
  const prodData = sheets[CONFIG.SHEET_PRODUCTS];
  const invData = sheets[CONFIG.SHEET_INVOICES];
  const detailData = sheets[CONFIG.SHEET_INVOICE_DETAILS];
  const orderData = sheets[CONFIG.SHEET_ORDERS];
  const returnData = sheets[CONFIG.SHEET_RETURNS];
  const custData = sheets[CONFIG.SHEET_CUSTOMERS];
  const supplierData = sheets[CONFIG.SHEET_SUPPLIERS];
  const poData = sheets[CONFIG.SHEET_PURCHASES];

  // ---------- HÀNG HÓA ----------
  // Cột: [0]Mã hàng [1]Tên hàng [2]Nhóm hàng [3]Thương hiệu [4]Loại [5]Giá vốn [6]Giá bán [7]Tồn kho [8]Khách đặt [9]Trạng thái kinh doanh [10]Ngày sửa cuối [11]Mã nhóm hàng
  let totalProducts = 0, totalStock = 0, inStockCodes = 0, activeProducts = 0, inactiveProducts = 0, lowStock = [];
  let stockList = [];
  const parentCategoryMap = {};
  const resolveParentCategory = buildParentCategoryResolver(categoryData);
  const productHeaders = prodData[0] || [];
  const productCategoryIdIndex = productHeaders.findIndex(header => String(header || '').trim() === 'Mã nhóm hàng');

  for (let r = 1; r < prodData.length; r++) {
    const row = prodData[r];
    const code = row[0];
    if (!code) continue;
    totalProducts++;
    const ton = Number(row[7]) || 0;
    const cost = Math.max(Number(row[5]) || 0, 0);
    const stockValue = Math.max(ton, 0) * cost;
    const reserved = Number(row[8]) || 0;
    const status = row[9] || 'Đang kinh doanh';
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
        price: Math.max(Number(row[6]) || 0, 0)
      });
    }

    const categoryName = (row[2] && String(row[2]).trim()) || '';
    const categoryId = productCategoryIdIndex >= 0 ? row[productCategoryIdIndex] : '';
    const parentCategoryName = resolveParentCategory(categoryName, categoryId);
    if (!parentCategoryMap[parentCategoryName]) {
      parentCategoryMap[parentCategoryName] = { name: parentCategoryName, stock: 0, stockValue: 0, productCount: 0 };
    }
    parentCategoryMap[parentCategoryName].stock += Math.max(ton, 0);
    parentCategoryMap[parentCategoryName].stockValue += stockValue;
    parentCategoryMap[parentCategoryName].productCount += 1;
  }
  lowStock.sort((a, b) => a.stock - b.stock);

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
  const allStockValueByCategory = categoryList.filter(category => category.stockValue > 0).sort((a, b) => b.stockValue - a.stockValue);
  const inventoryValueCategoryCount = allStockValueByCategory.length;
  const totalInventoryValue = allStockValueByCategory.reduce((sum, category) => sum + category.stockValue, 0);
  const stockValueByCategory = limitParentCategoryBars(allStockValueByCategory);

  // ---------- HÓA ĐƠN ----------
  // Cột: [0]Mã hóa đơn [1]Ngày bán [2]Khách hàng [3]SĐT khách [4]Nhân viên bán [5]Chi nhánh [6]Tổng tiền hàng [7]Giảm giá [8]Khách đã trả [9]Trạng thái
  let revenueToday = 0, invoicesToday = 0, cancelledToday = 0;
  let recentInvoices = [];
  const cancelledInvoiceCodes = new Set();

  const dayBuckets = {};
  const dayOrder = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    const key = formatDMY(d);
    dayBuckets[key] = { revenue: 0, count: 0 };
    dayOrder.push(key);
  }

  for (let r = 1; r < invData.length; r++) {
    const row = invData[r];
    const code = row[0];
    if (!code) continue;
    const customer = row[2];
    const total = Number(row[6]) || 0;
    const status = row[9] || 'Hoàn thành';
    const isCancelled = status === 'Đã hủy';
    const isCompleted = status === 'Hoàn thành';
    if (isCancelled) cancelledInvoiceCodes.add(String(code).trim());

    const dt = parseSheetDate(row[1]);
    const dateKey = dt ? dmyKey(dt) : '';

    if (dateKey === todayStr) {
      if (isCancelled) cancelledToday++;
      else if (isCompleted) { revenueToday += total; invoicesToday++; }
    }

    if (isCompleted && dateKey && Object.prototype.hasOwnProperty.call(dayBuckets, dateKey)) {
      dayBuckets[dateKey].revenue += total;
      dayBuckets[dateKey].count += 1;
    }

    recentInvoices.push({ code, customer, total, status, time: row[1] || '', _sortTime: dt ? dt.getTime() : 0 });
  }
  recentInvoices.sort((a, b) => b._sortTime - a._sortTime);
  recentInvoices = stripSortKey(recentInvoices.slice(0, 8));

  const revenueByDay = dayOrder.map(key => ({
    date: key,
    label: key.substring(0, 5),
    revenue: dayBuckets[key].revenue,
    count: dayBuckets[key].count
  }));
  const periodRevenue = revenueByDay.reduce((s, d) => s + d.revenue, 0);
  const periodInvoices = revenueByDay.reduce((s, d) => s + d.count, 0);

  // ---------- CHI TIẾT HÓA ĐƠN -> TOP SẢN PHẨM BÁN CHẠY ----------
  // Cột: [0]Mã hóa đơn [1]Mã hàng [2]Tên hàng [3]Số lượng [4]Đơn giá [5]Giảm giá [6]Thành tiền
  const productSalesMap = {};
  for (let r = 1; r < detailData.length; r++) {
    const row = detailData[r];
    const invoiceCode = row[0];
    const code = row[1];
    if (!invoiceCode || !code) continue;
    if (cancelledInvoiceCodes.has(String(invoiceCode).trim())) continue;

    const name = row[2] || code;
    const qty = Number(row[3]) || 0;
    const revenue = Number(row[6]) || 0;

    if (!productSalesMap[code]) productSalesMap[code] = { code, name, qty: 0, revenue: 0 };
    productSalesMap[code].qty += qty;
    productSalesMap[code].revenue += revenue;
  }
  const topSellingProducts = Object.values(productSalesMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, TOP_SELLING_LIMIT);

  // ---------- ĐẶT HÀNG ----------
  // Cột: [0]Mã đặt hàng [1]Ngày đặt [2]Khách hàng [3]Nhân viên lập [4]Chi nhánh [5]Tổng tiền [6]Trạng thái
  let pendingOrdersCount = 0, pendingOrdersTotal = 0;
  let recentOrders = [];
  for (let r = 1; r < orderData.length; r++) {
    const row = orderData[r];
    const code = row[0];
    if (!code) continue;
    const dt = parseSheetDate(row[1]);
    const customer = row[2];
    const total = Number(row[5]) || 0;
    const status = row[6] || '';

    if (PENDING_ORDER_STATUSES.has(status)) { pendingOrdersCount++; pendingOrdersTotal += total; }
    recentOrders.push({ code, date: row[1] || '', customer, total, status, _sortTime: dt ? dt.getTime() : 0 });
  }
  recentOrders.sort((a, b) => b._sortTime - a._sortTime);
  recentOrders = stripSortKey(recentOrders.slice(0, 8));

  // ---------- TRẢ HÀNG ----------
  // Cột: [0]Mã trả hàng [1]Ngày trả [2]Mã hóa đơn gốc [3]Khách hàng [4]Tổng tiền trả [5]Trạng thái
  let returnsCount = 0, totalReturns = 0;
  let recentReturns = [];
  for (let r = 1; r < returnData.length; r++) {
    const row = returnData[r];
    const code = row[0];
    if (!code) continue;
    const dt = parseSheetDate(row[1]);
    const total = Number(row[4]) || 0;
    returnsCount++;
    totalReturns += total;
    recentReturns.push({
      code, date: row[1] || '', originalInvoiceCode: row[2] || '',
      customer: row[3] || '', total, status: row[5] || '', _sortTime: dt ? dt.getTime() : 0
    });
  }
  recentReturns.sort((a, b) => b._sortTime - a._sortTime);
  recentReturns = stripSortKey(recentReturns.slice(0, 8));

  // ---------- KHÁCH HÀNG ----------
  // Cột: [0]Mã khách hàng [1]Tên khách hàng [2]Điện thoại [3]Giới tính [4]Nhóm khách hàng [5]Địa chỉ [6]Email [7]Nợ hiện tại [8]Tổng bán
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
      topDebt.push({ code, name: row[1], phone: row[2], debt });
    }
  }
  topDebt.sort((a, b) => b.debt - a.debt);
  topDebt = topDebt.slice(0, 8);

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
  // Cột: [0]Mã nhập hàng [1]Ngày nhập [2]Nhà cung cấp [3]Chi nhánh [4]Tổng tiền [5]Trạng thái
  let purchaseOrdersCount = 0, totalPurchaseSpend = 0;
  let recentPurchaseOrders = [];
  for (let r = 1; r < poData.length; r++) {
    const row = poData[r];
    const code = row[0];
    if (!code) continue;
    const dt = parseSheetDate(row[1]);
    const total = Number(row[4]) || 0;
    purchaseOrdersCount++;
    totalPurchaseSpend += total;
    recentPurchaseOrders.push({
      code, date: row[1] || '', supplier: row[2] || '', branch: row[3] || '',
      total, status: row[5] || '', _sortTime: dt ? dt.getTime() : 0
    });
  }
  recentPurchaseOrders.sort((a, b) => b._sortTime - a._sortTime);
  recentPurchaseOrders = stripSortKey(recentPurchaseOrders.slice(0, 8));

  return {
    updatedAt: formatDMYHMS(now),
    days,
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
      periodRevenue,
      periodInvoices,
      pendingOrdersCount,
      pendingOrdersTotal,
      returnsCount,
      totalReturns,
      totalSuppliers,
      suppliersWithDebt,
      totalSupplierDebt,
      purchaseOrdersCount,
      totalPurchaseSpend
    },
    revenueByDay,
    recentInvoices,
    lowStock,
    stockValueByCategory,
    allProducts,
    topDebt,
    stockByCategory,
    topSellingProducts,
    recentOrders,
    recentReturns,
    suppliers,
    recentPurchaseOrders
  };
}

module.exports = { getDashboardData, searchDashboardRecords };
