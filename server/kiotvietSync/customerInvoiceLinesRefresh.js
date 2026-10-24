'use strict';

// Dung lai bang customer_invoice_lines_90d (chi tiet hoa don 90 ngay, gan san ma
// khach) - nguon cua "Bao cao doanh thu theo khach" (tab Khach hang, phan 3),
// xem server/db/migrations/0022_customer_invoice_lines_90d.sql.
//
// CHI dung lai 1 LAN/DEM, theo mau productReportRefresh.js: ham
// refreshCustomerInvoiceLinesIfDue duoc goi moi 5 phut nhung hau het cac lan chi
// la 1 SELECT re roi bo qua. Chay sau 0h VN (SETTLE_MINUTES_AFTER_MIDNIGHT phut)
// thay vi dung 23:59 de (1) cua so "90 ngay ket thuc HOM QUA" da tron ven ngay
// vua qua, (2) hoa don ban vao nhung phut cuoi ngay kip duoc dong bo (sync fast
// 7 phut/lan) truoc khi tinh.
//
// LUU Y IO (su co Disk IO Supabase 2026-09-28, xem ghi chu dau
// dashboardRollupRefresh.js): khong TRUNCATE + nap lai ca bang moi dem. Cau nap
// vao bang tam roi chi XOA dong da mat/doi va CHEN dong moi, nen 1 dem binh
// thuong chi ghi ~1 ngay du lieu (ngay moi vao cua so, ngay cu ra khoi cua so).
// Doc dong thoi van thay ban cu cho toi luc COMMIT (khong khoa doc nhu TRUNCATE).
//
// CHE DO TANG DAN (REPORTS_INCREMENTAL_ENABLED=true, ke hoach
// docs/superpowers/specs/2026-10-16-realtime-customer-product-reports-design.md muc 3.A):
// sau MOI luot sync fast, refreshCustomerInvoiceLinesIncremental chi dung lai dong cua cac
// hoa don/phieu tra duoc dong bo (synced_at) >= (lan kiem tra truoc - 2 gio) - chon theo synced_at
// (index 0054) chu KHONG theo modified_date: 91% hoa don co modified_date NULL (KiotViet chi ghi khi co sua
// sau khi tao, do 2026-10-16) nen loc theo no bo sot hoa don moi; cung KHONG theo ngay ban vi hoa don cu van bi sua muon (662 hoa don/30 ngay do
// 2026-10-16). Cua so 90 ngay GOM HOM NAY va truot moi lan. Luot dung lai day du van chay
// 1 lan/dem sau 00:10 VN nhu CHOT DOI SOAT (bat doi ten/doi ma khach vi ma khach khop theo ten
// chuan hoa, khong di qua synced_at cua hoa don). Hai luot tuan tu qua pg_advisory_xact_lock.
//
// LUU Y MUI GIO / TRANG THAI: giong quy uoc dashboardRollupRefresh.js - purchase_date
// luu "gio treo tuong VN mang nhan UTC" (doc bang AT TIME ZONE 'UTC'); moc "hom
// nay" lay tu dong ho that theo lich VN; trang thai loc theo statusValue (chuoi
// that), KHONG loc theo so status.

if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* dotenv là tùy chọn trong môi trường production */ }
}

const CONFIG = require('../config');
const { getPool } = require('../db/pool');
const { DETAIL_AMOUNT_SQL, RETURN_AMOUNT_SQL, INVOICE_STATUS_SQL, normalizedNameSql, CUSTOMER_BY_NAME_CTE } = require('./salesSqlFragments');
const { vnDateKey, vnMinutesOfDay, addDaysToKey } = require('./vnTime');

const BRANCH_CODES = Object.freeze(['hanoi', 'saigon']);

// Ten khach HIEN TAI (customers.name theo customer_id) uu tien hon ten ghi tren chung tu: doi ten khach tren
// KiotViet khong sua chung tu cu nen khong can dong bo lai hoa don, chi can dung lai bang nay.
const currentName = alias => `COALESCE(NULLIF(btrim(cc.name), ''), NULLIF(btrim(${alias}.raw->>'customerName'), ''), 'Khách lẻ')`;
const WINDOW_DAYS = 90;
const SETTLE_MINUTES_AFTER_MIDNIGHT = 10;
const REFRESH_WORK_MEM = '32MB';
// Luot tang dan doc lai chung tu co synced_at tu (lan kiem tra truoc - OVERLAP): bu do tre dong bo
// KiotViet (7-10 phut) va dong ho lech; chung tu doc lai chi tao dong ghi neu noi dung THAT SU doi.
const INCREMENTAL_OVERLAP_MS = 2 * 60 * 60 * 1000;
// Bang cu hon nguong nay (may chu tat lau) thi dung lai day du thay vi tang dan.
const INCREMENTAL_MAX_GAP_MS = 7 * 24 * 60 * 60 * 1000;
const ADVISORY_LOCK_SQL = 'SELECT pg_advisory_xact_lock(20531022)';

// BAT PLANNER (do tren DB that 2026-10-16): khi uoc luong it hoa don/phieu tra (cua so hep, hoac
// thong ke cu), Postgres chon Merge Left Join chi theo `branch` roi loc bang bieu thuc
// normalize/regexp tren ~7.300 ten khach cho TUNG chung tu: cua so 7 ngay 41s, phan phieu tra
// 90 ngay 26s (dung nhan cua so 90 ngay hoa don thi 2,8s nen khong ai thay). Tat merge join
// trong giao dich nay buoc dung hash join theo name_key: 7 ngay 0,68s, phieu tra 90 ngay 0,19s,
// hoa don 90 ngay 3,1s, ket qua giong het. SET LOCAL nen khong anh huong ket noi tra ve pool.
const PLANNER_GUARD_SQL = 'SET LOCAL enable_mergejoin = off';

const CREATE_STAGING_SQL = `
  CREATE TEMP TABLE customer_invoice_lines_new
    (LIKE customer_invoice_lines_90d) ON COMMIT DROP`;

// $1 co so (text[]), $2 ngay dau cua so, $3 ngay cuoi cua so (ca hai 'YYYY-MM-DD').
// Cach doi chieu ma khach theo ten: xem CUSTOMER_BY_NAME_CTE trong salesSqlFragments.js.
const FILL_STAGING_SQL = `${CUSTOMER_BY_NAME_CTE}
  INSERT INTO customer_invoice_lines_new
    (branch, invoice_id, line_no, invoice_code, sold_date, customer_code, customer_name,
     item_code, item_name, quantity, revenue)
  SELECT
    d.branch,
    d.invoice_id,
    d.line_no,
    i.code,
    (i.purchase_date AT TIME ZONE 'UTC')::date,
    COALESCE(NULLIF(btrim(i.raw->>'customerCode'), ''), cc.code, cbn.code),
    ${currentName('i')},
    COALESCE(NULLIF(d.raw->>'productCode', ''), p.code, ''),
    COALESCE(NULLIF(btrim(p.raw->>'fullName'), ''), NULLIF(btrim(p.name), ''), NULLIF(d.raw->>'productName', ''), ''),
    COALESCE(d.quantity, 0)::numeric,
    (${DETAIL_AMOUNT_SQL})::numeric
  FROM invoices i
  JOIN invoice_details d ON d.branch = i.branch AND d.invoice_id = i.id
  LEFT JOIN products p ON p.branch = d.branch AND p.id = d.product_id
  LEFT JOIN customers cc ON cc.branch = i.branch AND cc.id = i.customer_id
  LEFT JOIN customer_by_name cbn
    ON cbn.branch = i.branch
   AND cbn.name_key = ${normalizedNameSql(currentName('i'))}
  WHERE i.branch = ANY($1::text[])
    AND i.purchase_date >= ($2::date::timestamp AT TIME ZONE 'UTC')
    AND i.purchase_date <  (($3::date + 1)::timestamp AT TIME ZONE 'UTC')
    AND ${INVOICE_STATUS_SQL} = 'Hoàn thành'
    AND btrim(i.code) <> ''
    AND COALESCE(NULLIF(btrim(i.raw->>'customerCode'), ''), cc.code, cbn.code) IS NOT NULL`;

// DOANH THU THUC TE: hang khach tra (phieu tra statusValue='Đã trả') la cac dong AM
// trong cung bang, theo ngay TRA, gan cho khach nhu hoa don (ma tren phieu tra, khong
// co thi tim theo ten chuan hoa). invoice_id = -id phieu tra de khong trung khoa voi
// hoa don (id hoa don luon duong); invoice_code = ma phieu tra (TH...). So luong va
// gia tri deu am nen tong theo mat hang/ngay/thang tu dong la so rong.
// $1/$2/$3 giong FILL_STAGING_SQL.
const FILL_STAGING_RETURNS_SQL = `${CUSTOMER_BY_NAME_CTE}
  INSERT INTO customer_invoice_lines_new
    (branch, invoice_id, line_no, invoice_code, sold_date, customer_code, customer_name,
     item_code, item_name, quantity, revenue)
  SELECT
    rd.branch,
    -r.id,
    rd.line_no,
    r.code,
    (r.return_date AT TIME ZONE 'UTC')::date,
    COALESCE(NULLIF(btrim(r.raw->>'customerCode'), ''), cc.code, cbn.code),
    ${currentName('r')},
    COALESCE(NULLIF(rd.raw->>'productCode', ''), p.code, ''),
    COALESCE(NULLIF(btrim(p.raw->>'fullName'), ''), NULLIF(btrim(p.name), ''), NULLIF(rd.raw->>'productName', ''), ''),
    -abs(COALESCE(rd.quantity, 0))::numeric,
    -(${RETURN_AMOUNT_SQL})::numeric
  FROM returns r
  JOIN return_details rd ON rd.branch = r.branch AND rd.return_id = r.id
  LEFT JOIN products p ON p.branch = rd.branch AND p.id = rd.product_id
  LEFT JOIN customers cc ON cc.branch = r.branch AND cc.id = r.customer_id
  LEFT JOIN customer_by_name cbn
    ON cbn.branch = r.branch
   AND cbn.name_key = ${normalizedNameSql(currentName('r'))}
  WHERE r.branch = ANY($1::text[])
    AND r.return_date >= ($2::date::timestamp AT TIME ZONE 'UTC')
    AND r.return_date <  (($3::date + 1)::timestamp AT TIME ZONE 'UTC')
    AND r.raw->>'statusValue' = 'Đã trả'
    AND btrim(r.code) <> ''
    AND COALESCE(NULLIF(btrim(r.raw->>'customerCode'), ''), cc.code, cbn.code) IS NOT NULL`;

// Ban tang dan: cung cau, them dieu kien synced_at ($4). Tao bang replace + kiem tra de khong
// am tham tro thanh ban sao y nguyen ban day du khi ai do sua dinh dang cau goc.
function withSince(sql, anchor, filter) {
  const next = sql.replace(anchor, `${filter}\n    ${anchor}`);
  if (next === sql) throw new Error('customerInvoiceLinesRefresh: khong tim thay neo de them dieu kien synced_at');
  return next;
}
const FILL_STAGING_INCR_SQL = withSince(FILL_STAGING_SQL, "AND btrim(i.code) <> ''", 'AND i.synced_at >= $4::timestamptz');
const FILL_STAGING_RETURNS_INCR_SQL = withSince(FILL_STAGING_RETURNS_SQL, "AND btrim(r.code) <> ''", 'AND r.synced_at >= $4::timestamptz');

// Tap chung tu da doi (ke ca chung tu GIO KHONG con thoa dieu kien, vd hoa don vua huy => dong cua no
// phai bi xoa). invoice_id cua phieu tra la -id nhu trong bang chinh. $1 co so, $2 moc synced_at.
const CREATE_CHANGED_SQL = `
  CREATE TEMP TABLE customer_invoice_changed (branch TEXT NOT NULL, invoice_id BIGINT NOT NULL) ON COMMIT DROP`;
const FILL_CHANGED_SQL = `
  INSERT INTO customer_invoice_changed (branch, invoice_id)
  SELECT branch, id FROM invoices
  WHERE branch = ANY($1::text[]) AND synced_at >= $2::timestamptz
  UNION ALL
  SELECT branch, -id FROM returns
  WHERE branch = ANY($1::text[]) AND synced_at >= $2::timestamptz`;

const LINE_MATCH_SQL =`n.branch = l.branch AND n.invoice_id = l.invoice_id AND n.line_no = l.line_no`;

// Xoa dong da bien mat khoi cua so HOAC da doi noi dung (hoa don bi sua/huy,
// gan lai khach...). Dong doi se duoc chen lai o cau ke tiep.
const DELETE_STALE_SQL = `
  DELETE FROM customer_invoice_lines_90d l
  WHERE NOT EXISTS (
    SELECT 1 FROM customer_invoice_lines_new n
    WHERE ${LINE_MATCH_SQL}
      AND ROW(n.invoice_code, n.sold_date, n.customer_code, n.customer_name,
              n.item_code, n.item_name, n.quantity, n.revenue)
        = ROW(l.invoice_code, l.sold_date, l.customer_code, l.customer_name,
              l.item_code, l.item_name, l.quantity, l.revenue)
  )`;

const INSERT_MISSING_SQL = `
  INSERT INTO customer_invoice_lines_90d
    (branch, invoice_id, line_no, invoice_code, sold_date, customer_code, customer_name,
     item_code, item_name, quantity, revenue)
  SELECT n.branch, n.invoice_id, n.line_no, n.invoice_code, n.sold_date, n.customer_code,
         n.customer_name, n.item_code, n.item_name, n.quantity, n.revenue
  FROM customer_invoice_lines_new n
  WHERE NOT EXISTS (SELECT 1 FROM customer_invoice_lines_90d l WHERE ${LINE_MATCH_SQL})`;

// Chi xet dong cua chung tu da doi: khong co dong moi giong het thi xoa (de chen lai o cau ke tiep).
const DELETE_STALE_INCR_SQL = `
  DELETE FROM customer_invoice_lines_90d l
  USING customer_invoice_changed c
  WHERE l.branch = c.branch AND l.invoice_id = c.invoice_id
    AND NOT EXISTS (
      SELECT 1 FROM customer_invoice_lines_new n
      WHERE ${LINE_MATCH_SQL}
        AND ROW(n.invoice_code, n.sold_date, n.customer_code, n.customer_name,
                n.item_code, n.item_name, n.quantity, n.revenue)
          = ROW(l.invoice_code, l.sold_date, l.customer_code, l.customer_name,
                l.item_code, l.item_name, l.quantity, l.revenue)
    )`;
// Cua so truot: dong cu hon ngay dau cua so ($1) roi khoi bang (dung index PK khong; bang chi ~68K dong).
const DELETE_OUT_OF_WINDOW_SQL = 'DELETE FROM customer_invoice_lines_90d WHERE sold_date < $1::date';
// $1 ngay dau cua so, $2 ngay cuoi cua so. computed_at = LAN KIEM TRA gan nhat (nhan "cap nhat luc" cua UI).
const UPDATE_STATE_INCR_SQL = `
  UPDATE customer_invoice_lines_state
  SET window_start = $1::date, window_end = $2::date,
      row_count = (SELECT count(*) FROM customer_invoice_lines_90d), computed_at = now()
  WHERE id = 1
  RETURNING row_count`;
// Ban day du khi che do tang dan bat: them moc last_full_at (migration 0054) de lich dem biet da doi soat chua.
const UPSERT_STATE_FULL_SQL = `
  INSERT INTO customer_invoice_lines_state (id, window_start, window_end, row_count, computed_at, last_full_at)
  VALUES (1, $1::date, $2::date, (SELECT count(*) FROM customer_invoice_lines_90d), now(), now())
  ON CONFLICT (id) DO UPDATE
    SET window_start = EXCLUDED.window_start, window_end = EXCLUDED.window_end,
        row_count = EXCLUDED.row_count, computed_at = EXCLUDED.computed_at, last_full_at = EXCLUDED.last_full_at
  RETURNING row_count`;
const READ_STATE_SQL = 'SELECT computed_at, last_full_at, window_end FROM customer_invoice_lines_state WHERE id = 1';

// $1 ngay dau cua so, $2 ngay cuoi cua so.
const UPSERT_STATE_SQL = `
  INSERT INTO customer_invoice_lines_state (id, window_start, window_end, row_count, computed_at)
  VALUES (1, $1::date, $2::date, (SELECT count(*) FROM customer_invoice_lines_90d), now())
  ON CONFLICT (id) DO UPDATE
    SET window_start = EXCLUDED.window_start, window_end = EXCLUDED.window_end,
        row_count = EXCLUDED.row_count, computed_at = EXCLUDED.computed_at
  RETURNING row_count`;

const LAST_COMPUTED_SQL = 'SELECT computed_at FROM customer_invoice_lines_state WHERE id = 1';

/**
 * 90 ngay ket thuc HOM QUA (theo lich VN): {start, end} dang 'YYYY-MM-DD'. Che do tang dan
 * (includeToday) ket thuc HOM NAY de gom hoa don vua phat sinh.
 */
function computeWindow(now = new Date(), { includeToday = false } = {}) {
  const end = includeToday ? vnDateKey(now) : addDaysToKey(vnDateKey(now), -1);
  return { start: addDaysToKey(end, -(WINDOW_DAYS - 1)), end };
}

/**
 * Dung lai bang chi tiet 90 ngay trong 1 giao dich (loi giua chung => ROLLBACK,
 * bang van la ban cu, khong co trang thai "nua voi").
 */
async function refreshCustomerInvoiceLines(pool, { log = console.log, now = () => new Date(), incremental = false } = {}) {
  const window = computeWindow(now(), { includeToday: incremental });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (incremental) await client.query(ADVISORY_LOCK_SQL);
    await client.query(`SET LOCAL work_mem = '${REFRESH_WORK_MEM}'`);
    await client.query(PLANNER_GUARD_SQL);
    await client.query(CREATE_STAGING_SQL);
    await client.query(FILL_STAGING_SQL, [BRANCH_CODES, window.start, window.end]);
    await client.query(FILL_STAGING_RETURNS_SQL, [BRANCH_CODES, window.start, window.end]);
    const deleted = await client.query(DELETE_STALE_SQL);
    const inserted = await client.query(INSERT_MISSING_SQL);
    const state = await client.query(incremental ? UPSERT_STATE_FULL_SQL : UPSERT_STATE_SQL, [window.start, window.end]);
    await client.query('COMMIT');
    const result = {
      window,
      rowCount: Number(state.rows && state.rows[0] && state.rows[0].row_count) || 0,
      inserted: inserted.rowCount || 0,
      deleted: deleted.rowCount || 0
    };
    log(`[customerInvoiceLinesRefresh] Cua so ${window.start}..${window.end}: ${result.rowCount} dong `
      + `(them ${result.inserted}, xoa ${result.deleted}).`);
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Luot TANG DAN (chay sau moi luot sync fast): dung lai dong cua chung tu co synced_at moi,
 * truot cua so den hom nay. Chua co moc last_full_at / bang qua cu => dung lai day du truoc.
 * Thieu cot last_full_at (chua chay migration 0054) => bo qua, giu luong chot dem cu.
 */
async function refreshCustomerInvoiceLinesIncremental(pool, {
  log = console.log, now = () => new Date(), enabled = CONFIG.REPORTS_INCREMENTAL_ENABLED
} = {}) {
  if (!enabled) return { skipped: 'disabled' };
  let state;
  try {
    ({ rows: [state] } = await pool.query(READ_STATE_SQL));
  } catch (error) {
    if (error.code === '42703' || error.code === '42P01') return { skipped: 'migration-missing' };
    throw error;
  }
  const current = now();
  if (!state || !state.last_full_at || current.getTime() - new Date(state.computed_at).getTime() > INCREMENTAL_MAX_GAP_MS) {
    const result = await refreshCustomerInvoiceLines(pool, { log, now, incremental: true });
    return { skipped: false, mode: 'full', ...result };
  }

  const window = computeWindow(current, { includeToday: true });
  const since = new Date(new Date(state.computed_at).getTime() - INCREMENTAL_OVERLAP_MS).toISOString();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(ADVISORY_LOCK_SQL);
    await client.query(`SET LOCAL work_mem = '${REFRESH_WORK_MEM}'`);
    await client.query(PLANNER_GUARD_SQL);
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query(CREATE_STAGING_SQL);
    await client.query(CREATE_CHANGED_SQL);
    const changed = await client.query(FILL_CHANGED_SQL, [BRANCH_CODES, since]);
    await client.query(FILL_STAGING_INCR_SQL, [BRANCH_CODES, window.start, window.end, since]);
    await client.query(FILL_STAGING_RETURNS_INCR_SQL, [BRANCH_CODES, window.start, window.end, since]);
    const deleted = await client.query(DELETE_STALE_INCR_SQL);
    const slid = await client.query(DELETE_OUT_OF_WINDOW_SQL, [window.start]);
    const inserted = await client.query(INSERT_MISSING_SQL);
    const saved = await client.query(UPDATE_STATE_INCR_SQL, [window.start, window.end]);
    await client.query('COMMIT');
    const result = {
      window, since,
      changedDocs: changed.rowCount || 0,
      rowCount: Number(saved.rows && saved.rows[0] && saved.rows[0].row_count) || 0,
      inserted: inserted.rowCount || 0,
      deleted: deleted.rowCount || 0,
      slid: slid.rowCount || 0
    };
    log(`[customerInvoiceLinesRefresh] Tang dan ${window.start}..${window.end}: ${result.changedDocs} chung tu doi, `
      + `them ${result.inserted}, xoa ${result.deleted}, truot ${result.slid}, tong ${result.rowCount} dong.`);
    return { skipped: false, mode: 'incremental', ...result };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Den han khi: chua tung dung, hoac lan dung gan nhat KHONG phai ngay VN hom nay
 * VA da qua SETTLE_MINUTES_AFTER_MIDNIGHT phut dau ngay (cho hoa don cuoi ngay hom
 * truoc kip dong bo). Khoi dong lai giua ngay ma bang cu tu hom qua => dung ngay.
 */
function isRefreshDue(lastComputedAt, now) {
  if (!lastComputedAt) return true;
  if (vnDateKey(new Date(lastComputedAt)) === vnDateKey(now)) return false;
  return vnMinutesOfDay(now) >= SETTLE_MINUTES_AFTER_MIDNIGHT;
}

async function refreshCustomerInvoiceLinesIfDue(pool, {
  log = console.log, now = () => new Date(), incremental = CONFIG.REPORTS_INCREMENTAL_ENABLED
} = {}) {
  if (incremental) {
    // Che do tang dan: computed_at bi cap nhat moi luot kiem tra nen chot dem dua vao last_full_at.
    let state;
    try {
      ({ rows: [state] } = await pool.query(READ_STATE_SQL));
    } catch (error) {
      if (error.code !== '42703' && error.code !== '42P01') throw error;
      incremental = false; // chua chay migration 0054: dung luong chot dem cu
    }
    if (incremental) {
      if (!isRefreshDue(state && state.last_full_at, now())) return { skipped: true };
      const result = await refreshCustomerInvoiceLines(pool, { log, now, incremental: true });
      return { skipped: false, ...result };
    }
  }
  const { rows } = await pool.query(LAST_COMPUTED_SQL);
  const lastComputedAt = rows[0] && rows[0].computed_at;
  if (!isRefreshDue(lastComputedAt, now())) return { skipped: true };
  const result = await refreshCustomerInvoiceLines(pool, { log, now });
  return { skipped: false, ...result };
}

function startCustomerInvoiceLinesSchedule(pool, {
  intervalMs = 5 * 60 * 1000,
  setIntervalFn = setInterval,
  scheduleImmediate = queueMicrotask,
  log = console.log
} = {}) {
  scheduleImmediate(() => {
    refreshCustomerInvoiceLinesIfDue(pool, { log }).catch((error) => {
      log(`[customerInvoiceLinesRefresh] Loi khi tinh lan dau: ${error.message}`);
    });
  });
  return setIntervalFn(() => {
    refreshCustomerInvoiceLinesIfDue(pool, { log }).catch((error) => {
      log(`[customerInvoiceLinesRefresh] Loi khi kiem tra/tinh lai: ${error.message}`);
    });
  }, intervalMs);
}

async function main() {
  const result = await refreshCustomerInvoiceLines(getPool());
  console.log(`[customerInvoiceLinesRefresh] Hoan tat, ${result.rowCount} dong.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[customerInvoiceLinesRefresh] That bai: ${error.message}`);
    process.exitCode = 1;
  }).finally(() => getPool().end && getPool().end());
}

module.exports = {
  refreshCustomerInvoiceLines,
  refreshCustomerInvoiceLinesIfDue,
  refreshCustomerInvoiceLinesIncremental,
  startCustomerInvoiceLinesSchedule,
  __sql__: {
    FILL_STAGING_SQL, FILL_STAGING_RETURNS_SQL, DELETE_STALE_SQL, INSERT_MISSING_SQL, UPSERT_STATE_SQL, LAST_COMPUTED_SQL,
    CREATE_STAGING_SQL, PLANNER_GUARD_SQL, FILL_STAGING_INCR_SQL, FILL_STAGING_RETURNS_INCR_SQL, CREATE_CHANGED_SQL,
    FILL_CHANGED_SQL, DELETE_STALE_INCR_SQL, DELETE_OUT_OF_WINDOW_SQL, UPDATE_STATE_INCR_SQL, UPSERT_STATE_FULL_SQL,
    READ_STATE_SQL, ADVISORY_LOCK_SQL
  },
  __test__: { vnDateKey, vnMinutesOfDay, computeWindow, isRefreshDue }
};
