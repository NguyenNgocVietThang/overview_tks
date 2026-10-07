'use strict';

// Chot cung doanh so theo thang cho Bao cao kinh doanh (migration 0036). Goi moi 5 phut
// (nhu productReportRefresh.js): hau het cac lan chi la 1 SELECT state + dung lai bang
// sale khi hash nhom doi (chi ghi dong doi). Thang vua qua duoc chot khi gio VN >= 00:10 ngay mung 1 (cho
// hoa don cuoi ngay kip sync 7 phut/lan). Lan dau sau deploy: backfill moi thang tu
// FIRST_MONTH. Nut "Tinh lai thang" goi freezeMonth truc tiep.
//
// IO: moi thang chi chot 1 lan (DELETE + INSERT theo thang trong 1 giao dich), khong
// TRUNCATE; bang sale ghi dong doi, loc o SELECT (xem REBUILD_SALE_SQL).

if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* dotenv tuy chon */ }
}

const { getPool } = require('../db/pool');
const { vnMinutesOfDay } = require('./vnTime');
const sql = require('../businessReport/businessMonthlySql');
const { FIRST_MONTH, monthKey, addMonths, monthsBetween, vnToday, dayOfMonth, parseClosedMonth } = require('../businessReport/businessMonths');

const SETTLE_MINUTES_AFTER_MIDNIGHT = 10;
const REFRESH_WORK_MEM = '32MB';

async function freezeMonth(pool, month, { log = console.log } = {}) {
  const params = [sql.BRANCH_CODES, month, addMonths(month, 1)];
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query('LOCK TABLE business_monthly_state, business_monthly_customer_sales IN SHARE ROW EXCLUSIVE MODE');
    await client.query(`SET LOCAL work_mem = '${REFRESH_WORK_MEM}'`);
    await client.query('DELETE FROM business_monthly_customer_sales WHERE month = $1', [month]);
    await client.query('DELETE FROM business_monthly_customer_product_sales WHERE month = $1', [month]);
    await client.query('DELETE FROM business_monthly_product_sales WHERE month = $1', [month]);
    await client.query(sql.FREEZE_CUSTOMER_SQL, params);
    await client.query(sql.FREEZE_CUSTOMER_PRODUCT_SQL, params);
    await client.query(sql.FREEZE_PRODUCT_SQL, [month]);
    const { rows } = await client.query(`
      SELECT COUNT(*)::int AS customer_rows,
             (SELECT COUNT(*)::int FROM business_monthly_customer_product_sales WHERE month = $1) AS customer_product_rows,
             COALESCE(SUM(net_revenue), 0) AS net_revenue
      FROM business_monthly_customer_sales WHERE month = $1`, [month]);
    const stats = rows[0];
    await client.query(`
      INSERT INTO business_monthly_state (month, frozen_at, customer_rows, customer_product_rows, net_revenue)
      VALUES ($1, now(), $2, $3, $4)
      ON CONFLICT (month) DO UPDATE SET frozen_at = now(), customer_rows = EXCLUDED.customer_rows,
        customer_product_rows = EXCLUDED.customer_product_rows, net_revenue = EXCLUDED.net_revenue, group_hash = NULL`,
    [month, stats.customer_rows, stats.customer_product_rows, stats.net_revenue]);
    // Cong bo Sale va hash cung snapshot nguon da chot, truoc COMMIT.
    const { rows: hashes } = await client.query(sql.GROUP_HASH_SQL);
    await client.query(sql.REBUILD_SALE_SQL);
    await client.query('UPDATE business_monthly_state SET group_hash = $1 WHERE group_hash IS DISTINCT FROM $1', [hashes[0].group_hash]);
    await client.query('COMMIT');
    const result = { month, customerRows: stats.customer_rows, customerProductRows: stats.customer_product_rows, netRevenue: Number(stats.net_revenue) };
    log(`[businessMonthlyRefresh] Da chot thang ${month}: ${result.customerRows} khach, ${result.customerProductRows} dong khach x ma.`);
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function rebuildSaleTable(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    // Cung thu tu khoa voi freeze: khong the ghi hash cho bo so lieu dang thay doi.
    await client.query('LOCK TABLE business_monthly_state, business_monthly_customer_sales IN SHARE ROW EXCLUSIVE MODE');
    const { rows: states } = await client.query('SELECT group_hash FROM business_monthly_state');
    if (!states.length) {
      await client.query('COMMIT');
      return { upserted: 0, deleted: 0 };
    }
    const { rows: hashes } = await client.query(sql.GROUP_HASH_SQL);
    const hash = hashes[0].group_hash;
    if (states.every(state => state.group_hash === hash)) {
      await client.query('COMMIT');
      return { upserted: 0, deleted: 0 };
    }
    const { rows } = await client.query(sql.REBUILD_SALE_SQL);
    await client.query('UPDATE business_monthly_state SET group_hash = $1 WHERE group_hash IS DISTINCT FROM $1', [hash]);
    await client.query('COMMIT');
    return rows[0] || { upserted: 0, deleted: 0 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Cac thang can chot: tu FIRST_MONTH den thang vua qua, tru thang da co state. Thang vua
// qua chi duoc chot khi da qua 00:10 ngay mung 1 (gio VN).
function monthsDue(frozen, now) {
  const today = vnToday(now);
  const current = monthKey(today);
  let lastClosed = addMonths(current, -1);
  if (dayOfMonth(today) === 1 && vnMinutesOfDay(now) < SETTLE_MINUTES_AFTER_MIDNIGHT) lastClosed = addMonths(lastClosed, -1);
  const done = new Set(frozen);
  return monthsBetween(FIRST_MONTH, lastClosed).filter(m => !done.has(m));
}

async function refreshBusinessMonthlyIfDue(pool, { log = console.log, now = () => new Date() } = {}) {
  const { rows } = await pool.query(`SELECT to_char(month, 'YYYY-MM-DD') AS month FROM business_monthly_state`);
  const due = monthsDue(rows.map(r => r.month), now());
  for (const month of due) await freezeMonth(pool, month, { log });
  const sale = await rebuildSaleTable(pool);
  return { frozen: due, sale };
}

function startBusinessMonthlySchedule(pool, {
  intervalMs = 5 * 60 * 1000, setIntervalFn = setInterval, scheduleImmediate = queueMicrotask, log = console.log
} = {}) {
  const run = label => refreshBusinessMonthlyIfDue(pool, { log }).catch(error => {
    log(`[businessMonthlyRefresh] Loi ${label}: ${error.message}`);
  });
  scheduleImmediate(() => run('khi chay lan dau'));
  return setIntervalFn(() => run('khi kiem tra/chot thang'), intervalMs);
}

// Chay tay: `node kiotvietSync/businessMonthlyRefresh.js [YYYY-MM]`. Thang truyen vao phai
// hop le nhu nut "Tinh lai thang" (parseClosedMonth); sai thi bao loi, tra ma 2 va KHONG
// mo ket noi DB. Tra ma thoat (0 = xong).
async function main(argv = process.argv.slice(2), {
  now = () => new Date(), getPoolFn = getPool, log = console.log, logError = console.error
} = {}) {
  const arg = argv[0];
  let month = null;
  if (arg !== undefined) {
    try {
      month = parseClosedMonth(arg, now());
    } catch (error) {
      logError(`[businessMonthlyRefresh] Tham số tháng "${arg}" sai: ${error.message} Không ghi gì.`);
      return 2;
    }
  }
  const pool = getPoolFn();
  try {
    if (month) {
      await freezeMonth(pool, month, { log });
      log(await rebuildSaleTable(pool));
    } else {
      log(await refreshBusinessMonthlyIfDue(pool, { log, now }));
    }
  } finally {
    await pool.end();
  }
  return 0;
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; }, error => { console.error(error); process.exitCode = 1; });
}

module.exports = { freezeMonth, rebuildSaleTable, refreshBusinessMonthlyIfDue, startBusinessMonthlySchedule, monthsDue, main };
