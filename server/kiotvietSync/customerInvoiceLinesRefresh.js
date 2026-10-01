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
// LUU Y MUI GIO / TRANG THAI: giong quy uoc dashboardRollupRefresh.js - purchase_date
// luu "gio treo tuong VN mang nhan UTC" (doc bang AT TIME ZONE 'UTC'); moc "hom
// nay" lay tu dong ho that theo lich VN; trang thai loc theo statusValue (chuoi
// that), KHONG loc theo so status.

if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* dotenv là tùy chọn trong môi trường production */ }
}

const { getPool } = require('../db/pool');
const { DETAIL_AMOUNT_SQL, RETURN_AMOUNT_SQL } = require('../dashboard/customerProductTopRepository');
const { vnDateKey, vnMinutesOfDay, addDaysToKey } = require('./vnTime');

const BRANCH_CODES = Object.freeze(['hanoi', 'saigon']);
const WINDOW_DAYS = 90;
const SETTLE_MINUTES_AFTER_MIDNIGHT = 10;
const REFRESH_WORK_MEM = '32MB';

// Cung dinh nghia voi normalizeSearchValue() cua dashboardData.js (NFKC, bo ky tu
// rong, gop khoang trang, trim, chu thuong) de doi chieu ten khach hang y nhu
// luong doc sheet cu.
function normalizedNameSql(expression) {
  return `lower(btrim(regexp_replace(regexp_replace(normalize(${expression}, NFKC), '[\\u200B-\\u200D\\uFEFF]', '', 'g'), '\\s+', ' ', 'g')))`;
}

// Y het cot "Trạng thái" cua tab Hoa don (dashboardPgReader.js statusLabel() voi
// INVOICE_STATUS_FALLBACK): uu tien statusValue that, bang tra so chi la du phong.
const INVOICE_STATUS_SQL = `COALESCE(NULLIF(i.raw->>'statusValue', ''),
    CASE i.status WHEN 1 THEN 'Hoàn thành' WHEN 2 THEN 'Đã hủy' WHEN 3 THEN 'Đang xử lý'
      ELSE COALESCE(i.status::text, '') END)`;

const CREATE_STAGING_SQL = `
  CREATE TEMP TABLE customer_invoice_lines_new
    (LIKE customer_invoice_lines_90d) ON COMMIT DROP`;

// $1 co so (text[]), $2 ngay dau cua so, $3 ngay cuoi cua so (ca hai 'YYYY-MM-DD').
//
// Luong doc sheet cu (computeCustomerProductRevenue) doi chieu ma khach nhu sau,
// va o day GIU NGUYEN: ma tren hoa don (customerCode); neu trong thi tim ma khach
// trong bang customers cung co so theo ten chuan hoa (ten trung => ma lon nhat,
// vi cu duyet theo thu tu ma va dong sau de dong truoc). Buoc doi chieu theo SDT
// cua luong cu KHONG co o day: cot "SĐT khách" cua tab Hoa don luon rong trong
// Postgres (dashboardPgReader.js, hang MISSING) nen buoc do khong bao gio khop.
const CUSTOMER_BY_NAME_CTE = `
  WITH customer_by_name AS (
    SELECT DISTINCT ON (branch, name_key) branch, name_key, code
    FROM (
      SELECT branch, btrim(code) AS code, code AS raw_code,
             ${normalizedNameSql('name')} AS name_key
      FROM customers
      WHERE branch = ANY($1::text[])
        AND btrim(COALESCE(code, '')) <> ''
        AND btrim(COALESCE(name, '')) <> ''
    ) named
    ORDER BY branch, name_key, raw_code DESC
  )`;

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
    COALESCE(NULLIF(btrim(i.raw->>'customerCode'), ''), cbn.code),
    COALESCE(NULLIF(i.raw->>'customerName', ''), 'Khách lẻ'),
    COALESCE(NULLIF(d.raw->>'productCode', ''), p.code, ''),
    COALESCE(NULLIF(d.raw->>'productName', ''), p.name, ''),
    COALESCE(d.quantity, 0)::numeric,
    (${DETAIL_AMOUNT_SQL})::numeric
  FROM invoices i
  JOIN invoice_details d ON d.branch = i.branch AND d.invoice_id = i.id
  LEFT JOIN products p ON p.branch = d.branch AND p.id = d.product_id
  LEFT JOIN customer_by_name cbn
    ON cbn.branch = i.branch
   AND cbn.name_key = ${normalizedNameSql(`COALESCE(NULLIF(i.raw->>'customerName', ''), 'Khách lẻ')`)}
  WHERE i.branch = ANY($1::text[])
    AND i.purchase_date >= ($2::date::timestamp AT TIME ZONE 'UTC')
    AND i.purchase_date <  (($3::date + 1)::timestamp AT TIME ZONE 'UTC')
    AND ${INVOICE_STATUS_SQL} = 'Hoàn thành'
    AND btrim(i.code) <> ''
    AND COALESCE(NULLIF(btrim(i.raw->>'customerCode'), ''), cbn.code) IS NOT NULL`;

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
    COALESCE(NULLIF(btrim(r.raw->>'customerCode'), ''), cbn.code),
    COALESCE(NULLIF(r.raw->>'customerName', ''), 'Khách lẻ'),
    COALESCE(NULLIF(rd.raw->>'productCode', ''), p.code, ''),
    COALESCE(NULLIF(rd.raw->>'productName', ''), p.name, ''),
    -abs(COALESCE(rd.quantity, 0))::numeric,
    -(${RETURN_AMOUNT_SQL})::numeric
  FROM returns r
  JOIN return_details rd ON rd.branch = r.branch AND rd.return_id = r.id
  LEFT JOIN products p ON p.branch = rd.branch AND p.id = rd.product_id
  LEFT JOIN customer_by_name cbn
    ON cbn.branch = r.branch
   AND cbn.name_key = ${normalizedNameSql(`COALESCE(NULLIF(r.raw->>'customerName', ''), 'Khách lẻ')`)}
  WHERE r.branch = ANY($1::text[])
    AND r.return_date >= ($2::date::timestamp AT TIME ZONE 'UTC')
    AND r.return_date <  (($3::date + 1)::timestamp AT TIME ZONE 'UTC')
    AND r.raw->>'statusValue' = 'Đã trả'
    AND btrim(r.code) <> ''
    AND COALESCE(NULLIF(btrim(r.raw->>'customerCode'), ''), cbn.code) IS NOT NULL`;

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

// $1 ngay dau cua so, $2 ngay cuoi cua so.
const UPSERT_STATE_SQL = `
  INSERT INTO customer_invoice_lines_state (id, window_start, window_end, row_count, computed_at)
  VALUES (1, $1::date, $2::date, (SELECT count(*) FROM customer_invoice_lines_90d), now())
  ON CONFLICT (id) DO UPDATE
    SET window_start = EXCLUDED.window_start, window_end = EXCLUDED.window_end,
        row_count = EXCLUDED.row_count, computed_at = EXCLUDED.computed_at
  RETURNING row_count`;

const LAST_COMPUTED_SQL = 'SELECT computed_at FROM customer_invoice_lines_state WHERE id = 1';

/** 90 ngay ket thuc HOM QUA (theo lich VN): {start, end} dang 'YYYY-MM-DD'. */
function computeWindow(now = new Date()) {
  const end = addDaysToKey(vnDateKey(now), -1);
  return { start: addDaysToKey(end, -(WINDOW_DAYS - 1)), end };
}

/**
 * Dung lai bang chi tiet 90 ngay trong 1 giao dich (loi giua chung => ROLLBACK,
 * bang van la ban cu, khong co trang thai "nua voi").
 */
async function refreshCustomerInvoiceLines(pool, { log = console.log, now = () => new Date() } = {}) {
  const window = computeWindow(now());
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL work_mem = '${REFRESH_WORK_MEM}'`);
    await client.query(CREATE_STAGING_SQL);
    await client.query(FILL_STAGING_SQL, [BRANCH_CODES, window.start, window.end]);
    await client.query(FILL_STAGING_RETURNS_SQL, [BRANCH_CODES, window.start, window.end]);
    const deleted = await client.query(DELETE_STALE_SQL);
    const inserted = await client.query(INSERT_MISSING_SQL);
    const state = await client.query(UPSERT_STATE_SQL, [window.start, window.end]);
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
 * Den han khi: chua tung dung, hoac lan dung gan nhat KHONG phai ngay VN hom nay
 * VA da qua SETTLE_MINUTES_AFTER_MIDNIGHT phut dau ngay (cho hoa don cuoi ngay hom
 * truoc kip dong bo). Khoi dong lai giua ngay ma bang cu tu hom qua => dung ngay.
 */
function isRefreshDue(lastComputedAt, now) {
  if (!lastComputedAt) return true;
  if (vnDateKey(new Date(lastComputedAt)) === vnDateKey(now)) return false;
  return vnMinutesOfDay(now) >= SETTLE_MINUTES_AFTER_MIDNIGHT;
}

async function refreshCustomerInvoiceLinesIfDue(pool, { log = console.log, now = () => new Date() } = {}) {
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
  startCustomerInvoiceLinesSchedule,
  __sql__: { FILL_STAGING_SQL, FILL_STAGING_RETURNS_SQL, DELETE_STALE_SQL, INSERT_MISSING_SQL, UPSERT_STATE_SQL, LAST_COMPUTED_SQL, CREATE_STAGING_SQL },
  __test__: { vnDateKey, vnMinutesOfDay, computeWindow, isRefreshDue }
};
