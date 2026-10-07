'use strict';

// Nguon du lieu Bao cao kinh doanh. Thang DA CHOT (co dong business_monthly_state) doc
// tu bang 0036; thang CHUA chot (thang hien tai, hoac thang vua qua khi job chua kip chot /
// chua backfill) tinh truc tiep bang CUNG cau SQL cua job. Ket qua cache ttlMs (mac dinh
// 60s, stale-while-revalidate) vi tinh live 1 thang mat ~1-2s. Luon gop HN + SG.

const { getPool } = require('../db/pool');
const sql = require('./businessMonthlySql');
const { FIRST_MONTH, UNGROUPED_SALE, monthKey, addMonths, monthsBetween, vnToday, dayOfMonth } = require('./businessMonths');
const { freezeMonth, rebuildSaleTable } = require('../kiotvietSync/businessMonthlyRefresh');

const num = v => Number(v) || 0;

function createRepository({
  pool = getPool(), now = () => new Date(), ttlMs = 60 * 1000,
  freeze = freezeMonth, rebuildSale = rebuildSaleTable
} = {}) {
  let cache = null; // { at, promise }
  const liveCache = new Map(); // month -> { at, promise: {customers, customerProducts} }

  function live(month) {
    const hit = liveCache.get(month);
    if (hit && now().getTime() - hit.at < ttlMs) return hit.promise;
    const params = [sql.BRANCH_CODES, month, addMonths(month, 1)];
    const promise = Promise.all([
      pool.query(sql.CUSTOMER_MONTH_SELECT_SQL, params),
      pool.query(sql.CUSTOMER_PRODUCT_MONTH_SELECT_SQL, params)
    ]).then(([c, cp]) => ({ customers: c.rows, customerProducts: cp.rows }));
    liveCache.set(month, { at: now().getTime(), promise });
    promise.catch(() => liveCache.delete(month));
    return promise;
  }

  async function load() {
    const today = vnToday(now());
    const currentMonth = monthKey(today);
    const months = monthsBetween(FIRST_MONTH, currentMonth);
    const [state, frozenCustomers, frozenProducts, frozenSales, directory] = await Promise.all([
      pool.query(`SELECT to_char(month, 'YYYY-MM-DD') AS month FROM business_monthly_state`),
      pool.query(`SELECT to_char(month, 'YYYY-MM-DD') AS month, branch, customer_code, customer_name, net_revenue
                  FROM business_monthly_customer_sales WHERE month >= $1::date`, [FIRST_MONTH]),
      pool.query(`SELECT to_char(month, 'YYYY-MM-DD') AS month, product_code, product_name, net_revenue, net_qty
                  FROM business_monthly_product_sales WHERE month >= $1::date`, [FIRST_MONTH]),
      pool.query(`SELECT to_char(month, 'YYYY-MM-DD') AS month, sale_name, net_revenue
                  FROM business_monthly_sale_sales WHERE month >= $1::date`, [FIRST_MONTH]),
      pool.query(`SELECT DISTINCT ON (branch, btrim(code)) branch, btrim(code) AS code, name,
                         COALESCE(NULLIF(btrim(raw->>'groups'), ''), $1) AS sale_name,
                         COALESCE(btrim(raw->>'comments'), '') AS price_level
                  FROM customers WHERE btrim(COALESCE(code, '')) <> ''
                  ORDER BY branch, btrim(code), id DESC`, [UNGROUPED_SALE])
    ]);
    const frozenMonths = state.rows.map(r => r.month).filter(m => m < currentMonth).sort();
    const frozen = new Set(frozenMonths);
    const customers = frozenCustomers.rows.filter(r => frozen.has(r.month)).map(r => ({
      month: r.month, branch: r.branch, customerCode: r.customer_code, customerName: r.customer_name, netRevenue: num(r.net_revenue)
    }));
    const products = frozenProducts.rows.filter(r => frozen.has(r.month)).map(r => ({
      month: r.month, productCode: r.product_code, productName: r.product_name, netRevenue: num(r.net_revenue), netQty: num(r.net_qty)
    }));
    for (const month of months.filter(m => !frozen.has(m))) {
      const data = await live(month);
      for (const r of data.customers) customers.push({ month, branch: r.branch, customerCode: r.customer_code, customerName: r.customer_name, netRevenue: num(r.net_revenue) });
      const byCode = new Map();
      for (const r of data.customerProducts) {
        const p = byCode.get(r.product_code) || { month, productCode: r.product_code, productName: r.product_name, netRevenue: 0, netQty: 0 };
        p.netRevenue += num(r.net_revenue); p.netQty += num(r.net_qty);
        if (r.product_name) p.productName = r.product_name;
        byCode.set(r.product_code, p);
      }
      products.push(...byCode.values());
    }
    return {
      today, currentMonth, day: dayOfMonth(today), months, frozenMonths,
      customers, products,
      sales: frozenSales.rows.filter(r => frozen.has(r.month)).map(r => ({ month: r.month, saleName: r.sale_name, netRevenue: num(r.net_revenue) })),
      directory: directory.rows.map(r => ({ branch: r.branch, code: r.code, name: r.name || '', saleName: r.sale_name, priceLevel: r.price_level })),
      computedAt: now().toISOString()
    };
  }

  function snapshot() {
    if (cache && now().getTime() - cache.at < ttlMs) return cache.promise;
    const promise = load();
    cache = { at: now().getTime(), promise };
    promise.catch(() => { if (cache && cache.promise === promise) cache = null; });
    return promise;
  }

  async function linesFor(months, where, params, mapKey) {
    const snap = await snapshot();
    const frozen = new Set(snap.frozenMonths);
    const totals = new Map();
    const add = (row) => {
      const key = mapKey(row);
      const t = totals.get(key) || { ...row, revenue: 0, qty: 0 };
      t.revenue += num(row.net_revenue); t.qty += num(row.net_qty);
      totals.set(key, t);
    };
    const frozenList = months.filter(m => frozen.has(m));
    if (frozenList.length) {
      const { rows } = await pool.query(`SELECT branch, customer_code, product_code, product_name, net_revenue, net_qty
        FROM business_monthly_customer_product_sales
        WHERE month = ANY($1::date[]) AND ${where}`, [frozenList, ...params]);
      rows.forEach(add);
    }
    for (const m of months.filter(x => !frozen.has(x) && x >= FIRST_MONTH && x <= snap.currentMonth)) {
      const data = await live(m);
      data.customerProducts.filter(r => matches(r, where, params)).forEach(add);
    }
    return [...totals.values()].sort((a, b) => b.revenue - a.revenue);
  }

  // Loc dong live tuong ung voi menh de WHERE cua bang chot (2 dang duy nhat ben duoi).
  function matches(r, where, params) {
    if (where.startsWith('branch')) return r.branch === params[0] && r.customer_code === params[1];
    return r.product_code === params[0];
  }

  async function customerProducts({ branch, customerCode, months }) {
    const rows = await linesFor(months, 'branch = $2 AND customer_code = $3', [branch, customerCode], r => r.product_code);
    return rows.map(r => ({ productCode: r.product_code, productName: r.product_name, revenue: r.revenue, qty: r.qty }));
  }

  async function productCustomers({ productCode, months }) {
    const rows = await linesFor(months, 'product_code = $2', [productCode], r => `${r.branch}:${r.customer_code}`);
    return rows.map(r => ({ branch: r.branch, customerCode: r.customer_code, revenue: r.revenue, qty: r.qty }));
  }

  async function refreeze(monthParam) {
    if (!/^\d{4}-\d{2}$/.test(String(monthParam || ''))) {
      const e = new Error('Tháng không hợp lệ (định dạng YYYY-MM).'); e.statusCode = 400; throw e;
    }
    const month = `${monthParam}-01`;
    const current = monthKey(vnToday(now()));
    if (month < FIRST_MONTH || month >= current) {
      const e = new Error('Chỉ tính lại được tháng đã qua, từ T3/2026.'); e.statusCode = 400; throw e;
    }
    const result = await freeze(pool, month, { log: console.log });
    await rebuildSale(pool);
    cache = null; liveCache.clear();
    return result;
  }

  return { snapshot, customerProducts, productCustomers, refreeze };
}

module.exports = { createRepository };
