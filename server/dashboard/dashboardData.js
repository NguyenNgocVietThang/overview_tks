// ==========================================
// DASHBOARD DATA — cung cap du lieu cho Web App (GET /api/dashboard)
// Doc tu sheet KiotViet export 9-tab (dong bo boi appsscript/KiotVietExport.gs)
// ==========================================
const CONFIG = require('../config');
const sheetsClient = require('../sheets/sheetsClient');

const LOW_STOCK_THRESHOLD = 5;
const CATEGORY_STOCK_TOP = 15;
const TOP_SELLING_LIMIT = 10;
const PENDING_ORDER_STATUSES = new Set(['Phiếu tạm', 'Đang xử lý', 'Đã xác nhận']);

function formatDMY(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function formatDMYHMS(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${formatDMY(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Parse gia tri ngay do Sheets API tra ve (thuong la chuoi da format theo
 * number-format cua o, dang "dd/MM/yyyy HH:mm:ss"). Khong bao gio throw —
 * tra null neu khong doc duoc, de goi noi bo qua thay vi lam vo ca dashboard.
 */
function parseSheetDate(raw) {
  if (raw === undefined || raw === null || raw === '') return null;

  if (typeof raw === 'number') {
    const ms = Math.round((raw - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  const str = String(raw).trim();
  if (!str) return null;

  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, dd, MM, yyyy, hh = '0', mi = '0', ss = '0'] = m;
    const d = new Date(Number(yyyy), Number(MM) - 1, Number(dd), Number(hh), Number(mi), Number(ss));
    if (!isNaN(d.getTime()) && d.getFullYear() > 1990) return d;
  }

  const d2 = new Date(str);
  if (!isNaN(d2.getTime()) && d2.getFullYear() > 1990 && d2.getFullYear() < 2100) return d2;

  return null;
}

function dmyKey(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function stripSortKey(list) {
  return list.map(({ _sortTime, ...rest }) => rest);
}

const SHEET_NAMES = [
  CONFIG.SHEET_PRODUCTS,
  CONFIG.SHEET_INVOICES,
  CONFIG.SHEET_INVOICE_DETAILS,
  CONFIG.SHEET_ORDERS,
  CONFIG.SHEET_RETURNS,
  CONFIG.SHEET_CUSTOMERS,
  CONFIG.SHEET_SUPPLIERS,
  CONFIG.SHEET_PURCHASES
];

/**
 * Ham chinh lay du lieu cho dashboard.
 * @param {number} days - So ngay gan nhat de ve bieu do doanh thu (7/30/90). Mac dinh 30.
 * @returns {Object} Du lieu KPI, bieu do, bang xep hang cho dashboard
 */
async function getDashboardData(days) {
  days = Number(days) || 30;
  const todayStr = formatDMY(new Date());

  const sheets = await sheetsClient.getMultipleSheetValues(SHEET_NAMES);
  const prodData = sheets[CONFIG.SHEET_PRODUCTS];
  const invData = sheets[CONFIG.SHEET_INVOICES];
  const detailData = sheets[CONFIG.SHEET_INVOICE_DETAILS];
  const orderData = sheets[CONFIG.SHEET_ORDERS];
  const returnData = sheets[CONFIG.SHEET_RETURNS];
  const custData = sheets[CONFIG.SHEET_CUSTOMERS];
  const supplierData = sheets[CONFIG.SHEET_SUPPLIERS];
  const poData = sheets[CONFIG.SHEET_PURCHASES];

  // ---------- HÀNG HÓA ----------
  // Cột: [0]Mã hàng [1]Tên hàng [2]Nhóm hàng [3]Thương hiệu [4]Loại [5]Giá vốn [6]Giá bán [7]Tồn kho [8]Khách đặt [9]Ngày sửa cuối
  let totalProducts = 0, totalStock = 0, inStockCodes = 0, lowStock = [];
  let stockList = [];
  const categoryMap = {};

  for (let r = 1; r < prodData.length; r++) {
    const row = prodData[r];
    const code = row[0];
    if (!code) continue;
    totalProducts++;
    const ton = Number(row[7]) || 0;
    const reserved = Number(row[8]) || 0;
    totalStock += ton;
    if (ton > 0) inStockCodes++;
    stockList.push({ code, name: row[1], stock: ton, reserved });
    if (ton <= LOW_STOCK_THRESHOLD) {
      lowStock.push({ code, name: row[1], stock: ton, reserved });
    }

    const catName = (row[2] && String(row[2]).trim()) || 'Chưa phân nhóm';
    if (!categoryMap[catName]) categoryMap[catName] = { name: catName, stock: 0, productCount: 0 };
    categoryMap[catName].stock += ton;
    categoryMap[catName].productCount += 1;
  }
  lowStock.sort((a, b) => a.stock - b.stock);

  stockList.sort((a, b) => b.stock - a.stock);
  const topStock = stockList.slice(0, 20);
  const restStock = stockList.slice(20).reduce((s, p) => s + p.stock, 0);
  const stockDistribution = topStock.map(p => ({ label: p.name, value: p.stock }));
  if (restStock > 0) stockDistribution.push({ label: 'Khác (' + (stockList.length - 20) + ' mã)', value: restStock });

  const allProducts = stockList.map(p => ({
    code: p.code,
    name: p.name,
    stock: p.stock,
    reserved: p.reserved,
    pct: totalStock > 0 ? (p.stock / totalStock) * 100 : 0
  }));

  let stockByCategory = Object.values(categoryMap).sort((a, b) => b.stock - a.stock);
  const restCategoryCount = stockByCategory.length - CATEGORY_STOCK_TOP;
  const restCategoryStock = stockByCategory.slice(CATEGORY_STOCK_TOP).reduce((s, c) => s + c.stock, 0);
  stockByCategory = stockByCategory.slice(0, CATEGORY_STOCK_TOP);
  if (restCategoryCount > 0 && restCategoryStock > 0) {
    stockByCategory.push({ name: 'Khác (' + restCategoryCount + ' nhóm)', stock: restCategoryStock, productCount: 0 });
  }

  // ---------- HÓA ĐƠN ----------
  // Cột: [0]Mã hóa đơn [1]Ngày bán [2]Khách hàng [3]SĐT khách [4]Nhân viên bán [5]Chi nhánh [6]Tổng tiền hàng [7]Giảm giá [8]Khách đã trả [9]Trạng thái
  let revenueToday = 0, invoicesToday = 0, cancelledToday = 0;
  let recentInvoices = [];
  const cancelledInvoiceCodes = new Set();

  const dayBuckets = {};
  const dayOrder = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
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
    updatedAt: formatDMYHMS(new Date()),
    days,
    kpi: {
      revenueToday,
      invoicesToday,
      cancelledToday,
      totalProducts,
      totalStock,
      inStockCodes,
      lowStockCount: lowStock.length,
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
    stockDistribution,
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

module.exports = { getDashboardData };
