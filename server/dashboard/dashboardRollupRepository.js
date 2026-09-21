'use strict';
// ==========================================
// DASHBOARD ROLLUP REPOSITORY — doc 4 bang rollup theo ngay
// (server/db/migrations/0013_dashboard_rollups.sql, tinh san boi
// server/kiotvietSync/dashboardRollupRefresh.js) dung cho cac khoi nang nhat
// cua /api/dashboard (doanh thu hoa don theo ngay, top san pham ban chay,
// nhap hang theo NCC, ngay nhap dau tien) — thay cho viec dashboardData.js tu
// quet "Chi tiết hóa đơn"/"Nhập hàng" (2 tab nang nhat, ~14s/lan doc) trong
// Node.js moi request.
//
// Factory pattern giong debtCollectionStatusRepository.js. Ten/nhom hang/NCC
// LUON join truc tiep voi products/categories/suppliers HIEN TAI tai thoi
// diem doc (khong bake vao rollup) — rollup chi luu so da tong hop.
//
// `from`/`to` cua moi ham la chuoi 'YYYY-MM-DD' (hoac null = khong gioi han)
// theo LICH VN cua bo loc dang chon — do dashboardData.js tinh san (ham
// rangeToDateBounds(), dung getDashboardDateParts() da co san o do) roi
// truyen xuong, tranh lap logic quy doi mui gio o 2 noi.
// ==========================================
const { getPool } = require('../db/pool');
const { BRANCHES, branchLabelToCode, resolveBranchScope } = require('../branch/branches');
const { statusLabel } = require('./dashboardPgReader');

function resolveBranchCode(branch) {
  const branchCode = branchLabelToCode(branch || BRANCHES.HANOI);
  if (!branchCode) {
    const error = new Error(`Cơ sở không hợp lệ: ${branch}`);
    error.code = 'INVALID_BRANCH';
    error.statusCode = 400;
    throw error;
  }
  return branchCode;
}

function resolvePhysicalBranches(branch) {
  const requestedBranch = branch || BRANCHES.HANOI;
  const scope = resolveBranchScope(requestedBranch);
  if (!scope.length) resolveBranchCode(requestedBranch);
  return scope;
}

async function queryPhysicalBranches(branch, query) {
  return Promise.all(resolvePhysicalBranches(branch).map(async physicalBranch => ({
    branch: physicalBranch,
    rows: await query(physicalBranch, resolveBranchCode(physicalBranch))
  })));
}

function mergeAdditiveRows(groups, { keyOf, firstFields, additiveFields, sort }) {
  const merged = new Map();
  groups.forEach(({ rows }) => rows.forEach(row => {
    const key = keyOf(row);
    if (!merged.has(key)) {
      const initial = {};
      firstFields.forEach(field => { initial[field] = row[field]; });
      additiveFields.forEach(field => { initial[field] = 0; });
      merged.set(key, initial);
    }
    const target = merged.get(key);
    firstFields.forEach(field => {
      if (!target[field] && row[field]) target[field] = row[field];
    });
    additiveFields.forEach(field => { target[field] += Number(row[field]) || 0; });
  }));
  const rows = Array.from(merged.values());
  if (sort) rows.sort(sort);
  return rows;
}

function dateTextSortValue(value) {
  const match = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!match) return 0;
  return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0));
}

const INVOICE_REVENUE_BY_DAY_SQL = `
  SELECT
    to_char(sale_date, 'DD/MM/YYYY') AS date_key,
    COALESCE(revenue, 0)::float8 AS revenue,
    COALESCE(invoice_count, 0)::int AS invoice_count
  FROM daily_invoice_summary
  WHERE branch = $1
    AND ($2::date IS NULL OR sale_date >= $2::date)
    AND ($3::date IS NULL OR sale_date <= $3::date)
  ORDER BY sale_date`;

// Dung chung cho getProductSalesBreakdown/getTopSellingProducts — ten/ma hang
// luon lay tu `products` HIEN TAI (LEFT JOIN, khong INNER JOIN de khong mat
// dong neu 1 product_id cu khong con khop, du KiotViet khong xoa cung
// products that su).
const PRODUCT_SALES_BASE_SQL = `
  SELECT
    d.product_id AS product_id,
    COALESCE(p.code, 'PID-' || d.product_id::text) AS code,
    COALESCE(p.name, p.code, 'PID-' || d.product_id::text) AS name,
    SUM(d.qty)::float8 AS qty,
    SUM(d.revenue)::float8 AS revenue
  FROM daily_product_sales d
  LEFT JOIN products p ON p.branch = d.branch AND p.id = d.product_id
  WHERE d.branch = $1
    AND ($2::date IS NULL OR d.sale_date >= $2::date)
    AND ($3::date IS NULL OR d.sale_date <= $3::date)
  GROUP BY d.product_id, p.code, p.name`;

const TOP_SELLING_PRODUCTS_SQL = `${PRODUCT_SALES_BASE_SQL} ORDER BY revenue DESC LIMIT $4`;

const PURCHASES_BY_SUPPLIER_SQL = `
  SELECT
    COALESCE(su.name, '(Không xác định)') AS name,
    SUM(dps.order_count)::int AS order_count,
    SUM(dps.total)::float8 AS total
  FROM daily_purchase_summary dps
  LEFT JOIN suppliers su ON su.branch = dps.branch AND su.id = dps.supplier_id
  WHERE dps.branch = $1
    AND ($2::date IS NULL OR dps.purchase_date >= $2::date)
    AND ($3::date IS NULL OR dps.purchase_date <= $3::date)
  GROUP BY COALESCE(su.name, '(Không xác định)')
  ORDER BY total DESC
  LIMIT $4`;

// KHONG gioi han ngay — "purchaseOrdersCount"/"totalPurchaseSpend" (KPI o tab
// Nha cung cap) la tong TOAN THOI GIAN, dung dung ban ghi da co trong bang
// rollup (xem ghi chu cua so refresh o dashboardRollupRefresh.js).
const PURCHASE_TOTALS_SQL = `
  SELECT
    COALESCE(SUM(order_count), 0)::float8 AS order_count,
    COALESCE(SUM(total), 0)::float8 AS total
  FROM daily_purchase_summary
  WHERE branch = $1`;

const FIRST_PURCHASE_DATES_SQL = `
  SELECT
    COALESCE(p.code, 'PID-' || pf.product_id::text) AS code,
    COALESCE(p.name, p.code, 'PID-' || pf.product_id::text) AS name,
    to_char(pf.first_purchase_date AT TIME ZONE 'UTC', 'DD/MM/YYYY HH24:MI:SS') AS first_purchase_date_text
  FROM product_first_purchase pf
  LEFT JOIN products p ON p.branch = pf.branch AND p.id = pf.product_id
  WHERE pf.branch = $1`;

// Doc THANG tu invoice_details/invoices (KHONG dung bang rollup, khong can
// join products) — tong so luong ban theo TUNG HOA DON trong khoang [from,
// to], dung cho cot "SL" o bang "Chi tiết giao dịch" (tab Tổng quan). Chi can
// ma hoa don + tong so luong, KHONG can ten/ma hang nen re hon nhieu so voi
// tab "Chi tiết hóa đơn" cu (khong join products).
const INVOICE_QUANTITIES_SQL = `
  SELECT i.code AS code, SUM(COALESCE(d.quantity, 0))::float8 AS quantity
  FROM invoice_details d
  JOIN invoices i ON i.branch = d.branch AND i.id = d.invoice_id
  WHERE d.branch = $1
    AND ($2::date IS NULL OR (i.purchase_date AT TIME ZONE 'UTC')::date >= $2::date)
    AND ($3::date IS NULL OR (i.purchase_date AT TIME ZONE 'UTC')::date <= $3::date)
  GROUP BY i.code`;

// Doc THANG tu bang `purchases` (KHONG dung rollup, KHONG join purchase_details
// nhu tab "Nhập hàng" cu) — can du lieu tung PHIEU NHAP rieng le (ma/ngay/NCC/
// trang thai) de hien thi bang "Hàng nhập" o tab Nhà cung cấp, thu ma
// daily_purchase_summary (gom theo NCC+ngay) khong the tra lai duoc. Van re
// hon nhieu tab "Nhập hàng" cu vi khong join purchase_details/products.
function buildRecentPurchaseOrdersSql() {
  const statusSql = statusLabel({}, 'pu.');
  return `
    SELECT
      pu.code AS code,
      to_char(pu.purchase_date AT TIME ZONE 'UTC', 'DD/MM/YYYY HH24:MI') AS date,
      COALESCE(NULLIF(pu.raw->>'supplierName', ''), su.name, '') AS supplier,
      COALESCE(pu.raw->>'branchName', '') AS branch,
      COALESCE(pu.total, 0)::float8 AS total,
      ${statusSql} AS status
    FROM purchases pu
    LEFT JOIN suppliers su ON su.branch = pu.branch AND su.id = pu.supplier_id
    WHERE pu.branch = $1
      AND ($2::date IS NULL OR (pu.purchase_date AT TIME ZONE 'UTC')::date >= $2::date)
      AND ($3::date IS NULL OR (pu.purchase_date AT TIME ZONE 'UTC')::date <= $3::date)
    ORDER BY pu.purchase_date DESC NULLS LAST, pu.id DESC`;
}
const RECENT_PURCHASE_ORDERS_SQL = buildRecentPurchaseOrdersSql();

function createDashboardRollupRepository({ pool = getPool() } = {}) {
  /**
   * Doanh thu/so hoa don theo ngay tu daily_invoice_summary — thay
   * buildRevenuePeriod() cho overviewPeriod/invoicesPeriod trong
   * dashboardData.js. Chi gom hoa don status=3 (Hoan thanh).
   */
  async function getInvoiceRevenueByDay({ branch, from = null, to = null }) {
    const groups = await queryPhysicalBranches(branch, async (_physicalBranch, branchCode) => {
      const result = await pool.query(INVOICE_REVENUE_BY_DAY_SQL, [branchCode, from, to]);
      return result.rows.map(row => ({
        dateKey: row.date_key,
        revenue: Number(row.revenue) || 0,
        invoiceCount: Number(row.invoice_count) || 0
      }));
    });
    return mergeAdditiveRows(groups, {
      keyOf: row => row.dateKey,
      firstFields: ['dateKey'],
      additiveFields: ['revenue', 'invoiceCount'],
      sort: (a, b) => dateTextSortValue(a.dateKey) - dateTextSortValue(b.dateKey)
    });
  }

  function mapProductSalesRow(row) {
    return {
      code: row.code || '',
      name: row.name || row.code || '',
      qty: Number(row.qty) || 0,
      revenue: Number(row.revenue) || 0
    };
  }

  /**
   * Doanh thu/SL ban theo tung ma hang trong khoang [from, to] — tu
   * daily_product_sales (da loai hoa don status=2 Da huy tu luc refresh).
   * Thay vong quet "Chi tiết hóa đơn" cho khoi Top san pham ban chay + doanh
   * thu theo nhom hang cha/con — dashboardData.js tu gom nhom (da co san
   * productParentCategoryByCode/productChildCategoryByCode tu tab Hang hoa)
   * thay vi lap lai logic do trong SQL.
   */
  async function getProductSalesBreakdown({ branch, from = null, to = null }) {
    const groups = await queryPhysicalBranches(branch, async (_physicalBranch, branchCode) => {
      const result = await pool.query(`${PRODUCT_SALES_BASE_SQL}`, [branchCode, from, to]);
      return result.rows.map(mapProductSalesRow);
    });
    return mergeAdditiveRows(groups, {
      keyOf: row => String(row.code || '').trim().toLocaleLowerCase('vi-VN'),
      firstFields: ['code', 'name'],
      additiveFields: ['qty', 'revenue']
    });
  }

  /**
   * Top N ma hang theo doanh thu trong khoang [from, to] — truy van doc lap,
   * gioi han ngay trong SQL (LIMIT null = khong gioi han).
   */
  async function getTopSellingProducts({ branch, from = null, to = null, limit = null }) {
    const scope = resolvePhysicalBranches(branch);
    const perBranchLimit = scope.length > 1 ? null : limit;
    const groups = await Promise.all(scope.map(async physicalBranch => {
      const result = await pool.query(TOP_SELLING_PRODUCTS_SQL, [resolveBranchCode(physicalBranch), from, to, perBranchLimit]);
      return { branch: physicalBranch, rows: result.rows.map(mapProductSalesRow) };
    }));
    const rows = mergeAdditiveRows(groups, {
      keyOf: row => String(row.code || '').trim().toLocaleLowerCase('vi-VN'),
      firstFields: ['code', 'name'],
      additiveFields: ['qty', 'revenue'],
      sort: (a, b) => b.revenue - a.revenue || b.qty - a.qty
    });
    return limit == null ? rows : rows.slice(0, limit);
  }

  /**
   * Tong tien/so phieu nhap theo NCC (gom theo TEN NCC, '(Không xác định)'
   * neu khong co) trong khoang [from, to] — tu daily_purchase_summary.
   */
  async function getPurchasesBySupplier({ branch, from = null, to = null, limit = null }) {
    const scope = resolvePhysicalBranches(branch);
    const perBranchLimit = scope.length > 1 ? null : limit;
    const groups = await Promise.all(scope.map(async physicalBranch => {
      const result = await pool.query(PURCHASES_BY_SUPPLIER_SQL, [resolveBranchCode(physicalBranch), from, to, perBranchLimit]);
      return {
        branch: physicalBranch,
        rows: result.rows.map(row => ({
          name: row.name || '(Không xác định)',
          orderCount: Number(row.order_count) || 0,
          total: Number(row.total) || 0
        }))
      };
    }));
    const rows = mergeAdditiveRows(groups, {
      keyOf: row => String(row.name || '').trim().toLocaleLowerCase('vi-VN'),
      firstFields: ['name'],
      additiveFields: ['orderCount', 'total'],
      sort: (a, b) => b.total - a.total
    });
    return limit == null ? rows : rows.slice(0, limit);
  }

  /** Tong so phieu nhap/tong tien nhap TOAN THOI GIAN (khong loc ngay). */
  async function getPurchaseTotals({ branch }) {
    const groups = await queryPhysicalBranches(branch, async (_physicalBranch, branchCode) => {
      const result = await pool.query(PURCHASE_TOTALS_SQL, [branchCode]);
      const row = result.rows[0] || { order_count: 0, total: 0 };
      return [{ orderCount: Number(row.order_count) || 0, total: Number(row.total) || 0 }];
    });
    return groups.reduce((total, group) => ({
      orderCount: total.orderCount + group.rows[0].orderCount,
      total: total.total + group.rows[0].total
    }), { orderCount: 0, total: 0 });
  }

  /**
   * Ngay nhap hang DAU TIEN cua tung ma hang, toan bo lich su — tu
   * product_first_purchase. `firstPurchaseDateText` la chuoi 'DD/MM/YYYY
   * HH24:MI:SS' (dung format nhu Sheets) de dashboardData.js parse lai bang
   * parseSheetDate() — giu logic quy doi mui gio tap trung 1 noi.
   */
  async function getFirstPurchaseDates({ branch }) {
    const groups = await queryPhysicalBranches(branch, async (_physicalBranch, branchCode) => {
      const result = await pool.query(FIRST_PURCHASE_DATES_SQL, [branchCode]);
      return result.rows.map(row => ({
        code: row.code || '',
        name: row.name || row.code || '',
        firstPurchaseDateText: row.first_purchase_date_text || ''
      }));
    });
    const merged = new Map();
    groups.forEach(({ rows }) => rows.forEach(row => {
      const key = String(row.code || '').trim().toLocaleLowerCase('vi-VN');
      const current = merged.get(key);
      if (!current) {
        merged.set(key, { ...row });
      } else if (dateTextSortValue(row.firstPurchaseDateText) < dateTextSortValue(current.firstPurchaseDateText)) {
        current.firstPurchaseDateText = row.firstPurchaseDateText;
      }
    }));
    return Array.from(merged.values());
  }

  /**
   * Tong so luong ban theo tung MA HOA DON trong khoang [from, to] — dung cho
   * cot "SL" o bang "Chi tiết giao dịch" (buildTransactionsReport trong
   * dashboardData.js). Xem ghi chu o INVOICE_QUANTITIES_SQL.
   */
  async function getInvoiceQuantitiesByCode({ branch, from = null, to = null }) {
    const groups = await queryPhysicalBranches(branch, async (_physicalBranch, branchCode) => {
      const result = await pool.query(INVOICE_QUANTITIES_SQL, [branchCode, from, to]);
      return result.rows.map(row => ({ code: row.code || '', quantity: Number(row.quantity) || 0 }));
    });
    if (groups.length === 1) return groups[0].rows;
    return groups.flatMap(group => group.rows.map(row => ({ ...row, branch: group.branch })));
  }

  /**
   * Danh sach PHIEU NHAP rieng le (ma/ngay/NCC/tong tien/trang thai) trong
   * khoang [from, to] — doc THANG tu `purchases` (xem ghi chu o
   * RECENT_PURCHASE_ORDERS_SQL), dung cho bang "Hàng nhập" (khong the thay
   * bang rollup vi can giu dung tung phieu, khong gom).
   */
  async function listPurchaseOrders({ branch, from = null, to = null }) {
    const groups = await queryPhysicalBranches(branch, async (_physicalBranch, branchCode) => {
      const result = await pool.query(RECENT_PURCHASE_ORDERS_SQL, [branchCode, from, to]);
      return result.rows.map(row => ({
        code: row.code || '',
        date: row.date || '',
        supplier: row.supplier || '',
        branch: row.branch || '',
        total: Number(row.total) || 0,
        status: row.status || ''
      }));
    });
    if (groups.length === 1) return groups[0].rows;
    return groups
      .flatMap(group => group.rows.map(row => ({ ...row, branch: group.branch })))
      .sort((a, b) => dateTextSortValue(b.date) - dateTextSortValue(a.date));
  }

  return {
    getInvoiceRevenueByDay,
    getProductSalesBreakdown,
    getTopSellingProducts,
    getPurchasesBySupplier,
    getPurchaseTotals,
    getFirstPurchaseDates,
    getInvoiceQuantitiesByCode,
    listPurchaseOrders
  };
}

const repository = createDashboardRollupRepository();

module.exports = {
  createDashboardRollupRepository,
  getInvoiceRevenueByDay: (...args) => repository.getInvoiceRevenueByDay(...args),
  getProductSalesBreakdown: (...args) => repository.getProductSalesBreakdown(...args),
  getTopSellingProducts: (...args) => repository.getTopSellingProducts(...args),
  getPurchasesBySupplier: (...args) => repository.getPurchasesBySupplier(...args),
  getPurchaseTotals: (...args) => repository.getPurchaseTotals(...args),
  getFirstPurchaseDates: (...args) => repository.getFirstPurchaseDates(...args),
  getInvoiceQuantitiesByCode: (...args) => repository.getInvoiceQuantitiesByCode(...args),
  listPurchaseOrders: (...args) => repository.listPurchaseOrders(...args)
};
