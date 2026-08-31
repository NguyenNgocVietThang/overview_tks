'use strict';

const TOP_CUSTOMER_REVENUE_CHART_LIMIT = 15; // dashboardData.js:27
const TOP_CUSTOMER_REVENUE_TABLE_LIMIT = 50; // dashboardData.js:28
const CUSTOMER_PRODUCT_TOP_LIMIT = 3; // dashboardData.js:19
const CUSTOMER_PRODUCT_REVENUE_WINDOW_DAYS = 90; // dashboardData.js:29
const CUSTOMER_PRODUCT_REVENUE_MONTH_DAYS = 30; // dashboardData.js:30

const INVOICE_STATUS_COMPLETED = 3;
const INVOICE_STATUS_CANCELLED = 2;
const RETURN_STATUS_COMPLETED = 1;

// aggregateCustomerRevenueFromSheetRows (dashboardData.js:1022-1122): doanh
// thu = SUM(invoice.total hoan thanh) - SUM(return.total hoan thanh), cung
// khoang thoi gian, gom theo customer_id.
async function getTopCustomersByRevenue(pool, branchId, range) {
  const { rows } = await pool.query(
    `SELECT c.customer_code AS code, c.name,
            COALESCE(inv.revenue, 0) - COALESCE(ret.revenue, 0) AS revenue,
            COALESCE(inv.cnt, 0) AS sale_order_count
     FROM customers c
     LEFT JOIN LATERAL (
       SELECT SUM(total_amount) AS revenue, COUNT(*) AS cnt
       FROM invoices
       WHERE customer_id = c.id AND status = $2
         AND ($3::timestamptz IS NULL OR purchase_date >= $3)
         AND ($4::timestamptz IS NULL OR purchase_date <= $4)
     ) inv ON true
     LEFT JOIN LATERAL (
       SELECT SUM(return_total) AS revenue
       FROM returns
       WHERE customer_id = c.id AND status = $5
         AND ($3::timestamptz IS NULL OR return_date >= $3)
         AND ($4::timestamptz IS NULL OR return_date <= $4)
     ) ret ON true
     WHERE c.branch_id = $1 AND (inv.cnt > 0 OR ret.revenue IS NOT NULL)
     ORDER BY revenue DESC
     LIMIT $6`,
    [branchId, INVOICE_STATUS_COMPLETED, range.from, range.to, RETURN_STATUS_COMPLETED, TOP_CUSTOMER_REVENUE_TABLE_LIMIT]
  );
  const sorted = rows.map((r) => ({
    code: r.code,
    name: r.name,
    saleOrderCount: Number(r.sale_order_count),
    revenue: Number(r.revenue)
  }));
  return {
    top15: sorted.slice(0, TOP_CUSTOMER_REVENUE_CHART_LIMIT),
    top50: sorted.slice(0, TOP_CUSTOMER_REVENUE_TABLE_LIMIT)
  };
}

// searchTopCustomersByProducts (dashboardData.js:768-887): tra cuu doanh so
// mua theo (san pham, khach hang) trong khoang loc, top 3 khach/san pham.
//
// GHI CHU GIOI HAN SCHEMA: ban Sheets con tra ve returnedQuantityAllTime/
// returnValueAllTime (tra hang MOI THOI GIAN, theo tung san pham) tu 1 report
// KiotViet dung san. Schema Postgres cua Phase 1 KHONG co bang chi tiet tra
// hang theo san pham (chi co returns.return_total o muc header, khong co
// return_line_items) nen 2 truong nay tra ve 0 - can bo sung bang
// return_line_items o Phase 1 truoc khi lam that 2 truong nay. Xem
// PHASE2_PG_MODULES.md.
async function searchTopCustomersByProducts(pool, branchId, productCodes, range, limit) {
  if (!productCodes || !productCodes.length) return [];

  const { rows } = await pool.query(
    `SELECT ili.product_code_snapshot AS product_code, ili.product_name_snapshot AS product_name,
            c.customer_code, c.name AS customer_name,
            SUM(ili.quantity) AS purchased_quantity,
            SUM(ili.line_amount) AS purchase_revenue,
            MAX(i.purchase_date) AS last_purchase_date,
            ROW_NUMBER() OVER (
              PARTITION BY ili.product_code_snapshot
              ORDER BY SUM(ili.quantity) DESC, SUM(ili.line_amount) DESC, MAX(i.purchase_date) DESC
            ) AS rn
     FROM invoice_line_items ili
     JOIN invoices i ON i.id = ili.invoice_id
     LEFT JOIN customers c ON c.id = i.customer_id
     WHERE i.branch_id = $1 AND i.status <> $2
       AND ili.product_code_snapshot = ANY($3::text[])
       AND ($4::timestamptz IS NULL OR i.purchase_date >= $4)
       AND ($5::timestamptz IS NULL OR i.purchase_date <= $5)
     GROUP BY ili.product_code_snapshot, ili.product_name_snapshot, c.customer_code, c.name`,
    [branchId, INVOICE_STATUS_CANCELLED, productCodes, range.from, range.to]
  );

  return rows
    .filter((r) => Number(r.rn) <= CUSTOMER_PRODUCT_TOP_LIMIT)
    .sort((a, b) => productCodes.indexOf(a.product_code) - productCodes.indexOf(b.product_code) || Number(a.rn) - Number(b.rn))
    .slice(0, limit)
    .map((r) => ({
      productCode: r.product_code,
      productName: r.product_name,
      customerCode: r.customer_code,
      customerName: r.customer_name || 'Khách lẻ',
      purchasedQuantity: Number(r.purchased_quantity),
      purchaseRevenue: Number(r.purchase_revenue),
      returnedQuantityAllTime: 0,
      returnValueAllTime: 0,
      netRevenue: Number(r.purchase_revenue),
      lastPurchaseDate: r.last_purchase_date.toISOString()
    }));
}

// getCustomerProductRevenueReport (dashboardData.js:1149-1315): doanh thu 90
// ngay gan nhat cua 1 khach, tach theo san pham + bucket thang (0-29/30-59/60-89).
async function getCustomerProductRevenueReport(pool, branchId, customerCode, now) {
  const customerRes = await pool.query(
    `SELECT id, name FROM customers WHERE branch_id = $1 AND customer_code = $2`,
    [branchId, customerCode]
  );
  const customer = customerRes.rows[0];
  const rangeEnd = now;
  const rangeStart = new Date(now.getTime() - (CUSTOMER_PRODUCT_REVENUE_WINDOW_DAYS - 1) * 86400000);

  if (!customer) {
    return {
      customer: { code: customerCode, name: customerCode },
      range: { days: CUSTOMER_PRODUCT_REVENUE_WINDOW_DAYS },
      totalRevenue: 0,
      totalQuantity: 0,
      products: []
    };
  }

  const { rows } = await pool.query(
    `SELECT ili.product_code_snapshot AS code, ili.product_name_snapshot AS name,
            ili.quantity, ili.line_amount, i.purchase_date,
            EXTRACT(DAY FROM ($3::timestamptz - i.purchase_date)) AS age_days
     FROM invoice_line_items ili
     JOIN invoices i ON i.id = ili.invoice_id
     WHERE i.branch_id = $1 AND i.customer_id = $2 AND i.status = $4
       AND i.purchase_date >= $5 AND i.purchase_date <= $3
     ORDER BY i.purchase_date ASC`,
    [branchId, customer.id, rangeEnd, INVOICE_STATUS_COMPLETED, rangeStart]
  );

  const productsByCode = new Map();
  for (const r of rows) {
    if (!productsByCode.has(r.code)) {
      productsByCode.set(r.code, { code: r.code, name: r.name, quantity: 0, revenue: 0, month1Revenue: 0, month2Revenue: 0, month3Revenue: 0 });
    }
    const p = productsByCode.get(r.code);
    const qty = Number(r.quantity);
    const revenue = Number(r.line_amount);
    p.quantity += qty;
    p.revenue += revenue;
    const age = Number(r.age_days);
    if (age < CUSTOMER_PRODUCT_REVENUE_MONTH_DAYS) p.month1Revenue += revenue;
    else if (age < CUSTOMER_PRODUCT_REVENUE_MONTH_DAYS * 2) p.month2Revenue += revenue;
    else if (age < CUSTOMER_PRODUCT_REVENUE_MONTH_DAYS * 3) p.month3Revenue += revenue;
  }

  const products = Array.from(productsByCode.values()).sort((a, b) => b.revenue - a.revenue);

  return {
    customer: { code: customerCode, name: customer.name || customerCode },
    range: { days: CUSTOMER_PRODUCT_REVENUE_WINDOW_DAYS },
    totalRevenue: products.reduce((sum, p) => sum + p.revenue, 0),
    totalQuantity: products.reduce((sum, p) => sum + p.quantity, 0),
    products
  };
}

// dashboardData.js:1943-1976: KPI tong (totalCustomers/customersWithDebt/
// totalDebt) la snapshot HIEN TAI (khong loc thoi gian). topDebt thu hep vao
// khach VUA co no (>0) VUA co it nhat 1 hoa don hoan thanh(3) trong ky - ban
// Sheets phai noi bang SDT vi hoa don khong luu ma khach; Postgres co FK
// customer_id truc tiep nen JOIN thang, khong can noi gian tiep qua SDT.
async function getCustomerDebtSummary(pool, branchId, range) {
  const { rows: totals } = await pool.query(
    `SELECT COUNT(*) AS total_customers,
            COUNT(*) FILTER (WHERE debt_amount > 0) AS with_debt,
            COALESCE(SUM(debt_amount) FILTER (WHERE debt_amount > 0), 0) AS total_debt
     FROM customers WHERE branch_id = $1`,
    [branchId]
  );

  const { rows: topDebtRows } = await pool.query(
    `SELECT c.customer_code AS code, c.name, c.contact_number AS phone, c.debt_amount AS debt,
            COALESCE(inv.revenue, 0) AS period_revenue
     FROM customers c
     JOIN LATERAL (
       SELECT SUM(total_amount) AS revenue
       FROM invoices
       WHERE customer_id = c.id AND status = $2
         AND ($3::timestamptz IS NULL OR purchase_date >= $3)
         AND ($4::timestamptz IS NULL OR purchase_date <= $4)
     ) inv ON true
     WHERE c.branch_id = $1 AND c.debt_amount > 0 AND inv.revenue IS NOT NULL
     ORDER BY c.debt_amount DESC`,
    [branchId, INVOICE_STATUS_COMPLETED, range.from, range.to]
  );

  return {
    totalCustomers: Number(totals[0].total_customers),
    customersWithDebt: Number(totals[0].with_debt),
    totalDebt: Number(totals[0].total_debt),
    topDebt: topDebtRows.map((r) => ({
      code: r.code,
      name: r.name,
      phone: r.phone,
      debt: Number(r.debt),
      periodRevenue: Number(r.period_revenue)
    }))
  };
}

module.exports = {
  getTopCustomersByRevenue,
  searchTopCustomersByProducts,
  getCustomerProductRevenueReport,
  getCustomerDebtSummary
};
