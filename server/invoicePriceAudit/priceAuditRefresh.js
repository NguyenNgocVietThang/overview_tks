'use strict';

// Job 23:00 (Asia/Ho_Chi_Minh) "Kiem tra gia ban": cong bo cua so 7 ngay [D-6, D] - tat ca hoac khong.
//
// runDailyAudit({ day, pool, now }):
//   1. Khoa advisory PHIEN (pg_try_advisory_lock, khoa rieng LOCK_KEY) tren 1 ket noi rieng: instance khac dang
//      giu -> 'busy'. Lay khoa TRUOC khi BEGIN de anh chup REPEATABLE READ thay ban cong bo cua instance vua xong.
//   2. Doc state: cung ngay chi hoan thanh luot dem neu last_success_at >= slot 23:00.
//      Lan chay som khong chan luot dem; goi lap truoc 23:00 van bo qua.
//      published_day > day -> 'stale' (khong bao gio dung lai/xoa theo ngay cu hon ban da cong bo).
//   3. BEGIN REPEATABLE READ: captureUnseenInvoices (chi them hoa don chua quet, khong upsert dong cu) ->
//      xoa so danh dau ngoai [day-6, day] (CASCADE xoa dong chup + giai thich/chot + nhat ky) -> upsert state
//      (published_day, window, last_success_at, last_error=NULL, added_invoice_count, version+1) -> COMMIT.
//   4. Loi bat ky: ROLLBACK (ban cu nguyen ven) roi ghi RIENG last_attempt_at/last_error (thong diep an toan,
//      khong stack/chuoi ket noi), KHONG dong vao published_day/window/last_success_at; tra 'failed' (khong nem)
//      de scheduler thu lai sau 5 phut.
//
// Gio: purchase_date la gio dia phuong Kiot gan nhan UTC (xem priceAuditRepository). Slot job tinh tu UTC thuan:
// 23:00 VN = 16:00 UTC, khong dung gio dia phuong cua server.

const { captureUnseenInvoices, SOURCE_NOT_READY } = require('./priceAuditRepository');
const { addDaysToKey, vnDateKey } = require('../kiotvietSync/vnTime');

// Khoa advisory rieng cua tinh nang (20531077 ~ migration 0077), khac cac khoa 205310xx/205311xx da dung.
const LOCK_KEY = 20531077;
const WINDOW_DAYS = 7;
const VN_OFFSET_MS = 7 * 3600 * 1000;
const AUDIT_HOUR_VN = 23;
const DB_ERROR = 'PRICE_AUDIT_DB_ERROR';
const UNKNOWN_ERROR = 'PRICE_AUDIT_FAILED';
const MAX_ERROR_LENGTH = 500;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' hop le tren lich (khong nhan 2026-13-01, 2026-02-30). */
function isValidDay(day) {
  const m = DAY_RE.exec(String(day ?? ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === day;
}

function assertDay(day) {
  if (!isValidDay(day)) throw new TypeError(`runDailyAudit: day phải là YYYY-MM-DD hợp lệ (nhận ${JSON.stringify(day)})`);
}

/** Thoi diem 23:00 VN cua ngay `day` (= 16:00 UTC cung ngay). */
function slotStartUtc(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, AUDIT_HOUR_VN) - VN_OFFSET_MS);
}

/** Ngay cua slot 23:00 VN gan nhat <= now: hom nay (VN) neu da qua 23:00 VN, nguoc lai hom qua. */
function latestDueDay(now) {
  const vnWall = new Date(+new Date(now) + VN_OFFSET_MS); // doc bang getUTC* = gio tuong VN
  const today = vnWall.toISOString().slice(0, 10);
  return vnWall.getUTCHours() >= AUDIT_HOUR_VN ? today : addDaysToKey(today, -1);
}

const windowFromOf = day => addDaysToKey(day, -(WINDOW_DAYS - 1));

const STATE_SQL = `SELECT published_day::text AS published_day, last_success_at FROM invoice_price_audit_state WHERE id`;

// Xoa ca ngay > day (khong the co khi chi chay theo slot tang dan, giu cho dung dinh nghia cua so).
const PRUNE_SQL = `WITH gone AS (
    DELETE FROM invoice_price_audit_invoices WHERE sold_day < $1::date OR sold_day > $2::date RETURNING 1)
  SELECT count(*)::int AS n FROM gone`;

const PUBLISH_SQL = `INSERT INTO invoice_price_audit_state AS s
    (id, published_day, window_from, window_to, last_success_at, last_attempt_at, last_error, added_invoice_count, version)
  VALUES (TRUE, $1::date, $2::date, $1::date, $3::timestamptz, $3::timestamptz, NULL, $4::int, 1)
  ON CONFLICT (id) DO UPDATE SET published_day = EXCLUDED.published_day, window_from = EXCLUDED.window_from,
    window_to = EXCLUDED.window_to, last_success_at = EXCLUDED.last_success_at, last_attempt_at = EXCLUDED.last_attempt_at,
    last_error = NULL, added_invoice_count = EXCLUDED.added_invoice_count, version = s.version + 1`;

// Chi ghi lan thu + loi; KHONG dong published_day / window / last_success_at / version.
const RECORD_FAILURE_SQL = `INSERT INTO invoice_price_audit_state AS s (id, last_attempt_at, last_error)
  VALUES (TRUE, $1::timestamptz, $2::text)
  ON CONFLICT (id) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at, last_error = EXCLUDED.last_error`;

// Dong vua chup trong giao dich dry-run (so danh dau run_day = day va captured_at = now cua lan nay).
const PREVIEW_COUNT_SQL = `SELECT count(*) FILTER (WHERE l.original_status = 'wrong')::int AS wrong_lines
  FROM invoice_price_audit_lines l
  JOIN invoice_price_audit_invoices i ON i.branch = l.branch AND i.invoice_id = l.invoice_id
  WHERE i.run_day = $1::date AND i.captured_at = $2::timestamptz`;
const PREVIEW_PRUNE_SQL = `SELECT count(*)::int AS n FROM invoice_price_audit_invoices
  WHERE sold_day < $1::date OR sold_day > $2::date`;

/** Thong diep loi an toan cho state/UI: khong stack, khong chuoi ket noi/thong tin noi bo. */
function safeFailure(err) {
  if (err && err.code === SOURCE_NOT_READY) {
    return { code: SOURCE_NOT_READY, message: String(err.message || 'Nguồn dữ liệu chưa sẵn sàng.').slice(0, MAX_ERROR_LENGTH) };
  }
  const pgCode = err && typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code) ? err.code : null;
  if (pgCode) return { code: DB_ERROR, message: `Lỗi cơ sở dữ liệu khi chạy kiểm tra giá (mã ${pgCode}).` };
  return { code: UNKNOWN_ERROR, message: 'Lỗi không xác định khi chạy kiểm tra giá.' };
}

function result(status, day, extra = {}) {
  return { status, day, windowFrom: windowFromOf(day), windowTo: day, addedInvoices: 0, addedLines: 0, prunedInvoices: 0, ...extra };
}

/**
 * Cong bo ban kiem tra gia cua ngay `day` ('YYYY-MM-DD', ngay VN cua slot 23:00).
 * @returns {Promise<{ status: 'completed'|'already-completed'|'busy'|'future-day'|'stale'|'failed',
 *   day, windowFrom, windowTo, addedInvoices, addedLines, prunedInvoices, code?, message? }>}
 *   Chi nem khi tham so sai (lap trinh); loi chay tra status 'failed'.
 */
async function runDailyAudit({ day, pool, now = new Date(), capture = captureUnseenInvoices, logger = console } = {}) {
  assertDay(day);
  const nowDate = new Date(now);
  // Cho phep chay tay ngay hom nay truoc 23:00 (lan cong bo dau sau deploy); chi chan ngay TUONG LAI theo gio VN,
  // vi published_day o tuong lai se lam moi slot sau thanh 'stale'.
  if (day > vnDateKey(nowDate)) return result('future-day', day);
  const windowFrom = windowFromOf(day);

  let client = null;
  let locked = false;
  let inTransaction = false;
  let broken = null;
  try {
    client = await pool.connect();
    const lock = await client.query('SELECT pg_try_advisory_lock($1::bigint) AS locked', [LOCK_KEY]);
    locked = lock.rows[0]?.locked === true;
    if (!locked) return result('busy', day);

    const state = (await client.query(STATE_SQL)).rows[0];
    const published = state?.published_day || null;
    const slot = slotStartUtc(day);
    if (published === day && (nowDate < slot ||
        (state.last_success_at && +new Date(state.last_success_at) >= +slot))) {
      return result('already-completed', day);
    }
    if (published && published > day) return result('stale', day, { publishedDay: published });

    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    inTransaction = true;
    const { addedInvoices, addedLines } = await capture({ day, client, now: nowDate });
    const prunedInvoices = (await client.query(PRUNE_SQL, [windowFrom, day])).rows[0].n;
    await client.query(PUBLISH_SQL, [day, windowFrom, nowDate.toISOString(), addedInvoices]);
    await client.query('COMMIT');
    inTransaction = false;
    logger.info?.(`[PriceAudit] Cong bo ${windowFrom}..${day}: them ${addedInvoices} hoa don / ${addedLines} dong, xoa ${prunedInvoices} hoa don het han.`);
    return result('completed', day, { addedInvoices, addedLines, prunedInvoices });
  } catch (err) {
    if (inTransaction) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) { broken = rollbackError; }
      inTransaction = false;
    }
    const failure = safeFailure(err);
    logger.error?.(`[PriceAudit] Ngay ${day} that bai: ${failure.code} ${err && err.code ? `(${err.code})` : ''} ${failure.message}`);
    if (client && !broken) {
      try {
        await client.query(RECORD_FAILURE_SQL, [nowDate.toISOString(), failure.message]);
      } catch (recordError) {
        logger.error?.(`[PriceAudit] Khong ghi duoc trang thai loi: ${recordError && recordError.code ? recordError.code : 'UNKNOWN'}`);
      }
    }
    return result('failed', day, failure);
  } finally {
    if (client) {
      if (locked && !broken) {
        try { await client.query('SELECT pg_advisory_unlock($1::bigint)', [LOCK_KEY]); } catch (unlockError) { broken = unlockError; }
      }
      // Ket noi hong/khoa chua nha -> huy ket noi (release(err)) de khoa phien tu nha.
      client.release(broken || undefined);
    }
  }
}

/**
 * Dry-run: chay dung buoc chup trong giao dich roi ROLLBACK - khong ghi gi (ke ca state/last_error).
 * Nem loi nguyen ban (vd SOURCE_NOT_READY) cho CLI in ra.
 */
async function previewDailyAudit({ day, pool, now = new Date(), capture = captureUnseenInvoices } = {}) {
  assertDay(day);
  const nowDate = new Date(now);
  const windowFrom = windowFromOf(day);
  const client = await pool.connect();
  let broken = null;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try {
      const publishedDay = (await client.query(STATE_SQL)).rows[0]?.published_day || null;
      const { addedInvoices, addedLines } = await capture({ day, client, now: nowDate });
      const { wrong_lines: wrongLines } = (await client.query(PREVIEW_COUNT_SQL, [day, nowDate.toISOString()])).rows[0];
      const prunedInvoices = (await client.query(PREVIEW_PRUNE_SQL, [windowFrom, day])).rows[0].n;
      return { mode: 'dry-run', day, windowFrom, windowTo: day, publishedDay, addedInvoices, addedLines, wrongLines, prunedInvoices };
    } finally {
      try { await client.query('ROLLBACK'); } catch (rollbackError) { broken = rollbackError; }
    }
  } finally {
    client.release(broken || undefined);
  }
}

module.exports = {
  LOCK_KEY,
  WINDOW_DAYS,
  runDailyAudit,
  previewDailyAudit,
  slotStartUtc,
  latestDueDay,
  isValidDay,
  safeFailure
};
