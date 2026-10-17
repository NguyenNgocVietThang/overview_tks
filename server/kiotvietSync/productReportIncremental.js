'use strict';

// Lam moi TANG DAN "Bao cao hang hoa" (product_report + product_report_customers) sau moi luot sync fast,
// thay cho viec TRUNCATE + nap lai 1 lan/dem cua productReportRefresh.js. Ke hoach va so do do:
// docs/superpowers/specs/2026-10-16-realtime-customer-product-reports-design.md muc 3.B.
//
// Vi sao khong chay nguyen khoi moi 7 phut: do tren DB that 2026-10-16, toan bo SELECT mat 4,2-4,5s va
// 13-15K block doc dia (~22GB doc/ngay neu chay moi 7 phut), va TRUNCATE khoa ACCESS EXCLUSIVE chan doc.
// O day: (1) phan re (ton, don phieu tam, doanh so tu rollup daily_product_sales) tinh lai MOI luot;
// (2) phan nang "khach lon nhat / so khach / chi tiet khach" (quet 90 ngay hoa don, ~2,7s CPU, gan nhu
// khong doc dia) CHI tinh khi co hoa don/phieu tra/khach moi dong bo hoac sang ngay VN moi, con lai lay
// lai tu product_report_customers; (3) moi ket qua nap vao BANG TAM roi CHI GHI DONG THAT SU DOI (mau
// LEFT JOIN/IS DISTINCT FROM tu su co IO 2026-09-28), nen luot nhan roi ghi ~0 dong.
//
// SQL duoc CAT TU REFRESH_SQL cua productReportRefresh.js (cung dinh nghia, khong sao chep): chi doi
// (a) cua so gom HOM NAY, (b) khach lon nhat doc tu bang tam kieu NUMERIC de luot nang va luot nhe cho
// cung mot bieu dien (khong "nhap nhay" ghi lai), (c) xep hang hoa them customer_key de on dinh khi
// bang doanh so, (d) chi giu ma dang kinh doanh o it nhat 1 co so (bo loc truoc day nam o luc doc).
// 4 cot theo co so (co ban HN/SG, mo ta HN/SG - migration 0057) do chinh REFRESH_SQL cung cap nen mo ta sua tren
// KiotViet cung cap nhat sau moi luot nay.

const CONFIG = require('../config');
const { __sql__: legacy } = require('./productReportRefresh');
const { vnDateKey } = require('./vnTime');

const BRANCH_CODES = Object.freeze(['hanoi', 'saigon']);
const ADVISORY_LOCK_SQL = 'SELECT pg_advisory_xact_lock(20531055)';
// Chi dung de quyet dinh co chay phan nang khong: synced_at la dong ho DB cua chinh luot sync nen chi can
// chong ngan de bu giao dich sync commit tre.
const GATE_OVERLAP_MS = 15 * 60 * 1000;
const WORK_MEM = '32MB';

const R = legacy.REFRESH_SQL;
function cut(startMarker, endMarker) {
  const from = R.indexOf(startMarker);
  const to = R.indexOf(endMarker, from + 1);
  if (from < 0 || to <= from) throw new Error('productReportIncremental: khong cat duoc doan SQL ' + startMarker);
  return R.slice(from, to).trim().replace(/,$/, '');
}
function swap(sql, from, to, times) {
  const parts = sql.split(from);
  if (parts.length - 1 !== times) throw new Error('productReportIncremental: doan SQL doi cua so khong khop: ' + from);
  return parts.join(to);
}

const VN_TODAY = cut('vn_today AS (', '  hn_products AS (');
const HN_PRODUCTS = cut('hn_products AS (', '  sg_products AS (');
const SG_PRODUCTS = cut('sg_products AS (', '  pending_orders AS (');
const PENDING_ORDERS = cut('pending_orders AS (', '  sales_30d AS (');

// Cua so: legacy ket thuc HOM QUA (30 ngay = today-30..today-1, 90 ngay = today-90..today-1). Tang dan gom
// HOM NAY va giu nguyen do dai: 30 ngay = today-29..today, 90 ngay = today-89..today.
function windowed({ includeToday }) {
  const sales30 = cut('sales_30d AS (', '  sales_90d AS (');
  const sales90 = cut('sales_90d AS (', '  -- Doanh so rong cua khach');
  const lines = cut('sales90_lines AS (', '  -- MATERIALIZED:');
  if (!includeToday) return { sales30, sales90, lines };
  return {
    sales30: swap(sales30, 'dps.sale_date >= vn_today.today - 30 AND dps.sale_date <= vn_today.today - 1',
      'dps.sale_date >= vn_today.today - 29 AND dps.sale_date <= vn_today.today', 1),
    sales90: swap(sales90, 'dps.sale_date >= vn_today.today - 90 AND dps.sale_date <= vn_today.today - 1',
      'dps.sale_date >= vn_today.today - 89 AND dps.sale_date <= vn_today.today', 1),
    lines: swap(swap(lines, '(vn_today.today - 90)::timestamp', '(vn_today.today - 89)::timestamp', 2),
      "(vn_today.today::timestamp AT TIME ZONE 'UTC')", "((vn_today.today + 1)::timestamp AT TIME ZONE 'UTC')", 2)
  };
}

// Thu tu PHAI khop dung danh sach SELECT cua fillProducts ben duoi (INSERT theo vi tri).
const PRODUCT_COLUMNS = [
  'product_code', 'product_name', 'stock_hanoi', 'stock_saigon', 'available_to_sell', 'qty_sold_30d',
  'revenue_90d', 'customer_count_90d', 'top_customer_revenue_90d', 'top_customer_name', 'top_customer_share',
  'available_hanoi', 'available_saigon', 'description_hanoi', 'description_saigon',
  'price_hanoi', 'price_saigon'
];

const CREATE_STAGE_SQL = [
  'CREATE TEMP TABLE pr_new (LIKE product_report) ON COMMIT DROP',
  'CREATE TEMP TABLE pr_customers_new (LIKE product_report_customers) ON COMMIT DROP'
];

function buildSql({ includeToday = true } = {}) {
  const w = windowed({ includeToday });

  // Phan NANG: doanh so tung khach theo ma hang (customer_agg cu), nap san vao bang tam NUMERIC.
  const fillCustomers = `INSERT INTO pr_customers_new (product_key, customer_key, customer_name, revenue)
  WITH ${VN_TODAY},
  ${w.lines}
  SELECT product_key, customer_key, MIN(customer_name), SUM(amount)
  FROM sales90_lines
  WHERE product_key <> ''
  GROUP BY product_key, customer_key
  HAVING SUM(amount) > 0`;

  // Phan RE: moi luot. customersRel = bang tam (luot nang) hoac bang that (luot nhe, khong co thay doi nao
  // cua hoa don/phieu tra nen khach lon nhat khong doi).
  const fillProducts = (customersRel) => `INSERT INTO pr_new (${PRODUCT_COLUMNS.join(', ')}, computed_at)
  WITH ${VN_TODAY},
  ${HN_PRODUCTS},
  ${SG_PRODUCTS},
  ${PENDING_ORDERS},
  ${w.sales30},
  ${w.sales90},
  customer_ranked AS (
    SELECT
      product_key, customer_name, revenue,
      ROW_NUMBER() OVER (PARTITION BY product_key ORDER BY revenue DESC, customer_key) AS rn,
      COUNT(*) OVER (PARTITION BY product_key) AS customer_count
    FROM ${customersRel}
  ),
  customer_top AS (
    SELECT product_key, customer_name AS top_customer_name, revenue AS top_customer_revenue, customer_count
    FROM customer_ranked
    WHERE rn = 1
  )
  SELECT
    hn.code,
    hn.name,
    hn.on_hand,
    COALESCE(sg.on_hand, 0),
    hn.on_hand + COALESCE(sg.on_hand, 0) - COALESCE(po.qty, 0),
    COALESCE(s30.qty, 0),
    COALESCE(s90.revenue, 0),
    COALESCE(ct.customer_count, 0),
    COALESCE(ct.top_customer_revenue, 0),
    ct.top_customer_name,
    CASE WHEN COALESCE(s90.revenue, 0) > 0 THEN LEAST(1, COALESCE(ct.top_customer_revenue, 0) / s90.revenue) ELSE NULL END,
    hn.on_hand - COALESCE(po.qty_hanoi, 0),
    COALESCE(sg.on_hand, 0) - COALESCE(po.qty_saigon, 0),
    hn.description,
    sg.description,
    hn.price,
    sg.price,
    now()
  FROM hn_products hn
  LEFT JOIN sg_products sg ON sg.code = hn.code
  LEFT JOIN pending_orders po ON po.product_key = lower(btrim(hn.code))
  LEFT JOIN sales_30d s30 ON s30.product_code = hn.code
  LEFT JOIN sales_90d s90 ON s90.product_code = hn.code
  LEFT JOIN customer_top ct ON ct.product_key = lower(btrim(hn.code))
  WHERE EXISTS (
    SELECT 1 FROM products p
    WHERE p.code = hn.code AND p.branch IN ('hanoi', 'saigon') AND p.is_active IS NOT FALSE
  )`;

  return { fillCustomers, fillProductsHeavy: fillProducts('pr_customers_new'), fillProductsLight: fillProducts('product_report_customers') };
}

const SQL = buildSql({ includeToday: true });

// ---- Ghi khac biet ----
const SET_LIST = PRODUCT_COLUMNS.filter(c => c !== 'product_code').map(c => `${c} = n.${c}`).join(', ');
const PRODUCT_TUPLE = PRODUCT_COLUMNS.filter(c => c !== 'product_code');
const DELETE_PRODUCTS_SQL = `DELETE FROM product_report p
  WHERE NOT EXISTS (SELECT 1 FROM pr_new n WHERE n.product_code = p.product_code)`;
const UPDATE_PRODUCTS_SQL = `UPDATE product_report p SET ${SET_LIST}, computed_at = now()
  FROM pr_new n
  WHERE p.product_code = n.product_code
    AND (${PRODUCT_TUPLE.map(c => 'p.' + c).join(', ')}) IS DISTINCT FROM (${PRODUCT_TUPLE.map(c => 'n.' + c).join(', ')})`;
const INSERT_PRODUCTS_SQL = `INSERT INTO product_report (${PRODUCT_COLUMNS.join(', ')}, computed_at)
  SELECT ${PRODUCT_COLUMNS.map(c => 'n.' + c).join(', ')}, now() FROM pr_new n
  WHERE NOT EXISTS (SELECT 1 FROM product_report p WHERE p.product_code = n.product_code)`;

const DELETE_CUSTOMERS_SQL = `DELETE FROM product_report_customers p
  WHERE NOT EXISTS (SELECT 1 FROM pr_customers_new n WHERE n.product_key = p.product_key AND n.customer_key = p.customer_key)`;
const UPDATE_CUSTOMERS_SQL = `UPDATE product_report_customers p SET customer_name = n.customer_name, revenue = n.revenue
  FROM pr_customers_new n
  WHERE p.product_key = n.product_key AND p.customer_key = n.customer_key
    AND (p.customer_name, p.revenue) IS DISTINCT FROM (n.customer_name, n.revenue)`;
const INSERT_CUSTOMERS_SQL = `INSERT INTO product_report_customers (product_key, customer_key, customer_name, revenue)
  SELECT n.product_key, n.customer_key, n.customer_name, n.revenue FROM pr_customers_new n
  WHERE NOT EXISTS (SELECT 1 FROM product_report_customers p WHERE p.product_key = n.product_key AND p.customer_key = n.customer_key)`;

const READ_STATE_SQL = 'SELECT computed_at, last_full_at, version FROM product_report_state WHERE id = 1';
// $1 co so, $2 moc synced_at: co chung tu/khach nao vua dong bo? (chi doc duoi index 0054/0055)
const GATE_SQL = `SELECT
    EXISTS (SELECT 1 FROM invoices  WHERE branch = ANY($1::text[]) AND synced_at >= $2::timestamptz) AS invoices_changed,
    EXISTS (SELECT 1 FROM returns   WHERE branch = ANY($1::text[]) AND synced_at >= $2::timestamptz) AS returns_changed,
    EXISTS (SELECT 1 FROM customers WHERE branch = ANY($1::text[]) AND synced_at >= $2::timestamptz) AS customers_changed`;
// $1 co thay doi that su (version +1), $2 vua chay phan nang (danh dau last_full_at).
const UPSERT_STATE_SQL = `INSERT INTO product_report_state (id, computed_at, version, last_full_at)
  VALUES (1, now(), 1, CASE WHEN $2::boolean THEN now() END)
  ON CONFLICT (id) DO UPDATE SET
    computed_at = now(),
    version = product_report_state.version + CASE WHEN $1::boolean THEN 1 ELSE 0 END,
    last_full_at = CASE WHEN $2::boolean THEN now() ELSE product_report_state.last_full_at END
  RETURNING version, computed_at`;

function decideHeavy(state, gate, now) {
  if (!state || !state.last_full_at) return { heavy: true, reason: 'chua-co-moc' };
  if (vnDateKey(new Date(state.last_full_at)) !== vnDateKey(now)) return { heavy: true, reason: 'sang-ngay-moi' };
  if (gate && (gate.invoices_changed || gate.returns_changed || gate.customers_changed)) return { heavy: true, reason: 'co-chung-tu-moi' };
  return { heavy: false, reason: 'khong-doi' };
}

const MISSING = new Set(['42703', '42P01']);

/**
 * Mot luot lam moi tang dan. Chua chay migration 0055 (thieu bang state/cot) => {skipped:'migration-missing'}
 * va giu luong chot dem cu. Moi thay doi nam trong 1 giao dich (loi => ROLLBACK, bang cu nguyen ven).
 */
async function refreshProductReportIncremental(pool, {
  log = console.log, now = () => new Date(), enabled = CONFIG.REPORTS_INCREMENTAL_ENABLED
} = {}) {
  if (!enabled) return { skipped: 'disabled' };
  const current = now();
  let state;
  let gate = null;
  try {
    ({ rows: [state] } = await pool.query(READ_STATE_SQL));
    if (state && state.last_full_at) {
      const since = new Date(new Date(state.computed_at).getTime() - GATE_OVERLAP_MS).toISOString();
      ({ rows: [gate] } = await pool.query(GATE_SQL, [BRANCH_CODES, since]));
    }
  } catch (error) {
    if (MISSING.has(error.code)) return { skipped: 'migration-missing' };
    throw error;
  }
  const { heavy, reason } = decideHeavy(state, gate, current);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(ADVISORY_LOCK_SQL);
    await client.query(`SET LOCAL work_mem = '${WORK_MEM}'`);
    await client.query("SET LOCAL statement_timeout = '60s'");
    for (const statement of CREATE_STAGE_SQL) await client.query(statement);
    if (heavy) await client.query(SQL.fillCustomers, [BRANCH_CODES]);
    await client.query(heavy ? SQL.fillProductsHeavy : SQL.fillProductsLight, [BRANCH_CODES]);
    const customers = { deleted: 0, updated: 0, inserted: 0 };
    if (heavy) {
      customers.deleted = (await client.query(DELETE_CUSTOMERS_SQL)).rowCount || 0;
      customers.updated = (await client.query(UPDATE_CUSTOMERS_SQL)).rowCount || 0;
      customers.inserted = (await client.query(INSERT_CUSTOMERS_SQL)).rowCount || 0;
    }
    const products = {
      deleted: (await client.query(DELETE_PRODUCTS_SQL)).rowCount || 0,
      updated: (await client.query(UPDATE_PRODUCTS_SQL)).rowCount || 0,
      inserted: (await client.query(INSERT_PRODUCTS_SQL)).rowCount || 0
    };
    const changed = [customers, products].some(t => t.deleted + t.updated + t.inserted > 0);
    const saved = await client.query(UPSERT_STATE_SQL, [changed, heavy]);
    await client.query('COMMIT');
    const result = {
      skipped: false, mode: heavy ? 'heavy' : 'light', reason, changed, products, customers,
      version: saved.rows && saved.rows[0] ? Number(saved.rows[0].version) : null
    };
    log(`[productReportIncremental] ${result.mode} (${reason}): san pham +${products.inserted} ~${products.updated} -${products.deleted}`
      + (heavy ? `, khach +${customers.inserted} ~${customers.updated} -${customers.deleted}` : '')
      + `, version ${result.version}.`);
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  refreshProductReportIncremental,
  buildSql,
  __sql__: {
    ...SQL, CREATE_STAGE_SQL, DELETE_PRODUCTS_SQL, UPDATE_PRODUCTS_SQL, INSERT_PRODUCTS_SQL,
    DELETE_CUSTOMERS_SQL, UPDATE_CUSTOMERS_SQL, INSERT_CUSTOMERS_SQL, READ_STATE_SQL, GATE_SQL, UPSERT_STATE_SQL, ADVISORY_LOCK_SQL
  },
  __test__: { decideHeavy }
};
