'use strict';

const ExcelJS = require('exceljs');
const CONFIG = require('../config');
const dashboardData = require('./dashboardData');

const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const VALID_DEBT_PERIODS = new Set([1, 3, 7]);

const TABLE_TITLES = Object.freeze({
  'overview.transactions': 'Chi tiết giao dịch',
  'overview.purchases': 'Danh sách nhập hàng',
  'overview.new-products': 'Danh sách mã mới',
  'overview.deactivated': 'Hàng ngừng kinh doanh',
  'products.top-selling': 'Sản phẩm bán chạy',
  'products.low-stock': 'Hàng đã hết',
  'products.all': 'Tất cả mã hàng',
  'products.newly-imported': 'Hàng mới nhập',
  'products.child-categories': 'Chi tiết nhóm con',
  'invoices.orders': 'Đặt hàng gần đây',
  'invoices.returns': 'Trả hàng gần đây',
  'invoices.recent': 'Hóa đơn gần đây',
  'customers.revenue': 'Doanh thu theo khách',
  'customers.debt': 'Chi tiết khách nợ',
  'suppliers.list': 'Danh sách nhà cung cấp',
  'debt.period': 'Công nợ theo kỳ',
  'search.results': 'Kết quả tìm kiếm',
  'stockout.result': 'Kết quả đứt hàng'
});

function exportError(message, statusCode = 400, code = 'EXPORT_INVALID_REQUEST') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function normalizeCode(value) {
  return normalizeText(value).normalize('NFC').toLocaleLowerCase('vi-VN');
}

function normalizeFilterSpec(spec, fallbackMode = 'days') {
  const raw = spec && typeof spec === 'object' ? spec : {};
  const mode = ['days', 'range', 'all'].includes(raw.mode) ? raw.mode : fallbackMode;
  if (mode === 'all') return { mode: 'all' };
  if (mode === 'range') {
    return {
      mode: 'range',
      from: normalizeText(raw.from).slice(0, 10),
      to: normalizeText(raw.to).slice(0, 10)
    };
  }
  return { mode: 'days', days: Math.min(Math.max(Number(raw.days) || 30, 1), 3660) };
}

function normalizeFilters(rawFilters) {
  const raw = rawFilters && typeof rawFilters === 'object' ? rawFilters : {};
  const overview = normalizeFilterSpec(raw.overview);
  const products = normalizeFilterSpec(raw.products);
  const invoices = normalizeFilterSpec(raw.invoices);
  const customers = normalizeFilterSpec(raw.customers, 'all');
  const productStatus = ['Đang kinh doanh', 'Ngừng kinh doanh'].includes(raw.products && raw.products.status)
    ? raw.products.status
    : 'all';
  return {
    overview,
    products: { ...products, status: productStatus },
    invoices,
    customers,
    newPurchases: normalizeFilterSpec(raw.newPurchases || overview),
    newProducts: normalizeFilterSpec(raw.newProducts || overview),
    deactivated: normalizeFilterSpec(raw.deactivated || overview)
  };
}

function inferColumnType(label) {
  const text = normalizeText(label);
  if (/(^|\s)(mã|id|sđt|điện thoại|cccd|cmnd|psid|serial|imei)(\s|$)|mã số thuế/iu.test(text)) return 'text';
  if (/ngày|thời gian|ngày sinh/iu.test(text)) return 'date';
  // Cot % tu KiotViet/Sheets thuong luu gia tri 10 de bieu dien 10%, khong
  // phai phan so 0.1. Giu dang number de Excel khong hien nham thanh 1000%.
  if (/%|tỷ lệ/iu.test(text)) return 'number';
  if (/giá|tiền|doanh thu|công nợ|\bnợ\b|tổng|số lượng|\bsl\b|tồn|khách đặt|giảm giá|thuế|phí|điểm|trọng lượng|đơn giá|thành tiền|giá trị|dư nợ|số ngày|số đơn|số mã/iu.test(text)) return 'number';
  return 'general';
}

function normalizedHeaders(sheetRows) {
  const headers = (sheetRows && sheetRows[0]) || [];
  return headers.map((header, index) => normalizeText(header) || `Cột ${index + 1}`);
}

function rawColumns(sheetRows, maxColumns) {
  const headers = normalizedHeaders(sheetRows);
  const count = Number.isInteger(maxColumns) ? Math.min(maxColumns, headers.length) : headers.length;
  return headers.slice(0, count).map((label, index) => ({
    key: `c${index}`,
    label,
    type: inferColumnType(label),
    sourceIndex: index
  }));
}

function derivedColumn(key, label, type = inferColumnType(label)) {
  return { key: `d_${key}`, label, type, derivedKey: key };
}

function rowObjectFromRaw(row, columns) {
  const object = {};
  columns.forEach(column => {
    object[column.key] = row && column.sourceIndex < row.length ? row[column.sourceIndex] : '';
  });
  return object;
}

function findHeaderIndex(sheetRows, candidates, fallback = -1) {
  const headers = normalizedHeaders(sheetRows);
  const normalizedCandidates = candidates.map(candidate => normalizeCode(candidate));
  const exact = headers.findIndex(header => normalizedCandidates.includes(normalizeCode(header)));
  return exact >= 0 ? exact : fallback;
}

function rowsByCode(sheetRows, codeIndex) {
  const map = new Map();
  for (let rowIndex = 1; rowIndex < (sheetRows || []).length; rowIndex++) {
    const row = sheetRows[rowIndex] || [];
    const key = normalizeCode(row[codeIndex]);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function worksheetFromLogicalRows(options) {
  const {
    key, name, sheetRows, logicalRows, codeHeaders, fallbackCodeIndex = 0,
    logicalCode = item => item.code, derived = [], maxRawColumns
  } = options;
  const baseColumns = rawColumns(sheetRows, maxRawColumns);
  const columns = baseColumns.concat(derived.map(def => derivedColumn(def.key, def.label, def.type)));
  const codeIndex = findHeaderIndex(sheetRows, codeHeaders, fallbackCodeIndex);
  const sourceRows = rowsByCode(sheetRows, codeIndex);
  const rows = (logicalRows || []).map(item => {
    const matches = sourceRows.get(normalizeCode(logicalCode(item))) || [];
    const rawRow = matches[0] || [];
    const object = rowObjectFromRaw(rawRow, baseColumns);
    derived.forEach(def => { object[`d_${def.key}`] = def.value(item); });
    return object;
  });
  return { key, name, columns, rows };
}

function aggregateWorksheet(key, name, columns, sourceRows) {
  const normalizedColumns = columns.map(column => ({
    key: column.key,
    label: column.label,
    type: column.type || inferColumnType(column.label)
  }));
  const rows = (sourceRows || []).map(source => {
    const row = {};
    normalizedColumns.forEach(column => { row[column.key] = source[column.key]; });
    return row;
  });
  return { key, name, columns: normalizedColumns, rows };
}

function rawRowsForCodes(sheetRows, codeHeaders, codes, fallbackCodeIndex = 0) {
  const columns = rawColumns(sheetRows);
  const codeIndex = findHeaderIndex(sheetRows, codeHeaders, fallbackCodeIndex);
  const byCode = rowsByCode(sheetRows, codeIndex);
  const rows = [];
  (codes || []).forEach(code => {
    (byCode.get(normalizeCode(code)) || []).forEach(rawRow => rows.push(rowObjectFromRaw(rawRow, columns)));
  });
  return { columns, rows };
}

function getSheet(snapshot, name) {
  return (snapshot.sheets && snapshot.sheets[name]) || [];
}

function customerRevenueRows(dashboard) {
  return (((dashboard.customers || {}).topRevenue || {}).top50 || []);
}

function buildFixedDataset(tableKey, snapshot, context) {
  const d = snapshot.dashboard || {};
  const tableTitle = TABLE_TITLES[tableKey];
  let worksheets;

  switch (tableKey) {
    case 'overview.transactions': {
      const items = ((((d.overview || {}).endOfDayReport || {}).transactions) || []);
      worksheets = [worksheetFromLogicalRows({
        key: 'transactions', name: 'Chi tiết giao dịch',
        sheetRows: getSheet(snapshot, CONFIG.SHEET_INVOICES), logicalRows: items,
        codeHeaders: ['Mã hóa đơn'],
        derived: [{ key: 'quantity', label: 'Số lượng', type: 'number', value: item => item.quantityKnown ? item.quantity : '' }]
      })];
      break;
    }
    case 'overview.purchases': {
      const items = ((d.newPurchases || {}).orders || []);
      const source = getSheet(snapshot, CONFIG.SHEET_PURCHASES);
      const itemColumnIndex = findHeaderIndex(source, ['Mã hàng'], 20);
      const summary = worksheetFromLogicalRows({
        key: 'purchase_summary', name: 'Tổng hợp phiếu', sheetRows: source, logicalRows: items,
        codeHeaders: ['Mã nhập hàng'], fallbackCodeIndex: 1,
        maxRawColumns: itemColumnIndex > 0 ? itemColumnIndex : 20
      });
      const detail = rawRowsForCodes(source, ['Mã nhập hàng'], items.map(item => item.code), 1);
      worksheets = [summary, { key: 'purchase_details', name: 'Chi tiết mặt hàng', ...detail }];
      break;
    }
    case 'overview.new-products':
      worksheets = [worksheetFromLogicalRows({
        key: 'new_products', name: 'Mã mới tạo', sheetRows: getSheet(snapshot, CONFIG.SHEET_PRODUCTS),
        logicalRows: (((d.overview || {}).todayNewProducts || {}).products || []), codeHeaders: ['Mã hàng']
      })];
      break;
    case 'overview.deactivated':
      worksheets = [worksheetFromLogicalRows({
        key: 'deactivated', name: 'Ngừng kinh doanh', sheetRows: getSheet(snapshot, CONFIG.SHEET_DEACTIVATED_TODAY),
        logicalRows: (((d.overview || {}).deactivatedToday || {}).products || []), codeHeaders: ['Mã hàng'], fallbackCodeIndex: 6
      })];
      break;
    case 'products.top-selling': {
      const products = d.products || {};
      if (context.productAnalysis === 'parentCategory') {
        worksheets = [aggregateWorksheet('top_parent_categories', 'Top nhóm cha', [
          { key: 'name', label: 'Nhóm cha' },
          { key: 'qty', label: 'Số lượng bán', type: 'number' },
          { key: 'revenue', label: 'Doanh thu', type: 'number' },
          { key: 'productCount', label: 'Số mã hàng', type: 'number' }
        ], products.topSellingParentCategories || [])];
      } else {
        worksheets = [worksheetFromLogicalRows({
          key: 'top_products', name: 'Top sản phẩm', sheetRows: getSheet(snapshot, CONFIG.SHEET_PRODUCTS),
          logicalRows: products.topSellingProducts || [], codeHeaders: ['Mã hàng'],
          derived: [
            { key: 'sold_qty', label: 'Số lượng bán', type: 'number', value: item => item.qty },
            { key: 'sales_revenue', label: 'Doanh thu', type: 'number', value: item => item.revenue }
          ]
        })];
      }
      break;
    }
    case 'products.low-stock':
      worksheets = [worksheetFromLogicalRows({
        key: 'low_stock', name: 'Hàng đã hết', sheetRows: getSheet(snapshot, CONFIG.SHEET_PRODUCTS),
        logicalRows: d.lowStock || [], codeHeaders: ['Mã hàng']
      })];
      break;
    case 'products.all':
      worksheets = [worksheetFromLogicalRows({
        key: 'all_products', name: 'Tất cả mã hàng', sheetRows: getSheet(snapshot, CONFIG.SHEET_PRODUCTS),
        logicalRows: d.allProducts || [], codeHeaders: ['Mã hàng'],
        derived: [{ key: 'stock_ratio', label: 'Tỷ lệ tồn (%)', type: 'percent', value: item => Number(item.pct || 0) / 100 }]
      })];
      break;
    case 'products.newly-imported':
      worksheets = [worksheetFromLogicalRows({
        key: 'newly_imported', name: 'Hàng mới nhập', sheetRows: getSheet(snapshot, CONFIG.SHEET_PRODUCTS),
        logicalRows: (((d.products || {}).newlyImported || {}).products || []), codeHeaders: ['Mã hàng'],
        derived: [
          { key: 'first_import_date', label: 'Ngày nhập đầu tiên', type: 'date', value: item => item.firstImportDate },
          { key: 'days_on_hand', label: 'Số ngày tồn tại', type: 'number', value: item => item.daysOnHand },
          { key: 'revenue', label: 'Doanh thu', type: 'number', value: item => item.revenue }
        ]
      })];
      break;
    case 'products.child-categories': {
      const parent = normalizeText(context.childCategoryParent);
      const items = ((((d.products || {}).childCategorySalesByParent || {})[parent]) || []).map(item => ({
        parent, name: item.name, qty: item.qty, revenue: item.revenue, productCount: item.productCount
      }));
      worksheets = [aggregateWorksheet('child_categories', 'Chi tiết nhóm con', [
        { key: 'parent', label: 'Nhóm cha' },
        { key: 'name', label: 'Nhóm con' },
        { key: 'qty', label: 'Số lượng bán', type: 'number' },
        { key: 'revenue', label: 'Doanh thu', type: 'number' },
        { key: 'productCount', label: 'Số mã hàng', type: 'number' }
      ], items)];
      break;
    }
    case 'invoices.orders':
      worksheets = [worksheetFromLogicalRows({
        key: 'orders', name: 'Đặt hàng', sheetRows: getSheet(snapshot, CONFIG.SHEET_ORDERS),
        logicalRows: ((d.invoices || {}).recentOrders || []), codeHeaders: ['Mã đặt hàng']
      })];
      break;
    case 'invoices.returns':
      worksheets = [worksheetFromLogicalRows({
        key: 'returns', name: 'Trả hàng', sheetRows: getSheet(snapshot, CONFIG.SHEET_RETURNS),
        logicalRows: ((d.invoices || {}).recentReturns || []), codeHeaders: ['Mã trả hàng']
      })];
      break;
    case 'invoices.recent':
      worksheets = [worksheetFromLogicalRows({
        key: 'invoices', name: 'Hóa đơn', sheetRows: getSheet(snapshot, CONFIG.SHEET_INVOICES),
        logicalRows: ((d.invoices || {}).recentInvoices || []), codeHeaders: ['Mã hóa đơn']
      })];
      break;
    case 'customers.revenue':
      worksheets = [worksheetFromLogicalRows({
        key: 'customer_revenue', name: 'Doanh thu theo khách', sheetRows: getSheet(snapshot, CONFIG.SHEET_CUSTOMERS),
        logicalRows: customerRevenueRows(d), codeHeaders: ['Mã khách hàng'],
        derived: [
          { key: 'sale_order_count', label: 'Số đơn bán', type: 'number', value: item => item.saleOrderCount },
          { key: 'period_revenue', label: 'Doanh thu trong kỳ', type: 'number', value: item => item.revenue }
        ]
      })];
      break;
    case 'customers.debt':
      worksheets = [worksheetFromLogicalRows({
        key: 'customer_debt', name: 'Khách còn nợ', sheetRows: getSheet(snapshot, CONFIG.SHEET_CUSTOMERS),
        logicalRows: ((d.customers || {}).topDebt || []), codeHeaders: ['Mã khách hàng'],
        derived: [{ key: 'period_revenue', label: 'Doanh thu trong kỳ', type: 'number', value: item => item.periodRevenue }]
      })];
      break;
    case 'suppliers.list':
      worksheets = [worksheetFromLogicalRows({
        key: 'suppliers', name: 'Nhà cung cấp', sheetRows: getSheet(snapshot, CONFIG.SHEET_SUPPLIERS),
        logicalRows: d.suppliers || [], codeHeaders: ['Mã NCC']
      })];
      break;
    case 'debt.period': {
      const period = VALID_DEBT_PERIODS.has(Number(context.debtPeriod)) ? Number(context.debtPeriod) : 1;
      const filter = normalizeText(context.debtFilter).toLocaleLowerCase('vi-VN');
      const customers = (((d.debt || {})[period] || {}).customers || []).filter(customer => !filter ||
        normalizeText(customer.code).toLocaleLowerCase('vi-VN').includes(filter) ||
        normalizeText(customer.name).toLocaleLowerCase('vi-VN').includes(filter));
      const summaryRows = customers.map(customer => ({
        code: customer.code, name: customer.name, phone: customer.phone, group: customer.group,
        openingDebt: customer.openingDebt, debit: customer.debit, credit: customer.credit, closingDebt: customer.closingDebt
      }));
      const transactionRows = [];
      customers.forEach(customer => (customer.transactions || []).forEach(transaction => transactionRows.push({
        customerCode: customer.code, customerName: customer.name, phone: customer.phone,
        code: transaction.code, time: transaction.time, type: transaction.type,
        value: transaction.value, runningBalance: transaction.runningBalance
      })));
      worksheets = [
        aggregateWorksheet('debt_summary', `Tổng hợp HN${period}`, [
          { key: 'code', label: 'Mã KH', type: 'text' },
          { key: 'name', label: 'Khách hàng' },
          { key: 'phone', label: 'Số điện thoại', type: 'text' },
          { key: 'group', label: 'Nhóm khách hàng' },
          { key: 'openingDebt', label: 'Nợ đầu kỳ', type: 'number' },
          { key: 'debit', label: 'Ghi nợ', type: 'number' },
          { key: 'credit', label: 'Ghi có', type: 'number' },
          { key: 'closingDebt', label: 'Dư nợ cuối', type: 'number' }
        ], summaryRows),
        aggregateWorksheet('debt_transactions', 'Giao dịch', [
          { key: 'customerCode', label: 'Mã KH', type: 'text' },
          { key: 'customerName', label: 'Khách hàng' },
          { key: 'phone', label: 'Số điện thoại', type: 'text' },
          { key: 'code', label: 'Mã giao dịch', type: 'text' },
          { key: 'time', label: 'Thời gian', type: 'date' },
          { key: 'type', label: 'Loại giao dịch' },
          { key: 'value', label: 'Giá trị', type: 'number' },
          { key: 'runningBalance', label: 'Dư nợ cuối', type: 'number' }
        ], transactionRows)
      ];
      break;
    }
    default:
      throw exportError('Bảng yêu cầu xuất không hợp lệ.', 400, 'EXPORT_TABLE_NOT_ALLOWED');
  }

  return { tableKey, title: tableTitle, selectionMode: 'custom', worksheets };
}

function fieldsToWorksheet(sourceKey, sourceLabel, results) {
  const maxFieldCount = results.reduce((max, result) => Math.max(max, (result.fields || []).length), 0);
  const sample = results.find(result => (result.fields || []).length === maxFieldCount) || { fields: [] };
  const columns = (sample.fields || []).map((field, index) => ({
    key: `c${index}`,
    label: normalizeText(field.label) || `Cột ${index + 1}`,
    type: inferColumnType(field.label)
  }));
  const rows = results.map(result => {
    const row = {};
    columns.forEach((column, index) => {
      const field = (result.fields || [])[index];
      row[column.key] = !field ? '' : (Object.prototype.hasOwnProperty.call(field, 'rawValue') ? field.rawValue : (field.value === '—' ? '' : field.value));
    });
    return row;
  });
  return { key: `search_${sourceKey}`, name: sourceLabel, columns, rows };
}

async function buildSearchDataset(payload, filters, branch) {
  const search = payload.search && typeof payload.search === 'object' ? payload.search : {};
  const view = normalizeText(search.view);
  const mode = normalizeText(search.mode) || 'normal';
  const query = normalizeText(search.query);
  if (view === 'overview') {
    throw exportError('Tìm kiếm ở Tổng quan không hỗ trợ xuất Excel.', 400, 'EXPORT_OVERVIEW_SEARCH_DISABLED');
  }
  if (!['products', 'invoices', 'customers', 'suppliers'].includes(view)) {
    throw exportError('Tab tìm kiếm không hợp lệ.', 400, 'EXPORT_SEARCH_VIEW_INVALID');
  }
  if (!query) throw exportError('Không có từ khóa tìm kiếm để xuất.', 400, 'EXPORT_SEARCH_QUERY_EMPTY');

  if (mode === 'customer-products') {
    if (view !== 'customers') throw exportError('Chế độ tìm kiếm này chỉ dùng cho tab Khách hàng.');
    const result = await dashboardData.searchTopCustomersByProducts(query, filters.customers, undefined, branch);
    const columns = [
      { key: 'productCode', label: 'Mã hàng', type: 'text' },
      { key: 'productName', label: 'Tên hàng' },
      { key: 'customerCode', label: 'Mã KH', type: 'text' },
      { key: 'customerName', label: 'Khách hàng' },
      { key: 'purchasedQuantity', label: 'SL mua tổng', type: 'number' },
      { key: 'purchaseRevenue', label: 'Doanh thu tổng', type: 'number' },
      { key: 'returnedQuantityAllTime', label: 'SL trả (toàn thời gian)', type: 'number' },
      { key: 'returnValueAllTime', label: 'Giá trị trả (toàn thời gian)', type: 'number' },
      { key: 'netRevenue', label: 'Doanh thu thuần', type: 'number' },
      { key: 'lastPurchaseDate', label: 'Ngày mua cuối cùng', type: 'date' }
    ];
    return {
      tableKey: 'search.results', title: 'Top khách hàng theo sản phẩm', selectionMode: 'custom',
      worksheets: [aggregateWorksheet('customer_product_top', 'Top KH theo sản phẩm', columns, result.results || [])]
    };
  }

  const result = await dashboardData.searchDashboardRecords(view, query, 'all', mode === 'codes' ? 'codes' : undefined, branch);
  const groups = new Map();
  (result.results || []).forEach(item => {
    if (!groups.has(item.source)) groups.set(item.source, { label: item.sourceLabel, results: [] });
    groups.get(item.source).results.push(item);
  });
  if (groups.size === 0) throw exportError('Không có kết quả tìm kiếm để xuất.', 404, 'EXPORT_NO_DATA');
  const worksheets = Array.from(groups.entries()).map(([sourceKey, group]) =>
    fieldsToWorksheet(sourceKey, group.label, group.results));
  return {
    tableKey: 'search.results', title: 'Kết quả tìm kiếm',
    selectionMode: worksheets.length > 1 ? 'all-only' : 'custom', worksheets
  };
}

function buildStockoutResultDataset(payload) {
  const result = payload.stockoutResult && typeof payload.stockoutResult === 'object' ? payload.stockoutResult : null;
  const rows = result && Array.isArray(result.rows) ? result.rows : [];
  if (rows.length === 0) throw exportError('Chưa có kết quả kiểm tra đứt hàng để xuất.', 400, 'EXPORT_NO_DATA');
  const dataRows = rows.map(row => ({
    code: row.code,
    name: row.name,
    currentOnHand: row.currentOnHand,
    stockoutCount: row.stockoutCount,
    totalStockoutDays: row.totalStockoutDays,
    periods: (row.periods || []).map(p => `${p.fromDate} — ${p.toDate} (${p.days} ngày)`).join('; ')
  }));
  const worksheet = aggregateWorksheet('stockout_result', 'Kết quả đứt hàng', [
    { key: 'code', label: 'Mã hàng', type: 'text' },
    { key: 'name', label: 'Tên hàng' },
    { key: 'currentOnHand', label: 'Tồn kho hiện tại', type: 'number' },
    { key: 'stockoutCount', label: 'Số lần đứt hàng', type: 'number' },
    { key: 'totalStockoutDays', label: 'Tổng ngày đứt hàng', type: 'number' },
    { key: 'periods', label: 'Chi tiết các đợt đứt hàng' }
  ], dataRows);
  return { tableKey: 'stockout.result', title: TABLE_TITLES['stockout.result'], selectionMode: 'custom', worksheets: [worksheet] };
}

async function buildExportDataset(payload, branch) {
  const tableKey = normalizeText(payload && payload.tableKey);
  if (!TABLE_TITLES[tableKey]) throw exportError('Bảng yêu cầu xuất không hợp lệ.', 400, 'EXPORT_TABLE_NOT_ALLOWED');
  const filters = normalizeFilters(payload.filters);
  if (tableKey === 'search.results') return buildSearchDataset(payload, filters, branch);
  if (tableKey === 'stockout.result') return buildStockoutResultDataset(payload);
  const context = payload.context && typeof payload.context === 'object' ? payload.context : {};
  const snapshot = await dashboardData.getDashboardExportSnapshot(filters, branch);
  return buildFixedDataset(tableKey, snapshot, context);
}

async function getExportFields(payload, branch) {
  const dataset = await buildExportDataset(payload || {}, branch);
  return {
    tableKey: dataset.tableKey,
    title: dataset.title,
    selectionMode: dataset.selectionMode,
    worksheets: dataset.worksheets.map(worksheet => ({
      key: worksheet.key,
      name: worksheet.name,
      rowCount: worksheet.rows.length,
      fields: worksheet.columns.map(column => ({
        key: column.key,
        label: column.label,
        type: column.type,
        selected: true
      }))
    }))
  };
}

function neutralizeFormulaText(value) {
  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function parseExcelDate(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const text = normalizeText(value);
  if (!text) return null;
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dmy) {
    const [, day, month, year, hour = '0', minute = '0', second = '0'] = dmy;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  }
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = iso;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  }
  return null;
}

function toExcelValue(value, type) {
  if (value === undefined || value === null || value === '' || value === '—') return null;
  if (type === 'text') return neutralizeFormulaText(value);
  if (type === 'date') return parseExcelDate(value) || neutralizeFormulaText(value);
  if (type === 'number' || type === 'percent') {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : neutralizeFormulaText(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return neutralizeFormulaText(value);
}

function safeWorksheetName(name, usedNames) {
  const base = normalizeText(name).replace(/[\\/*?:\[\]]/g, ' ').replace(/\s+/g, ' ').slice(0, 31) || 'Dữ liệu';
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate.toLocaleLowerCase('vi-VN'))) {
    const tail = ` ${suffix++}`;
    candidate = base.slice(0, 31 - tail.length) + tail;
  }
  usedNames.add(candidate.toLocaleLowerCase('vi-VN'));
  return candidate;
}

function selectedColumnsForWorksheet(dataset, worksheet, requestColumns) {
  if (dataset.selectionMode === 'all-only') return worksheet.columns;
  const requested = requestColumns && requestColumns[worksheet.key];
  if (!Array.isArray(requested)) {
    throw exportError(`Chưa chọn trường cho worksheet "${worksheet.name}".`, 400, 'EXPORT_FIELDS_REQUIRED');
  }
  const allowed = new Map(worksheet.columns.map(column => [column.key, column]));
  const selected = [];
  const seen = new Set();
  requested.forEach(key => {
    if (!allowed.has(key)) throw exportError(`Trường "${key}" không hợp lệ.`, 400, 'EXPORT_FIELD_NOT_ALLOWED');
    if (!seen.has(key)) {
      seen.add(key);
      selected.push(allowed.get(key));
    }
  });
  return selected;
}

function styleWorksheet(worksheet, columns, rows) {
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(rows.length + 1, 1), column: columns.length }
  };
  const header = worksheet.getRow(1);
  header.height = 24;
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.eachCell(cell => {
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFB8C4CE' } } };
  });

  columns.forEach((column, index) => {
    const excelColumn = worksheet.getColumn(index + 1);
    const values = rows.slice(0, 100).map(row => normalizeText(row[column.key]));
    const width = Math.min(42, Math.max(12, column.label.length + 2, ...values.map(value => Math.min(value.length + 2, 42))));
    excelColumn.width = width;
    if (column.type === 'number') excelColumn.numFmt = '#,##0.00;[Red]-#,##0.00';
    if (column.type === 'percent') excelColumn.numFmt = '0.00%';
    if (column.type === 'date') excelColumn.numFmt = 'dd/mm/yyyy hh:mm:ss';
    excelColumn.alignment = { vertical: 'top', wrapText: false };
  });
}

function fileTimestamp(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).filter(part => part.type !== 'literal')
    .reduce((object, part) => ({ ...object, [part.type]: part.value }), {});
  return `${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}`;
}

function fileSlug(value) {
  return normalizeText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'Du_lieu';
}

async function createExportWorkbook(payload, branch) {
  const dataset = await buildExportDataset(payload || {}, branch);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TOKOSI Dashboard';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.properties.date1904 = false;
  const usedNames = new Set();
  let exportedWorksheetCount = 0;

  dataset.worksheets.forEach(sourceWorksheet => {
    const columns = selectedColumnsForWorksheet(dataset, sourceWorksheet, payload.columns);
    if (columns.length === 0) return;
    exportedWorksheetCount += 1;
    const worksheet = workbook.addWorksheet(safeWorksheetName(sourceWorksheet.name, usedNames));
    worksheet.columns = columns.map(column => ({ header: column.label, key: column.key }));
    sourceWorksheet.rows.forEach(sourceRow => {
      const output = {};
      columns.forEach(column => { output[column.key] = toExcelValue(sourceRow[column.key], column.type); });
      worksheet.addRow(output);
    });
    styleWorksheet(worksheet, columns, sourceWorksheet.rows);
  });

  if (exportedWorksheetCount === 0) {
    throw exportError('Vui lòng chọn ít nhất một trường để xuất.', 400, 'EXPORT_NO_FIELDS_SELECTED');
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer,
    mimeType: EXCEL_MIME,
    fileName: `TKS_${fileSlug(dataset.title)}_${fileTimestamp()}.xlsx`
  };
}

module.exports = {
  TABLE_TITLES,
  getExportFields,
  createExportWorkbook,
  __test__: {
    buildFixedDataset,
    buildExportDataset,
    inferColumnType,
    toExcelValue,
    normalizeFilters
  }
};
