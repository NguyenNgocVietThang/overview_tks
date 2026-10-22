'use strict';

// Tinh san doanh so THANG HIEN TAI cho Bao cao kinh doanh (migration 0068): khach va khach x ma
// hang cua thang dang chay nam trong business_current_month_* de web chi DOC bang thay vi chay
// cau SQL nang moi lan het cache (xem businessReport/businessReportRepository.js).
//
// SO LIEU = SO LIVE: chay lai DUNG cau SELECT cua job chot thang (businessMonthlySql.js,
// CUSTOMER_MONTH_SELECT_SQL + CUSTOMER_PRODUCT_MONTH_SELECT_SQL) voi cung tham so, chi doi
// bang dich => khong co cong thuc thu hai de lech. KHONG ghi vao business_monthly_* (dong
// trong business_monthly_state nghia la "da chot").
//
// IO (su co Disk IO Supabase 2026-09-28): ghi KHAC BIET - ket qua SELECT vao bang tam, LEFT JOIN
// bang dich + IS DISTINCT FROM o SELECT nen dong khong doi khong toi INSERT; luot nhan roi ghi ~0
// dong, `version` chi tang khi du lieu doi. Chot an toan: doc ra 0 dong thi khong xoa bang dang co.
//
// KHI NAO CHAY (goi tu scheduler.runFastGroupAndRollup sau moi luot sync fast, cung cho voi tuoi no):
//   - Luot NHANH: toi da 1 lan / minIntervalMs (mac dinh 10 phut). Truoc khi tinh, "do" xem co
//     hoa don/phieu tra/khach nao co synced_at moi tu lan tinh truoc (tru overlap) khong - KHONG
//     dung modified_date (91% hoa don co modified_date NULL, xem project-tokosi-realtime-reports).
//     Khong co gi moi thi chi cham computed_at (de repository biet bang con tuoi), khong tinh lai.
//   - Luot DAY DU (bo qua do + bo qua san thoi gian): chua co state, SANG THANG MOI, hoac moi
//     dem sau 00:10 VN (bat hoa don sua/huy muon, doi ten/ma khach, doi ten mat hang - nhung thu
//     khong di qua synced_at cua hoa don).
// Luot chay dong thoi gop lai (running/rerunRequested); khoa advisory chong 2 tien trinh.
//
// SANG THANG: dong cua thang cu KHONG bi xoa luc sang thang; chi xoa khi business_monthly_state da
// co dong thang do (nghia la freezeMonth da ghi xong) - truoc do repository van dung duoc chung
// qua live() cua thang vua qua.
//
// Chay tay: node kiotvietSync/businessCurrentMonthRefresh.js

if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* dotenv tuy chon */ }
}

const { getPool } = require('../db/pool');
const { vnDateKey, vnMinutesOfDay } = require('./vnTime');
const sql = require('../businessReport/businessMonthlySql');
const { monthKey, vnToday } = require('../businessReport/businessMonths');

const CUSTOMER_TABLE = 'business_current_month_customer_sales';
const PRODUCT_TABLE = 'business_current_month_customer_product_sales';
const STATE_TABLE = 'business_current_month_state';

const ADVISORY_LOCK_KEY = 20531068;
const REFRESH_WORK_MEM = '32MB';
const STATEMENT_TIMEOUT = '60s';
// Xem customerInvoiceLinesRefresh.js: khong tat merge join thi planner co the chon Merge Join + loc
// bieu thuc regexp cho tung chung tu (do that 2026-10-16: 41s thay vi 0,7s).
const PLANNER_GUARD_SQL = 'SET LOCAL enable_mergejoin = off';
const DEFAULT_MIN_INTERVAL_MS = 10 * 60 * 1000;
// Luot nhanh doc lai chung tu co synced_at tu (computed_at truoc - OVERLAP): bu tre dong bo KiotViet
// (7-10 phut) va lech dong ho giua may chu va DB.
const PROBE_OVERLAP_MS = 60 * 60 * 1000;
const FULL_SETTLE_MINUTES_AFTER_MIDNIGHT = 10;
const BRANCHES = sql.BRANCH_CODES;

// Dung lai NGUYEN VAN cau chot thang, chi doi bang dich sang bang tam: SELECT khong the lech.
function retarget(text, from, to) {
  const next = text.replace(`INSERT INTO ${from}`, `INSERT INTO ${to}`);
  if (next === text) throw new Error(`businessCurrentMonthRefresh: khong tim thay "INSERT INTO ${from}" trong cau chot thang`);
  return next;
}
const FILL_CUSTOMER_SQL = retarget(sql.FREEZE_CUSTOMER_SQL, 'business_monthly_customer_sales', 'bcm_customer_new');
const FILL_PRODUCT_SQL = retarget(sql.FREEZE_CUSTOMER_PRODUCT_SQL, 'business_monthly_customer_product_sales', 'bcm_product_new');

const CREATE_STAGING_SQL = [
  `CREATE TEMP TABLE bcm_customer_new (LIKE ${CUSTOMER_TABLE}) ON COMMIT DROP`,
  `CREATE TEMP TABLE bcm_product_new (LIKE ${PRODUCT_TABLE}) ON COMMIT DROP`
];
const COUNT_STAGING_SQL = `
  SELECT (SELECT COUNT(*) FROM bcm_customer_new)::int AS customers,
         (SELECT COUNT(*) FROM bcm_product_new)::int AS products,
         (SELECT COUNT(*) FROM ${CUSTOMER_TABLE} WHERE month = $1::date)::int AS existing_customers,
         (SELECT COUNT(*) FROM ${PRODUCT_TABLE} WHERE month = $1::date)::int AS existing_products`;

const CUSTOMER_KEY = ['month', 'branch', 'customer_code'];
const CUSTOMER_VALUES = ['customer_id', 'customer_name', 'invoice_amount', 'return_amount', 'net_revenue', 'invoice_count', 'return_count'];
const PRODUCT_KEY = ['month', 'branch', 'customer_code', 'product_code'];
const PRODUCT_VALUES = ['product_name', 'net_revenue', 'net_qty'];

const joinOn = key => key.map(column => `t.${column} = n.${column}`).join(' AND ');
const tuple = (alias, columns) => `(${columns.map(column => `${alias}.${column}`).join(', ')})`;

// LEFT JOIN + IS DISTINCT FROM o SELECT: dong khong doi khong tham gia INSERT (bai hoc su co IO).
function upsertSql(table, staging, key, values) {
  const columns = [...key, ...values];
  return `
  INSERT INTO ${table} (${columns.join(', ')})
  SELECT ${columns.map(column => `n.${column}`).join(', ')}
  FROM ${staging} n
  LEFT JOIN ${table} t ON ${joinOn(key)}
  WHERE t.month IS NULL OR ${tuple('t', values)} IS DISTINCT FROM ${tuple('n', values)}
  ON CONFLICT (${key.join(', ')}) DO UPDATE SET
    ${values.map(column => `${column} = EXCLUDED.${column}`).join(',\n    ')}`;
}
const UPSERT_CUSTOMER_SQL = upsertSql(CUSTOMER_TABLE, 'bcm_customer_new', CUSTOMER_KEY, CUSTOMER_VALUES);
const UPSERT_PRODUCT_SQL = upsertSql(PRODUCT_TABLE, 'bcm_product_new', PRODUCT_KEY, PRODUCT_VALUES);

// $1 thang hien tai: xoa dong cua THANG NAY khong con trong ket qua moi.
const deleteSql = (table, staging, key) => `
  DELETE FROM ${table} t
  WHERE t.month = $1::date
    AND NOT EXISTS (SELECT 1 FROM ${staging} n WHERE ${joinOn(key)})`;
const DELETE_CUSTOMER_SQL = deleteSql(CUSTOMER_TABLE, 'bcm_customer_new', CUSTOMER_KEY);
const DELETE_PRODUCT_SQL = deleteSql(PRODUCT_TABLE, 'bcm_product_new', PRODUCT_KEY);

// $1 thang hien tai: dong cua thang CU chi bi xoa khi freezeMonth da ghi state thang do.
const dropFrozenSql = table => `
  DELETE FROM ${table} t
  WHERE t.month <> $1::date
    AND EXISTS (SELECT 1 FROM business_monthly_state s WHERE s.month = t.month)`;
const DROP_FROZEN_SQL = [dropFrozenSql(CUSTOMER_TABLE), dropFrozenSql(PRODUCT_TABLE)];

const READ_STATE_SQL = `
  SELECT to_char(month, 'YYYY-MM-DD') AS month, computed_at, cutoff, last_full_at, customers_synced_at, version
  FROM ${STATE_TABLE} WHERE id = 1`;

// $1 co so, $2 moc synced_at. Cot synced_at thieu (schema khac) => loi 42703 => coi nhu CO thay doi.
const PROBE_SQL = `
  SELECT EXISTS (SELECT 1 FROM invoices WHERE branch = ANY($1::text[]) AND synced_at >= $2::timestamptz) AS invoices_changed,
         EXISTS (SELECT 1 FROM returns WHERE branch = ANY($1::text[]) AND synced_at >= $2::timestamptz) AS returns_changed,
         (SELECT MAX(synced_at) FROM customers WHERE branch = ANY($1::text[])) AS customers_synced_at`;

// $1 thang, $2 computed_at, $3 cutoff, $4 last_full_at (null = giu), $5 customers_synced_at (null = giu),
// $6 du lieu doi hay chua. `version` chi tang khi doi.
const UPSERT_STATE_SQL = `
  INSERT INTO ${STATE_TABLE} (id, month, computed_at, cutoff, last_full_at, customers_synced_at, version)
  VALUES (1, $1::date, $2::timestamptz, $3::timestamptz, $4::timestamptz, $5::timestamptz, 1)
  ON CONFLICT (id) DO UPDATE SET
    month = EXCLUDED.month, computed_at = EXCLUDED.computed_at, cutoff = EXCLUDED.cutoff,
    last_full_at = COALESCE(EXCLUDED.last_full_at, ${STATE_TABLE}.last_full_at),
    customers_synced_at = COALESCE(EXCLUDED.customers_synced_at, ${STATE_TABLE}.customers_synced_at),
    version = ${STATE_TABLE}.version + CASE WHEN $6::boolean THEN 1 ELSE 0 END
  RETURNING version`;
const TOUCH_STATE_SQL = `UPDATE ${STATE_TABLE} SET computed_at = $1::timestamptz WHERE id = 1`;

const isMissingRelation = error => !!error && (error.code === '42P01' || error.code === '42703');

/** Luot day du khi: chua tung day du, hoac lan gan nhat KHONG phai ngay VN hom nay VA da qua 00:10 VN. */
function isFullDue(lastFullAt, now) {
  if (!lastFullAt) return true;
  if (vnDateKey(new Date(lastFullAt)) === vnDateKey(now)) return false;
  return vnMinutesOfDay(now) >= FULL_SETTLE_MINUTES_AFTER_MIDNIGHT;
}

/** Moc cutoff cua cau live: cot thoi gian luu gio VN nhung gan nhan UTC. */
function liveCutoff(instant) {
  return new Date(instant.getTime() + 7 * 60 * 60 * 1000).toISOString().replace('Z', '');
}

// Bao thay doi qua bus chung -> den duoc ca tien trinh web khi job chay o worker.js.
const { dashboardRollupEvents } = require('./dashboardRollupEvents');
let running = null;
let rerunRequested = false;
let lastStartedAtMs = 0;

/** Goi khi bang ket qua doi (repository xoa cache). */
function onBusinessCurrentMonthChanged(listener) {
  const safe = info => {
    try { listener(info); } catch (error) { console.error('[businessCurrentMonthRefresh] listener loi:', error && error.message); }
  };
  dashboardRollupEvents.on('businessCurrentMonthChanged', safe);
  return () => dashboardRollupEvents.off('businessCurrentMonthChanged', safe);
}

function notifyChanged(info) {
  dashboardRollupEvents.emit('businessCurrentMonthChanged', info);
}

/** Don dong thoi: dang chay thi chay them 1 luot sau, khong chong luot. */
async function refreshBusinessCurrentMonth(pool = getPool(), options = {}) {
  if (running) {
    rerunRequested = true;
    return running;
  }
  running = (async () => {
    let result = null;
    do {
      rerunRequested = false;
      const next = await refreshOnce(pool, options);
      if (!result || !next.skipped) result = next;
    } while (rerunRequested);
    return result;
  })();
  try {
    return await running;
  } finally {
    running = null;
  }
}

async function readState(pool) {
  try {
    const { rows } = await pool.query(READ_STATE_SQL);
    return { state: rows[0] || null };
  } catch (error) {
    if (isMissingRelation(error)) return { missing: true };
    throw error;
  }
}

// Co chung tu / khach nao doi tu lan tinh truoc khong? Loi thieu cot (42703/42P01) => coi la co.
// Chua co state (lan dau) thi moc = epoch; luot day du van goi de ghi nho customers_synced_at.
async function probeChanged(pool, state) {
  const since = new Date(state ? new Date(state.computed_at).getTime() - PROBE_OVERLAP_MS : 0).toISOString();
  try {
    const { rows: [probe] } = await pool.query(PROBE_SQL, [BRANCHES, since]);
    const customersSyncedAt = probe.customers_synced_at ? new Date(probe.customers_synced_at) : null;
    const previous = state && state.customers_synced_at ? new Date(state.customers_synced_at) : null;
    const customersChanged = !!customersSyncedAt && (!previous || customersSyncedAt.getTime() > previous.getTime());
    return { changed: !!(probe.invoices_changed || probe.returns_changed || customersChanged), customersSyncedAt };
  } catch (error) {
    if (isMissingRelation(error)) return { changed: true, customersSyncedAt: null };
    throw error;
  }
}

// Xoa dong thang cu da chot. Trong giao dich phai co SAVEPOINT de thieu business_monthly_state (42P01)
// khong lam hong ca giao dich.
async function cleanupFrozenMonths(db, month, { savepoint = false } = {}) {
  if (savepoint) await db.query('SAVEPOINT bcm_cleanup');
  try {
    for (const text of DROP_FROZEN_SQL) await db.query(text, [month]);
    if (savepoint) await db.query('RELEASE SAVEPOINT bcm_cleanup');
  } catch (error) {
    if (error.code !== '42P01') throw error;
    if (savepoint) {
      await db.query('ROLLBACK TO SAVEPOINT bcm_cleanup');
      await db.query('RELEASE SAVEPOINT bcm_cleanup');
    }
  }
}

async function refreshOnce(pool, {
  now = Date.now, log = console.log, force = false, minIntervalMs = DEFAULT_MIN_INTERVAL_MS
} = {}) {
  const startedAt = Date.now();
  const instant = new Date(now());
  const month = monthKey(vnToday(instant));

  const { state, missing } = await readState(pool);
  if (missing) return { skipped: 'migration-missing', changed: false };
  const stateMonthChanged = !!state && state.month !== month;
  const fullRun = force || !state || stateMonthChanged || isFullDue(state.last_full_at, instant);
  if (!fullRun && lastStartedAtMs && instant.getTime() - lastStartedAtMs < minIntervalMs) {
    return { skipped: 'min-interval', changed: false, month };
  }
  lastStartedAtMs = instant.getTime();

  const probe = await probeChanged(pool, fullRun && (!state || stateMonthChanged) ? null : state);
  if (!fullRun && !probe.changed) {
    // Khong co gi moi: chi danh dau "da kiem tra luc nay" (1 dong), khong tinh lai, khong tang version.
    await pool.query(TOUCH_STATE_SQL, [instant.toISOString()]);
    await cleanupFrozenMonths(pool, month);
    log(`[businessCurrentMonthRefresh] Thang ${month}: khong co chung tu moi, chi cham computed_at.`);
    return { skipped: 'unchanged', changed: false, month, version: Number(state.version) };
  }
  const customersSyncedAt = probe.customersSyncedAt;

  const params = [BRANCHES, month, liveCutoff(instant)];
  const client = await pool.connect();
  try {
    // REPEATABLE READ: khach + khach x ma hang cung 1 snapshot nguon. Khoa try (khong cho) vi cho khoa
    // xong snapshot da cu so voi luot kia vua ghi => loi tuan tu hoa; luot bi bo se duoc luot sau lo.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const { rows: [lock] } = await client.query('SELECT pg_try_advisory_xact_lock($1::bigint) AS locked', [ADVISORY_LOCK_KEY]);
    if (!lock.locked) {
      await client.query('ROLLBACK');
      return { skipped: 'locked', changed: false, month };
    }
    await client.query(`SET LOCAL work_mem = '${REFRESH_WORK_MEM}'`);
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
    await client.query(PLANNER_GUARD_SQL);
    for (const text of CREATE_STAGING_SQL) await client.query(text);
    await client.query(FILL_CUSTOMER_SQL, params);
    await client.query(FILL_PRODUCT_SQL, params);
    const { rows: [counts] } = await client.query(COUNT_STAGING_SQL, [month]);
    const writtenCustomers = (await client.query(UPSERT_CUSTOMER_SQL)).rowCount || 0;
    const writtenProducts = (await client.query(UPSERT_PRODUCT_SQL)).rowCount || 0;
    // Chot an toan: doc ra 0 dong (loi nguon / chua co du lieu) thi KHONG xoa sach bang dang co.
    const deletedCustomers = counts.customers > 0 ? ((await client.query(DELETE_CUSTOMER_SQL, [month])).rowCount || 0) : 0;
    const deletedProducts = counts.products > 0 ? ((await client.query(DELETE_PRODUCT_SQL, [month])).rowCount || 0) : 0;
    const guarded = (counts.customers === 0 && counts.existing_customers > 0) || (counts.products === 0 && counts.existing_products > 0);
    await cleanupFrozenMonths(client, month, { savepoint: true });
    const written = writtenCustomers + writtenProducts;
    const deleted = deletedCustomers + deletedProducts;
    const changed = written + deleted > 0 || !state || stateMonthChanged;
    const { rows: [saved] } = await client.query(UPSERT_STATE_SQL, [
      month, instant.toISOString(), instant.toISOString(), fullRun ? instant.toISOString() : null,
      customersSyncedAt ? customersSyncedAt.toISOString() : null, changed
    ]);
    await client.query('COMMIT');
    const result = {
      mode: fullRun ? 'full' : 'fast', month, changed, written, deleted, guarded,
      customers: counts.customers, customerProducts: counts.products, version: Number(saved.version)
    };
    if (changed) notifyChanged({ month, version: result.version });
    log(`[businessCurrentMonthRefresh] Thang ${month} (${result.mode}): ${counts.customers} khach, ${counts.products} dong khach x ma, `
      + `ghi ${written}, xoa ${deleted}${guarded ? ' (bo qua xoa: nguon rong)' : ''} (${Date.now() - startedAt} ms)`);
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Lam moi nen, nuot loi (dung cho hook sau luot sync fast). Chua cau hinh DB / pool gia / tat bang
 * BUSINESS_CURRENT_MONTH_ENABLED=false / chua ap migration 0068 => khong lam gi.
 */
function requestBusinessCurrentMonthRefresh(pool = getPool(), { log = console.log, now, force = false } = {}) {
  const config = require('../config');
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function' || !config.SUPABASE_DB_URL
    || config.BUSINESS_CURRENT_MONTH_ENABLED === false) return Promise.resolve(null);
  const options = { log, force, minIntervalMs: config.BUSINESS_CURRENT_MONTH_MIN_INTERVAL_MS || DEFAULT_MIN_INTERVAL_MS };
  if (now) options.now = now;
  return refreshBusinessCurrentMonth(pool, options).catch(error => {
    if (isMissingRelation(error)) return null;
    console.error('[businessCurrentMonthRefresh] Loi tinh thang hien tai:', error && error.message);
    return null;
  });
}

module.exports = {
  refreshBusinessCurrentMonth, requestBusinessCurrentMonthRefresh, onBusinessCurrentMonthChanged, isFullDue,
  DEFAULT_MIN_INTERVAL_MS,
  __test__: { resetState() { running = null; rerunRequested = false; lastStartedAtMs = 0; }, FILL_CUSTOMER_SQL, FILL_PRODUCT_SQL, UPSERT_CUSTOMER_SQL, UPSERT_PRODUCT_SQL }
};

if (require.main === module) {
  refreshBusinessCurrentMonth(getPool(), { force: true })
    .then(result => { console.log(result); return getPool().end(); })
    .catch(error => { console.error(error); process.exitCode = 1; });
}
