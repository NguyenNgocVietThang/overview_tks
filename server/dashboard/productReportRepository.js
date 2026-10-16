'use strict';

// Doc bang product_report ("Bao cao hang hoa", tab Tong quan) - bang duoc
// tinh san 1 lan/dem boi server/kiotvietSync/productReportRefresh.js
// (server/db/migrations/0018_product_report.sql). Repository nay CHI doc, ap
// dung cho ca route GET va luong xuat Excel (exportService.js) de khong viet
// trung logic map cot o 2 noi.
const { getPool } = require('../db/pool');
const { readContainerSummary, getContainerMeta } = require('../productContainers/repository');
const { normalizeCode } = require('../productContainers/parser');
const { readInTransitByCode } = require('./inTransitSource');

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

// Hang dang van chuyen (order_suppliers) nho (vai tram dong) nhung doi sau moi luot sync; doc lai toi da
// moi chu ky nay thay vi moi request.
const IN_TRANSIT_TTL_MS = 60 * 1000;
const STATE_PROBE_SQL = 'SELECT version::text AS version, computed_at FROM product_report_state WHERE id = 1';

/**
 * Bo doc "Bao cao hang hoa". Khi co bang product_report_state (migration 0055, che do lam moi tang dan) thi
 * doc theo PHIEN BAN: 10,9K dong chi bi keo tu DB ve may chu 1 lan moi khi `version` doi (chi tang khi co dong
 * that su doi), tong CONT chi doc lai khi version CONT doi, hang van chuyen cache toi da 60 giay; nhieu nguoi
 * xem/xuat file dung chung. Chua co state => luong cu (loc is_active luc doc, khong cache).
 * Cache nam trong bo bo doc, nen moi lan goi voi pool truyen vao (test) la bo doc moi, khong dung chung.
 */
function createProductReportReader({ pool, now = Date.now } = {}) {
  let rowsCache = null; // { version, rows }  - dong da map, KHONG bi sua
  let containerCache = null; // { version, totals }
  let transitCache = null; // { at, byCode }

  async function probeState() {
    try {
      const { rows } = await pool.query(STATE_PROBE_SQL);
      return rows[0] && rows[0].version != null ? rows[0] : null;
    } catch (error) {
      if (error.code === '42P01') return null; // chua chay migration 0055
      throw error;
    }
  }

  async function readInTransit() {
    if (!transitCache || now() - transitCache.at > IN_TRANSIT_TTL_MS) {
      transitCache = { at: now(), byCode: await readInTransitByCode(pool) };
    }
    return transitCache.byCode;
  }

  async function readVersioned(state) {
    if (!rowsCache || rowsCache.version !== state.version) {
      // Bang da chi giu ma dang kinh doanh (job tang dan loc is_active khi ghi) nen khong con EXISTS luc doc.
      const { rows } = await pool.query('SELECT * FROM product_report ORDER BY product_code');
      rowsCache = { version: state.version, rows: rows.map(mapRow) };
    }
    const { containerSync } = await getContainerMeta({ pool });
    let totals = {};
    if (containerSync.available) {
      if (!containerCache || containerCache.version !== containerSync.version) {
        const summary = await readContainerSummary(pool);
        containerCache = { version: summary.containerSync.version, totals: summary.totals };
      }
      totals = containerCache.totals;
    }
    const inTransitByCode = await readInTransit();
    return { base: rowsCache.rows, computedAt: state.computed_at, containerSync, totals, inTransitByCode };
  }

  async function read() {
    const state = await probeState();
    if (state) {
      const part = await readVersioned(state);
      return { ...compose(part), reportVersion: state.version };
    }
    return { ...(await readLegacy(pool)), reportVersion: null };
  }

  return { read, probeState };
}

// Ghep dong goc (da cache) voi CONT + hang van chuyen thanh phan hoi; tao dong moi de khong sua cache.
function compose({ base, computedAt, containerSync, totals, inTransitByCode }) {
  const rows = base.map((row) => {
    const inTransit = inTransitByCode.get(normalizeCode(row.code)) || 0;
    const quantities = totals[normalizeCode(row.code)];
    return {
      ...row,
      inTransit,
      // The stored base already equals sellable HN + sellable SG (on-hand less pending customer orders).
      // Add SG transit once at read time, never fold it back into the stored base.
      availableToSell: row.availableToSell + inTransit,
      unloadedQty: containerSync.available ? Number(quantities?.unloadedQty || 0) : null,
      loadedQty: containerSync.available ? Number(quantities?.loadedQty || 0) : null
    };
  });
  return { rows, computedAt, containerSync };
}

let defaultReader = null;
async function getProductReport({ pool } = {}) {
  if (pool) return createProductReportReader({ pool }).read();
  if (!defaultReader) defaultReader = createProductReportReader({ pool: getPool() });
  return defaultReader.read();
}

// Chi phien ban bao cao (nhe, 1 dong) cho /containers/meta; null neu chua co state/loi.
async function getProductReportVersion({ pool } = {}) {
  try {
    const reader = pool ? createProductReportReader({ pool }) : (defaultReader ||= createProductReportReader({ pool: getPool() }));
    const state = await reader.probeState();
    return state ? state.version : null;
  } catch {
    return null;
  }
}

async function readLegacy(pool) {
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
  const inTransitByCode = await readInTransitByCode(pool);
  return compose({ base: items, computedAt, containerSync, totals, inTransitByCode });
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

module.exports = {
  getProductReport, getProductReportCustomers, getProductReportVersion, createProductReportReader,
  __test__: { mapRow }
};
