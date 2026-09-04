'use strict';

const { getPool } = require('../db/pool');
const overviewQueries = require('./queries/overviewQueries');
const invoiceQueries = require('./queries/invoiceQueries');
const productQueries = require('./queries/productQueries');
const customerQueries = require('./queries/customerQueries');
const supplierQueries = require('./queries/supplierQueries');
const searchQueries = require('./queries/searchQueries');
const { computeDebtReport } = require('./debtReportPg');

const RECENT_LIMIT = 8; // dashboardData.js: .slice(0, 8) o recentInvoices/recentOrders/recentReturns
const TOP_SELLING_LIMIT = 10; // dashboardData.js:11
const NEW_PURCHASES_SUPPLIER_LIMIT = 30; // dashboardData.js:14 "top NCC cho bieu do 2 cot"
const MAX_RANGE_DAYS = 3660; // dashboardData.js:24

// spec Phase 2 §5: map ten branch ('Hà Nội'|'Sài Gòn') -> branch_id qua 1 lan
// SELECT, cache vinh vien trong RAM (bang branches gan nhu khong doi).
const branchIdCache = new Map();

async function resolveBranchId(pool, branchName) {
  if (branchIdCache.has(branchName)) return branchIdCache.get(branchName);
  const { rows } = await pool.query('SELECT id FROM branches WHERE name = $1', [branchName]);
  if (!rows.length) {
    const err = new Error(`Không tìm thấy chi nhánh "${branchName}".`);
    err.statusCode = 400;
    throw err;
  }
  branchIdCache.set(branchName, rows[0].id);
  return rows[0].id;
}

function toVietnamDateBoundary(date, endOfDay) {
  const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const dateStr = shifted.toISOString().slice(0, 10);
  return new Date(`${dateStr}T${endOfDay ? '23:59:59' : '00:00:00'}+07:00`);
}

// Tuong duong resolveFilterRange (dashboardData.js:154-184): mode 'days' (N
// ngay gan nhat, ke ca hom nay) | 'range' (tu ngay...den ngay...) | 'all'.
function resolveFilterRange(spec, now) {
  const raw = spec || {};
  const mode = raw.mode === 'range' || raw.mode === 'all' ? raw.mode : 'days';

  if (mode === 'all') return { mode: 'all', from: null, to: null };

  if (mode === 'range') {
    const fromDate = raw.from ? new Date(raw.from) : null;
    const toDate = raw.to ? new Date(raw.to) : null;
    if (!fromDate || isNaN(fromDate.getTime()) || !toDate || isNaN(toDate.getTime())) {
      return { mode: 'all', from: null, to: null };
    }
    let from = toVietnamDateBoundary(fromDate, false);
    let to = toVietnamDateBoundary(toDate, true);
    if (from.getTime() > to.getTime()) [from, to] = [to, from];
    return { mode: 'range', from, to };
  }

  const days = Math.min(Math.max(Number(raw.days) || 30, 1), MAX_RANGE_DAYS);
  const to = toVietnamDateBoundary(now, true);
  const from = toVietnamDateBoundary(new Date(now.getTime() - (days - 1) * 86400000), false);
  return { mode: 'days', days, from, to };
}

function toVietnamTodayString(now) {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function computeDashboardData(pool, branchId, filters, now) {
  const f = filters || {};
  const overviewRange = resolveFilterRange(f.overview, now);
  const productsRange = resolveFilterRange(f.products, now);
  const invoicesRange = resolveFilterRange(f.invoices, now);
  const customersRange = resolveFilterRange(f.customers, now);
  const newPurchasesRange = resolveFilterRange(f.newPurchases, now);
  const productStatusFilter = f.products && f.products.status && f.products.status !== 'all'
    ? f.products.status === 'Đang kinh doanh'
    : 'all';

  const today = toVietnamTodayString(now);

  const [
    revenueTodaySection,
    overviewRevenueByDay,
    recentInvoices,
    topSellingProducts,
    topSellingParentCategories,
    invoicesRevenueByDay,
    periodCancelledInvoices,
    ordersSummary,
    returnsSummary,
    productsSection,
    suppliersList,
    purchasesAllTime,
    newPurchases,
    customerDebtSummary,
    topCustomersByRevenue,
    debt1,
    debt3,
    debt7
  ] = await Promise.all([
    overviewQueries.getRevenueToday(pool, branchId, today),
    overviewQueries.getRevenueByDay(pool, branchId, overviewRange),
    overviewQueries.getRecentInvoices(pool, branchId, invoicesRange, RECENT_LIMIT),
    overviewQueries.getTopSellingProducts(pool, branchId, productsRange, TOP_SELLING_LIMIT),
    overviewQueries.getTopSellingParentCategories(pool, branchId, productsRange, TOP_SELLING_LIMIT),
    overviewQueries.getRevenueByDay(pool, branchId, invoicesRange),
    overviewQueries.getCancelledCount(pool, branchId, invoicesRange),
    invoiceQueries.getOrdersSummary(pool, branchId, invoicesRange, RECENT_LIMIT),
    invoiceQueries.getReturnsSummary(pool, branchId, invoicesRange, RECENT_LIMIT),
    productQueries.getProductsSection(pool, branchId, productStatusFilter),
    supplierQueries.getSuppliersList(pool, branchId),
    supplierQueries.getPurchasesSummaryAllTime(pool, branchId),
    supplierQueries.getNewPurchases(pool, branchId, newPurchasesRange, NEW_PURCHASES_SUPPLIER_LIMIT, NEW_PURCHASES_SUPPLIER_LIMIT * 5),
    customerQueries.getCustomerDebtSummary(pool, branchId, customersRange),
    customerQueries.getTopCustomersByRevenue(pool, branchId, customersRange),
    computeDebtReport(pool, branchId, 1, now),
    computeDebtReport(pool, branchId, 3, now),
    computeDebtReport(pool, branchId, 7, now)
  ]);

  const totalSuppliers = suppliersList.length;
  const suppliersWithDebt = suppliersList.filter((s) => s.debt > 0).length;
  const totalSupplierDebt = suppliersList.reduce((sum, s) => sum + (s.debt > 0 ? s.debt : 0), 0);

  return {
    updatedAt: now.toISOString(),
    kpi: {
      revenueToday: revenueTodaySection.revenueToday,
      invoicesToday: revenueTodaySection.invoicesToday,
      cancelledToday: revenueTodaySection.cancelledToday,
      totalProducts: productsSection.totalProducts,
      activeProducts: productsSection.activeProducts,
      inactiveProducts: productsSection.inactiveProducts,
      totalStock: productsSection.totalStock,
      inStockCodes: productsSection.inStockCodes,
      lowStockCount: productsSection.lowStock.length,
      totalCustomers: customerDebtSummary.totalCustomers,
      customersWithDebt: customerDebtSummary.customersWithDebt,
      totalDebt: customerDebtSummary.totalDebt,
      totalSuppliers,
      suppliersWithDebt,
      totalSupplierDebt,
      purchaseOrdersCount: purchasesAllTime.purchaseOrdersCount,
      totalPurchaseSpend: purchasesAllTime.totalPurchaseSpend,
      newPurchasesOrderCount: newPurchases.orderCount,
      newPurchasesTotalAmount: newPurchases.totalAmount,
      newPurchasesSupplierCount: newPurchases.supplierCount
    },
    overview: {
      revenueByDay: overviewRevenueByDay,
      recentInvoices
    },
    products: {
      topSellingProducts,
      topSellingParentCategories
    },
    invoices: {
      revenueByDay: invoicesRevenueByDay,
      periodCancelledInvoices,
      recentInvoices,
      recentOrders: ordersSummary.recent,
      recentReturns: returnsSummary.recent,
      pendingOrdersCount: ordersSummary.pendingCount,
      pendingOrdersTotal: ordersSummary.pendingTotal,
      returnsCount: returnsSummary.count,
      totalReturns: returnsSummary.total
    },
    customers: {
      topDebt: customerDebtSummary.topDebt,
      topRevenue: topCustomersByRevenue
    },
    lowStock: productsSection.lowStock,
    stockValueByCategory: productsSection.stockValueByCategory,
    allProducts: productsSection.allProducts,
    stockByCategory: productsSection.stockByCategory,
    suppliers: suppliersList,
    newPurchases,
    debt: { 1: debt1, 3: debt3, 7: debt7 }
  };
}

async function getDashboardData(filters, branchName, pool = getPool(), now = new Date()) {
  const branchId = await resolveBranchId(pool, branchName);
  return computeDashboardData(pool, branchId, filters, now);
}

async function getDashboardExportSnapshot(filters, branchName, pool = getPool(), now = new Date()) {
  const dashboard = await getDashboardData(filters, branchName, pool, now);
  return { dashboard };
}

async function searchDashboardRecords(view, rawQuery, rawLimit, rawMode, filterSpec, branchName, pool = getPool()) {
  const branchId = await resolveBranchId(pool, branchName);
  const isCodesMode = String(rawMode || '').toLowerCase() === 'codes';
  if (isCodesMode) {
    const codes = String(rawQuery || '').split(/[\s,]+/).map((c) => c.trim()).filter(Boolean);
    return searchQueries.searchByCodes(pool, branchId, view, codes);
  }
  const limit = String(rawLimit || '').toLowerCase() === 'all' ? null : Math.min(Math.max(Number(rawLimit) || 8, 1), 50);
  return searchQueries.searchByText(pool, branchId, view, rawQuery, limit);
}

async function searchTopCustomersByProducts(rawQuery, filterSpec, now, branchName, pool = getPool()) {
  const branchId = await resolveBranchId(pool, branchName);
  const codes = String(rawQuery || '').split(/[\s,]+/).map((c) => c.trim()).filter(Boolean);
  const range = resolveFilterRange(filterSpec, now || new Date());
  const results = await customerQueries.searchTopCustomersByProducts(pool, branchId, codes, range, 100);
  return {
    mode: 'customer-product-top',
    query: codes.join(' '),
    requestedCount: codes.length,
    matchedCount: new Set(results.map((r) => r.productCode)).size,
    total: results.length,
    results
  };
}

async function getCustomerProductRevenueReport(customerCode, customerName, branchName, now, pool = getPool()) {
  const branchId = await resolveBranchId(pool, branchName);
  return customerQueries.getCustomerProductRevenueReport(pool, branchId, customerCode, now || new Date());
}

module.exports = {
  getDashboardData,
  getDashboardExportSnapshot,
  searchDashboardRecords,
  searchTopCustomersByProducts,
  getCustomerProductRevenueReport,
  resolveFilterRange
};
