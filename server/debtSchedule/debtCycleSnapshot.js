'use strict';

// Ban chot CONG NO luc 15:00 gio VN moi ngay (migration 0047). Moi ngay dung 1 lan:
//  - debt_cycle_runs(cycle_date)          : moc chu ky; phan hoi/trang thai gan voi no.
//  - debt_cycle_customers                 : no hien tai (customers.debt) cua khach dang no,
//                                           no dau ky (= no hien tai cua ban chot truoc),
//                                           doanh so TB 4 thang (Bao cao kinh doanh).
//  - debt_cycle_amounts                   : tong hoa don / tra hang THEO NGAY trong 90 ngay
//                                           toi 15:00 — no trong lich tinh luc doc theo lich
//                                           TT hien tai (doi lich la thay so ngay).
// Don du lieu cu hon 7 ngay ngay trong lan chot.
//
// Theo mau inventoryValueSnapshot.js: kiem tra moi phut, tu biet da den han chua. Server
// tat qua 15:00 roi bat lai trong NGAY thi van chot (so tien hoa don van cat o 15:00); qua
// ngay hom sau thi bo (chu ky cu giu nguyen toi 15:00 hom do).
//
// Cot thoi gian hoa don/tra hang luu GIO VN gan nhan UTC (xem dashboardRollupRefresh.js),
// nen moc 15:00 VN viet la ($1::date + time '15:00') AT TIME ZONE 'UTC'.

if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* dotenv tuy chon */ }
}

const { getPool } = require('../db/pool');
const { vnDateKey, vnMinutesOfDay } = require('../kiotvietSync/vnTime');
const { SNAPSHOT_MINUTE_OF_DAY, MAX_SCHEDULE_DAYS } = require('./debtScheduleRules');

const BRANCH_CODES = Object.freeze(['hanoi', 'saigon']);
const RETENTION_DAYS = 7;

const LAST_RUN_SQL = 'SELECT MAX(cycle_date)::text AS last_date FROM debt_cycle_runs';

const INSERT_RUN_SQL = `INSERT INTO debt_cycle_runs (cycle_date, taken_at) VALUES ($1::date, now())
  ON CONFLICT (cycle_date) DO NOTHING RETURNING cycle_date`;

// $1 cycle_date, $2 co so, $3/$4/$5 = mang co so / ma KH / TB 4 thang (Bao cao kinh doanh).
const INSERT_CUSTOMERS_SQL = `
  WITH prev_run AS (
    SELECT MAX(cycle_date) AS cycle_date FROM debt_cycle_runs WHERE cycle_date < $1::date
  ), avg4 AS (
    SELECT * FROM unnest($3::text[], $4::text[], $5::numeric[]) AS a(branch, code, avg_revenue)
  )
  INSERT INTO debt_cycle_customers (cycle_date, branch, customer_id, current_debt, opening_debt, avg_revenue_4m)
  SELECT $1::date, c.branch, c.id, c.debt,
         CASE WHEN pr.cycle_date IS NULL THEN NULL ELSE COALESCE(p.current_debt, 0) END,
         a.avg_revenue
  FROM customers c
  CROSS JOIN prev_run pr
  LEFT JOIN debt_cycle_customers p
    ON p.cycle_date = pr.cycle_date AND p.branch = c.branch AND p.customer_id = c.id
  LEFT JOIN avg4 a ON a.branch = c.branch AND a.code = btrim(c.code)
  WHERE c.branch = ANY($2::text[]) AND c.debt > 0`;

// Hoa don chua huy + phieu tra "Da tra" cua khach vua chot, gom theo ngay VN, 90 ngay toi 15:00.
const INSERT_AMOUNTS_SQL = `
  WITH bounds AS (
    SELECT (($1::date - ${MAX_SCHEDULE_DAYS - 1})::timestamp AT TIME ZONE 'UTC') AS from_at,
           (($1::date + time '15:00') AT TIME ZONE 'UTC') AS to_at
  ), docs AS (
    SELECT i.branch, i.customer_id, (i.purchase_date AT TIME ZONE 'UTC')::date AS day,
           COALESCE(i.total, 0)::numeric AS invoice_amount, 0::numeric AS return_amount
    FROM invoices i, bounds b
    WHERE i.branch = ANY($2::text[]) AND i.customer_id IS NOT NULL
      AND i.purchase_date >= b.from_at AND i.purchase_date < b.to_at
      AND COALESCE(i.raw->>'statusValue', '') <> 'Đã hủy'
    UNION ALL
    SELECT r.branch, r.customer_id, (r.return_date AT TIME ZONE 'UTC')::date,
           0::numeric, abs(COALESCE(r.total, 0))::numeric
    FROM returns r, bounds b
    WHERE r.branch = ANY($2::text[]) AND r.customer_id IS NOT NULL
      AND r.return_date >= b.from_at AND r.return_date < b.to_at
      AND r.raw->>'statusValue' = 'Đã trả'
  )
  INSERT INTO debt_cycle_amounts (cycle_date, branch, customer_id, day, invoice_amount, return_amount)
  SELECT $1::date, d.branch, d.customer_id, d.day, SUM(d.invoice_amount), SUM(d.return_amount)
  FROM docs d
  JOIN debt_cycle_customers dc ON dc.cycle_date = $1::date AND dc.branch = d.branch AND dc.customer_id = d.customer_id
  GROUP BY d.branch, d.customer_id, d.day`;

const UPDATE_RUN_COUNT_SQL = `UPDATE debt_cycle_runs SET customer_count =
  (SELECT COUNT(*) FROM debt_cycle_customers WHERE cycle_date = $1::date) WHERE cycle_date = $1::date`;

const CLEANUP_SQL = [
  `DELETE FROM debt_cycle_runs WHERE cycle_date < $1::date - ${RETENTION_DAYS}`,
  `DELETE FROM debt_cycle_feedback WHERE cycle_date < $1::date - ${RETENTION_DAYS}`,
  `DELETE FROM debt_feedback_history WHERE cycle_date < $1::date - ${RETENTION_DAYS}`
];

/** Ngay VN can chot ngay bay gio, hoac null. Chi chot cho HOM NAY, tu 15:00. */
function cycleDateDue(lastDate, now) {
  const today = vnDateKey(now);
  if (lastDate && lastDate >= today) return null;
  return vnMinutesOfDay(now) >= SNAPSHOT_MINUTE_OF_DAY ? today : null;
}

/**
 * Doanh so TB 4 thang theo (co so, ma KH) — CUNG con so cot "TB 4 tháng" cua Bao cao kinh
 * doanh truoc khi gop theo ten (customerRecords). Loi thi tra mang rong (cot DS de trong).
 */
async function loadAverageRevenue(pool, { log = console.log, createBusinessRepository } = {}) {
  try {
    const create = createBusinessRepository || require('../businessReport/businessReportRepository').createRepository;
    const { customerRecords } = require('../businessReport/businessReportService');
    const snap = await create({ pool }).snapshot();
    const records = customerRecords(snap).filter(record => record.code);
    return {
      branches: records.map(record => record.branch),
      codes: records.map(record => record.code),
      values: records.map(record => record.avg4)
    };
  } catch (error) {
    log(`[debtCycleSnapshot] Khong doc duoc doanh so TB 4 thang: ${error.message}`);
    return { branches: [], codes: [], values: [] };
  }
}

/** Chot cho cycleDate ('YYYY-MM-DD'). Da co ban chot ngay do thi khong lam gi. */
async function takeDebtCycleSnapshot(pool, cycleDate, { log = console.log, loadAverages = loadAverageRevenue } = {}) {
  const averages = await loadAverages(pool, { log });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(INSERT_RUN_SQL, [cycleDate]);
    if (!inserted.rowCount) {
      await client.query('ROLLBACK');
      return { cycleDate, created: false, customers: 0 };
    }
    await client.query(INSERT_CUSTOMERS_SQL, [cycleDate, BRANCH_CODES, averages.branches, averages.codes, averages.values]);
    await client.query(INSERT_AMOUNTS_SQL, [cycleDate, BRANCH_CODES]);
    await client.query(UPDATE_RUN_COUNT_SQL, [cycleDate]);
    for (const sql of CLEANUP_SQL) await client.query(sql, [cycleDate]);
    const { rows } = await client.query('SELECT customer_count FROM debt_cycle_runs WHERE cycle_date = $1::date', [cycleDate]);
    await client.query('COMMIT');
    const customers = Number(rows[0] && rows[0].customer_count) || 0;
    log(`[debtCycleSnapshot] Chot cong no ${cycleDate}: ${customers} khach.`);
    return { cycleDate, created: true, customers };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function takeDebtCycleSnapshotIfDue(pool, {
  log = console.log, now = () => new Date(), beforeSnapshot, onSnapshot, loadAverages
} = {}) {
  const { rows } = await pool.query(LAST_RUN_SQL);
  const cycleDate = cycleDateDue(rows[0] && rows[0].last_date, now());
  if (!cycleDate) return { skipped: true };
  // Dong bo khach ngay truoc khi chot de "no hien tai" khop KiotViet luc 15:00.
  if (beforeSnapshot) {
    await beforeSnapshot().catch(error => log(`[debtCycleSnapshot] Dong bo khach truoc khi chot loi: ${error.message}`));
  }
  const result = await takeDebtCycleSnapshot(pool, cycleDate, { log, loadAverages });
  if (result.created && onSnapshot) onSnapshot(result);
  return { skipped: false, ...result };
}

function startDebtCycleSnapshotSchedule(pool, {
  intervalMs = 60 * 1000,
  setIntervalFn = setInterval,
  scheduleImmediate = queueMicrotask,
  log = console.log,
  beforeSnapshot,
  onSnapshot
} = {}) {
  let running = false;
  const run = (label) => {
    if (running) return;
    running = true;
    takeDebtCycleSnapshotIfDue(pool, { log, beforeSnapshot, onSnapshot })
      .catch(error => log(`[debtCycleSnapshot] Loi ${label}: ${error.message}`))
      .finally(() => { running = false; });
  };
  scheduleImmediate(() => run('khi kiem tra lan dau'));
  return setIntervalFn(() => run('khi chot'), intervalMs);
}

// Chay tay: chot cho ngay VN hien tai (bo qua neu da co) — dung ngay sau khi deploy.
async function main() {
  const result = await takeDebtCycleSnapshot(getPool(), vnDateKey(new Date()));
  console.log(`[debtCycleSnapshot] Hoan tat: ${result.created ? `${result.customers} khach` : 'da co ban chot hom nay'}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[debtCycleSnapshot] That bai: ${error.message}`);
    process.exitCode = 1;
  }).finally(() => getPool().end && getPool().end());
}

module.exports = {
  takeDebtCycleSnapshot,
  takeDebtCycleSnapshotIfDue,
  startDebtCycleSnapshotSchedule,
  loadAverageRevenue,
  __sql__: { LAST_RUN_SQL, INSERT_RUN_SQL, INSERT_CUSTOMERS_SQL, INSERT_AMOUNTS_SQL, CLEANUP_SQL },
  __test__: { cycleDateDue }
};
