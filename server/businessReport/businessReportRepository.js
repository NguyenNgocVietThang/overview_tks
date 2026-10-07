'use strict';

// Nguon du lieu Bao cao kinh doanh. Thang DA CHOT (co dong business_monthly_state) doc
// tu bang 0036; thang CHUA chot (thang hien tai, hoac thang vua qua khi job chua kip chot /
// chua backfill) tinh truc tiep bang CUNG cau SQL cua job. Ket qua cache ttlMs (mac dinh
// 60s) theo kieu STALE-WHILE-REVALIDATE (nhu kiotOrdersRepository): het ttl thi tra NGAY ban
// cu va lam moi o nen (single-flight, loi thi giu ban cu + ghi log); chi lan tai dau tien (chua
// co ban nao) moi phai cho vi tinh live 1 thang mat ~1-2s. Cac thang live duoc tai TUAN TU
// (tranh don IO len Supabase). refreeze() xoa cache; tai nen bat dau truoc do khong duoc ghi de.
// Luon gop HN + SG.

const { getPool } = require('../db/pool');
const sql = require('./businessMonthlySql');
const { FIRST_MONTH, UNGROUPED_SALE, monthKey, addMonths, monthsBetween, vnToday, dayOfMonth } = require('./businessMonths');
const { freezeMonth, rebuildSaleTable } = require('../kiotvietSync/businessMonthlyRefresh');

const num = v => Number(v) || 0;

// Cache 1 gia tri bat dong bo theo kieu stale-while-revalidate.
//   get()            : con han -> ban cu; het han -> tra ngay ban cu + lam moi nen; chua co -> cho tai.
//   get({ wait:true }): nhu get() nhung het han thi CHO ban moi (dung khi chinh no la tai nen cua cache khac,
//                      de ban moi that su moi chu khong mang them ban cu).
//   clear()          : bo ban + tai dang do; tai bat dau truoc clear() khong duoc ghi vao cache nua.
function createSwrCache({ load, now, ttlMs, label }) {
  let entry = null;    // { at, value }
  let inflight = null; // Promise dang tai (dung chung, tranh dam dong)
  let generation = 0;

  function reload() {
    if (inflight) return inflight;
    const myGeneration = generation;
    const promise = Promise.resolve().then(load).then(value => {
      if (myGeneration === generation) entry = { at: now().getTime(), value };
      return value;
    });
    const tracked = promise.finally(() => { if (inflight === tracked) inflight = null; });
    inflight = tracked;
    return tracked;
  }

  function get({ wait = false } = {}) {
    if (entry && now().getTime() - entry.at < ttlMs) return Promise.resolve(entry.value);
    if (!entry || wait) return reload();
    reload().catch(error => console.error(`[business-report] lam moi nen ${label} that bai, giu ban cu:`, error));
    return Promise.resolve(entry.value);
  }

  function clear() {
    generation += 1;
    entry = null;
    inflight = null;
  }

  return { get, clear };
}

function createRepository({
  pool = getPool(), now = () => new Date(), ttlMs = 60 * 1000,
  freeze = freezeMonth, rebuildSale = rebuildSaleTable
} = {}) {
  const liveCaches = new Map(); // month -> cache SWR cua {customers, customerProducts}

  function live(month, options) {
    let cache = liveCaches.get(month);
    if (!cache) {
      const params = [sql.BRANCH_CODES, month, addMonths(month, 1)];
      cache = createSwrCache({
        now, ttlMs, label: `thang ${month}`,
        load: () => Promise.all([
          pool.query(sql.CUSTOMER_MONTH_SELECT_SQL, params),
          pool.query(sql.CUSTOMER_PRODUCT_MONTH_SELECT_SQL, params)
        ]).then(([c, cp]) => ({ customers: c.rows, customerProducts: cp.rows }))
      });
      liveCaches.set(month, cache);
    }
    return cache.get(options);
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
      // Tai nen cua snapshot: cho ban live MOI (wait) de snapshot moi khong mang ban live cu.
      const data = await live(month, { wait: true });
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

  const snapshotCache = createSwrCache({ load, now, ttlMs, label: 'snapshot' });
  const snapshot = () => snapshotCache.get();

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
    snapshotCache.clear();
    for (const cache of liveCaches.values()) cache.clear();
    liveCaches.clear();
    return result;
  }

  return { snapshot, customerProducts, productCustomers, refreeze };
}

module.exports = { createRepository };
