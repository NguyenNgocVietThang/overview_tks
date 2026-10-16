'use strict';

// Doc bang product_report ("Bao cao hang hoa", tab Tong quan) - bang duoc
// tinh san 1 lan/dem boi server/kiotvietSync/productReportRefresh.js
// (server/db/migrations/0018_product_report.sql). Repository nay CHI doc, ap
// dung cho ca route GET va luong xuat Excel (exportService.js) de khong viet
// trung logic map cot o 2 noi.
const { getPool } = require('../db/pool');
const { readContainerSummary } = require('../productContainers/repository');
const { normalizeCode } = require('../productContainers/parser');

function mapRow(row) {
  return {
    code: row.product_code,
    name: row.product_name,
    stockHanoi: Number(row.stock_hanoi) || 0,
    stockSaigon: Number(row.stock_saigon) || 0,
    availableToSell: Number(row.available_to_sell) || 0,
    qtySold30d: Number(row.qty_sold_30d) || 0,
    revenue90d: Number(row.revenue_90d) || 0,
    customerCount90d: Number(row.customer_count_90d) || 0,
    topCustomerRevenue90d: Number(row.top_customer_revenue_90d) || 0,
    topCustomerName: row.top_customer_name || '',
    topCustomerShare: row.top_customer_share === null || row.top_customer_share === undefined
      ? null : Number(row.top_customer_share),
    computedAt: row.computed_at
  };
}

async function getProductReport({ pool = getPool() } = {}) {
  // Loc trang thai hien tai khi doc de snapshot ban dem, KPI va file xuat
  // cung chi gom ma con kinh doanh o it nhat mot co so. NULL giu quy uoc
  // mac dinh dang kinh doanh nhu bao cao dut hang; khong loc theo ton/doanh so.
  const { rows } = await pool.query(
    `SELECT * FROM product_report
     WHERE EXISTS (
       SELECT 1 FROM products p
       WHERE p.code = product_report.product_code
         AND p.branch IN ('hanoi', 'saigon')
         AND p.is_active IS NOT FALSE
     )
     ORDER BY product_code`
  );
  const items = rows.map(mapRow);
  const computedAt = items.length ? items.reduce((latest, item) => (
    !latest || (item.computedAt && item.computedAt > latest) ? item.computedAt : latest
  ), null) : null;
  const { containerSync, totals } = await readContainerSummary(pool);
  for (const item of items) {
    const quantities = totals[normalizeCode(item.code)];
    item.unloadedQty = containerSync.available ? Number(quantities?.unloadedQty || 0) : null;
    item.loadedQty = containerSync.available ? Number(quantities?.loadedQty || 0) : null;
  }
  return { rows: items, computedAt, containerSync };
}

// Khung "Chi tiet" duoi bang: doanh so 90 ngay cua tung khach da mua ma hang nay
// (bang product_report_customers, cung snapshot voi product_report - xem migration
// 0023). % = doanh so khach / TONG doanh so cac khach cua ma hang nen luon cong
// lai 100%; co the lech rat nhe so voi cot "% Khach lon nhat" vi mau so cot do la
// revenue_90d lay tu rollup daily_product_sales.
async function getProductReportCustomers({ code, pool = getPool() } = {}) {
  const trimmed = typeof code === 'string' ? code.trim() : '';
  if (!trimmed) {
    const error = new Error('Thiếu mã hàng.');
    error.statusCode = 400;
    throw error;
  }
  const { rows } = await pool.query(
    `SELECT customer_name, revenue
     FROM product_report_customers
     WHERE product_key = lower(btrim($1))
     ORDER BY revenue DESC, customer_name`,
    [code]
  );
  const totalRevenue = rows.reduce((sum, row) => sum + (Number(row.revenue) || 0), 0);
  return {
    code: trimmed,
    totalRevenue,
    customerCount: rows.length,
    rows: rows.map((row) => {
      const revenue = Number(row.revenue) || 0;
      return {
        customerName: row.customer_name || '',
        revenue,
        share: totalRevenue > 0 ? revenue / totalRevenue : null
      };
    })
  };
}

module.exports = { getProductReport, getProductReportCustomers, __test__: { mapRow } };
