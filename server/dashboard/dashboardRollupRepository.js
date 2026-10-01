'use strict';
// ==========================================
// DASHBOARD ROLLUP REPOSITORY — doc cac bang rollup theo ngay
// (server/db/migrations/0013_dashboard_rollups.sql, tinh san boi
// server/kiotvietSync/dashboardRollupRefresh.js) dung cho cac khoi nang nhat
// cua /api/dashboard (doanh thu hoa don theo ngay, top san pham ban chay,
// ngay nhap dau tien) — thay cho viec dashboardData.js tu quet
// "Chi tiết hóa đơn" (tab nang nhat, ~14s/lan doc) trong Node.js moi request.
//
// Factory pattern giong debtCollectionStatusRepository.js. Ten/nhom hang
// LUON join truc tiep voi products/categories HIEN TAI tai thoi
// diem doc (khong bake vao rollup) — rollup chi luu so da tong hop.
//
// `from`/`to` cua moi ham la chuoi 'YYYY-MM-DD' (hoac null = khong gioi han)
// theo LICH VN cua bo loc dang chon — do dashboardData.js tinh san (ham
// rangeToDateBounds(), dung getDashboardDateParts() da co san o do) roi
// truyen xuong, tranh lap logic quy doi mui gio o 2 noi.
// ==========================================
const { getPool } = require('../db/pool');
const { BRANCHES, branchLabelToCode, resolveBranchScope } = require('../branch/branches');

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

// Tien tra hang theo ngay TRA (return_date, gio treo tuong VN gan nhan UTC nen doc
// qua AT TIME ZONE 'UTC'), de tru khoi doanh thu ban thanh doanh thu thuc te.
// Chi phieu 'Đã trả' (loai 'Phiếu tạm'/'Đã hủy'); `total` = gia tri hang khach tra
// (cot "Tổng tiền trả" cua tab Tra hang), KHONG dung totalPayment vi do la so tien
// mat thuc hoan va thuong = 0 khi tra hang bu vao cong no. So sanh thang voi cot
// goc (khong boc AT TIME ZONE) de dung index idx_returns_return_date.
const RETURN_AMOUNT_BY_DAY_SQL = `
  SELECT
    to_char((return_date AT TIME ZONE 'UTC')::date, 'DD/MM/YYYY') AS date_key,
    COALESCE(SUM(total), 0)::float8 AS return_amount,
    COUNT(*)::int AS return_count
  FROM returns
  WHERE branch = $1
    AND return_date IS NOT NULL
    AND raw->>'statusValue' = 'Đã trả'
    AND ($2::date IS NULL OR return_date >= ($2::date)::timestamp AT TIME ZONE 'UTC')
    AND ($3::date IS NULL OR return_date < (($3::date + 1)::timestamp AT TIME ZONE 'UTC'))
  GROUP BY 1`;

// Dung chung cho getProductSalesBreakdown/getTopSellingProducts — ten/ma hang
// luon lay tu `products` HIEN TAI (LEFT JOIN, khong INNER JOIN de khong mat
// dong neu 1 product_id cu khong con khop, du KiotViet khong xoa cung
// products that su). Chi hang "Đang kinh doanh": hang ngung kinh doanh (is_active
// = false) bi loai; khong khop products (p.* NULL) hoac is_active NULL van tinh.
const PRODUCT_SALES_BASE_SQL = `
  SELECT
    d.product_id AS product_id,
    COALESCE(p.code, 'PID-' || d.product_id::text) AS code,
    NULLIF(p.name, '') AS name,
    SUM(d.qty)::float8 AS qty,
    SUM(d.revenue)::float8 AS revenue
  FROM daily_product_sales d
  LEFT JOIN products p ON p.branch = d.branch AND p.id = d.product_id
  WHERE d.branch = $1
    AND ($2::date IS NULL OR d.sale_date >= $2::date)
    AND ($3::date IS NULL OR d.sale_date <= $3::date)
    AND p.is_active IS NOT FALSE
  GROUP BY d.product_id, p.code, p.name`;

const TOP_SELLING_PRODUCTS_SQL = `${PRODUCT_SALES_BASE_SQL} ORDER BY revenue DESC LIMIT $4`;

const FIRST_PURCHASE_DATES_SQL = `
  SELECT
    COALESCE(p.code, 'PID-' || pf.product_id::text) AS code,
    COALESCE(p.name, p.code, 'PID-' || pf.product_id::text) AS name,
    to_char(pf.first_purchase_date AT TIME ZONE 'UTC', 'DD/MM/YYYY HH24:MI:SS') AS first_purchase_date_text
  FROM product_first_purchase pf
  LEFT JOIN products p ON p.branch = pf.branch AND p.id = pf.product_id
  WHERE pf.branch = $1
    AND p.is_active IS NOT FALSE`;

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

function createDashboardRollupRepository({ pool = getPool() } = {}) {
  /**
   * Doanh thu THUC TE theo ngay = doanh thu hoa don 'Hoàn thành' (daily_invoice_summary)
   * tru tien tra hang 'Đã trả' cua ngay do (bang returns, theo ngay tra). Moi dong:
   * `revenue` = thuc te (da tru), `grossRevenue` = doanh thu ban, `returnAmount`/
   * `returnCount` = tra hang; `invoiceCount` van la so hoa don hoan thanh. Ngay chi
   * co tra hang (khong co hoa don) van la 1 dong (revenue am).
   */
  async function getInvoiceRevenueByDay({ branch, from = null, to = null }) {
    const groups = await queryPhysicalBranches(branch, async (_physicalBranch, branchCode) => {
      const [sales, returned] = await Promise.all([
        pool.query(INVOICE_REVENUE_BY_DAY_SQL, [branchCode, from, to]),
        pool.query(RETURN_AMOUNT_BY_DAY_SQL, [branchCode, from, to])
      ]);
      const byDate = new Map();
      const bucketOf = dateKey => {
        if (!byDate.has(dateKey)) {
          byDate.set(dateKey, { dateKey, grossRevenue: 0, returnAmount: 0, returnCount: 0, invoiceCount: 0 });
        }
        return byDate.get(dateKey);
      };
      sales.rows.forEach(row => {
        const bucket = bucketOf(row.date_key);
        bucket.grossRevenue += Number(row.revenue) || 0;
        bucket.invoiceCount += Number(row.invoice_count) || 0;
      });
      returned.rows.forEach(row => {
        const bucket = bucketOf(row.date_key);
        bucket.returnAmount += Number(row.return_amount) || 0;
        bucket.returnCount += Number(row.return_count) || 0;
      });
      return Array.from(byDate.values()).map(bucket => ({
        ...bucket,
        revenue: bucket.grossRevenue - bucket.returnAmount
      }));
    });
    return mergeAdditiveRows(groups, {
      keyOf: row => row.dateKey,
      firstFields: ['dateKey'],
      additiveFields: ['revenue', 'grossRevenue', 'returnAmount', 'returnCount', 'invoiceCount'],
      sort: (a, b) => dateTextSortValue(a.dateKey) - dateTextSortValue(b.dateKey)
    });
  }

  function mapProductSalesRow(row, preserveNameSource = false) {
    const mapped = {
      code: row.code || '',
      name: row.name || row.code || '',
      qty: Number(row.qty) || 0,
      revenue: Number(row.revenue) || 0
    };
    if (preserveNameSource) mapped._hasDisplayName = Boolean(String(row.name || '').trim());
    return mapped;
  }

  function mergeProductSalesGroups(groups, { sort, preserveNameSource = false } = {}) {
    const merged = new Map();
    groups.forEach(({ rows }) => rows.forEach(row => {
      const key = String(row.code || '').trim().toLocaleLowerCase('vi-VN');
      if (!merged.has(key)) {
        merged.set(key, { ...row, qty: 0, revenue: 0 });
      }
      const target = merged.get(key);
      if (target._hasDisplayName === false && row._hasDisplayName === true) {
        target.name = row.name;
        target._hasDisplayName = true;
      }
      target.qty += Number(row.qty) || 0;
      target.revenue += Number(row.revenue) || 0;
    }));
    const rows = Array.from(merged.values());
    if (sort) rows.sort(sort);
    return rows.map(row => {
      const result = { code: row.code, name: row.name || row.code || '', qty: row.qty, revenue: row.revenue };
      if (preserveNameSource) result._hasDisplayName = row._hasDisplayName;
      return result;
    });
  }

  /**
   * Doanh thu/SL ban theo tung ma hang trong khoang [from, to] — tu
   * daily_product_sales (da loai hoa don status=2 Da huy tu luc refresh).
   * Thay vong quet "Chi tiết hóa đơn" cho khoi Top san pham ban chay + doanh
   * thu theo nhom hang cha/con — dashboardData.js tu gom nhom (da co san
   * productParentCategoryByCode/productChildCategoryByCode tu tab Hang hoa)
   * thay vi lap lai logic do trong SQL.
   */
  async function getProductSalesBreakdown({ branch, from = null, to = null, preserveNameSource = false }) {
    const groups = await queryPhysicalBranches(branch, async (_physicalBranch, branchCode) => {
      const result = await pool.query(`${PRODUCT_SALES_BASE_SQL}`, [branchCode, from, to]);
      return result.rows.map(row => mapProductSalesRow(row, true));
    });
    // Hang hoa cung ma o hai co so la hai dong rieng: nhieu co so thi KHONG gop qua
    // co so, moi dong gan nhan co so vat ly (`branch`).
    if (groups.length > 1) {
      return groups.flatMap(group => mergeProductSalesGroups([group], { preserveNameSource })
        .map(row => ({ ...row, branch: group.branch })));
    }
    return mergeProductSalesGroups(groups, { preserveNameSource });
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
      return { branch: physicalBranch, rows: result.rows.map(row => mapProductSalesRow(row, true)) };
    }));
    const rows = mergeProductSalesGroups(groups, {
      sort: (a, b) => b.revenue - a.revenue || b.qty - a.qty
    });
    return limit == null ? rows : rows.slice(0, limit);
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
    // Nhieu co so: giu tung dong theo co so (khong gop theo ma), gan nhan co so vat ly.
    const multiBranch = groups.length > 1;
    const merged = new Map();
    groups.forEach(({ branch: physicalBranch, rows }) => rows.forEach(row => {
      const code = String(row.code || '').trim().toLocaleLowerCase('vi-VN');
      const key = multiBranch ? `${physicalBranch} ${code}` : code;
      const current = merged.get(key);
      if (!current) {
        merged.set(key, multiBranch ? { ...row, branch: physicalBranch } : { ...row });
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

  return {
    getInvoiceRevenueByDay,
    getProductSalesBreakdown,
    getTopSellingProducts,
    getFirstPurchaseDates,
    getInvoiceQuantitiesByCode
  };
}

const repository = createDashboardRollupRepository();

module.exports = {
  createDashboardRollupRepository,
  getInvoiceRevenueByDay: (...args) => repository.getInvoiceRevenueByDay(...args),
  getProductSalesBreakdown: (...args) => repository.getProductSalesBreakdown(...args),
  getTopSellingProducts: (...args) => repository.getTopSellingProducts(...args),
  getFirstPurchaseDates: (...args) => repository.getFirstPurchaseDates(...args),
  getInvoiceQuantitiesByCode: (...args) => repository.getInvoiceQuantitiesByCode(...args)
};
