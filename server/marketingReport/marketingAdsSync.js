'use strict';

// ==========================================
// CHI PHI ADS — doc workbook Google Sheets "Chi phi ADS" THEO CHU KY roi ghi vao Postgres
// (bang marketing_ads_costs, migration 0069); bao cao chi phi chi doc bang DB, khong goi Sheets luc request.
// Khuon theo sheetSnapshots/sync.js: khoa advisory chung giua cac instance, cong "chua den han" luu o DB
// (khoi dong lai khong don Sheets), GHI KHAC BIET (sheet khong doi => 0 dong ghi), chot an toan khi so dong
// tut manh, loi giu nguyen ban thanh cong gan nhat va chi ghi thong bao an toan.
// Doc: readAdsCosts() fail-soft — thieu bang / chua dong bo / qua cu / bang rong => null => bao cao lui ve
// doc Sheets nhu cu.
// ==========================================

const CONFIG = require('../config');
const { getPool } = require('../db/pool');
const parsers = require('./marketingParsers');

const LOCK_KEY = 20531104;
const SHRINK_GUARD_RATIO = 0.7;
const MIN_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const DEFAULT_READ_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const SAFE_ERROR = 'Không đọc hoặc lưu được chi phí ADS từ Google Sheets. Đang giữ lần đồng bộ thành công gần nhất.';
const HELD_ERROR = 'Số dòng chi phí giảm mạnh bất thường; đang chờ xác nhận ở lần đọc kế tiếp. Giữ nguyên bản thành công gần nhất.';

const intervalFromEnv = () => {
  const value = Number(process.env.MARKETING_ADS_SYNC_INTERVAL_MS);
  return Number.isFinite(value) && value >= MIN_INTERVAL_MS ? value : DEFAULT_INTERVAL_MS;
};
const readMaxAgeFromEnv = () => {
  const value = Number(process.env.MARKETING_ADS_READ_MAX_AGE_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_READ_MAX_AGE_MS;
};

const COLUMNS = ['row_key', 'sheet_order', 'block', 'source_row', 'kind', 'sheet', 'page', 'month', 'date_text',
  'ad_cost', 'total_cost', 'messages', 'cost_per_message', 'phones', 'cost_per_phone', 'total_label'];

const numberOrNull = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);

// Doc ca workbook => cac khoi parseCosts (cung nguon voi duong doc Sheets cua marketingReportService).
async function readWorkbook(client) {
  const titles = await client.listSheetTitles();
  const names = titles.filter(title => parsers.COST_PAGES[parsers.norm(title)]);
  if (!names.length) throw Object.assign(new Error('Không tìm thấy các tab chi phí ADS.'), { code: 'MARKETING_HEADERS_MISSING' });
  const blocks = await Promise.all(names.map(async title =>
    parsers.parseCosts(await client.getValues(title, { valueRenderOption: 'UNFORMATTED_VALUE' }), title)));
  return { names, blocks };
}

// parseCosts() -> dong bang. Thu tu doc lai = (thu tu tab trong workbook, khoi, dong) = thu tu duong doc Sheets.
function toDbRows(blocks) {
  const byKey = new Map();
  blocks.forEach((block, sheetOrder) => {
    for (const [kind, records] of [['daily', block.rows], ['total', block.totals]]) {
      for (const record of records) {
        const [sheet, sourceRow, blockIndex] = JSON.parse(record.key);
        byKey.set(record.key, {
          row_key: record.key, sheet_order: sheetOrder, block: Number(blockIndex), source_row: sourceRow, kind, sheet,
          page: record.page, month: Number.isInteger(record.month) ? record.month : null, date_text: record.date || '',
          ad_cost: numberOrNull(record.adCost), total_cost: numberOrNull(record.totalCost), messages: numberOrNull(record.messages),
          cost_per_message: numberOrNull(record.costPerMessage), phones: numberOrNull(record.phones),
          cost_per_phone: numberOrNull(record.costPerPhone), total_label: record.totalLabel || ''
        });
      }
    }
  });
  return [...byKey.values()];
}

// Trang thai "cho xac nhan so dong tut" trong bo nho tien trinh (giong sheetSnapshots).
const pendingShrink = { fingerprint: null };

const STAGE_SQL = {
  create: 'CREATE TEMP TABLE marketing_ads_stage (LIKE marketing_ads_costs) ON COMMIT DROP',
  fill: 'INSERT INTO marketing_ads_stage SELECT * FROM jsonb_populate_recordset(NULL::marketing_ads_costs, $1::jsonb)',
  count: 'SELECT count(*)::int AS n FROM marketing_ads_costs',
  remove: `DELETE FROM marketing_ads_costs l WHERE NOT EXISTS (SELECT 1 FROM marketing_ads_stage n WHERE n.row_key = l.row_key)`,
  // Chi dong MOI hoac KHAC toi INSERT (Postgres khoa tung dong trung khoa truoc khi xet WHERE cua ON CONFLICT,
  // nen loc o SELECT — bai hoc su co Disk IO 2026-09-28). ROW() so sanh ca dong nen numeric 1.0 = 1.
  upsert: `INSERT INTO marketing_ads_costs SELECT n.* FROM marketing_ads_stage n
    LEFT JOIN marketing_ads_costs l ON l.row_key = n.row_key
    WHERE l.row_key IS NULL OR ROW(n.*) IS DISTINCT FROM ROW(l.*)
    ON CONFLICT (row_key) DO UPDATE SET ${COLUMNS.filter(c => c !== 'row_key').map(c => `${c} = EXCLUDED.${c}`).join(', ')}`
};

async function refreshAdsCosts({
  pool = getPool(), client, now = () => new Date(), logger = console, intervalMs = intervalFromEnv(), force = false
} = {}) {
  const spreadsheetId = CONFIG.MARKETING_ADS_SPREADSHEET_ID;
  if (!client && !spreadsheetId) return { status: 'disabled' };
  const sheetsClient = client || require('../sheets/sheetsClient').createReadOnlyClient(() => CONFIG.MARKETING_ADS_SPREADSHEET_ID, 'Chi phí ADS');
  const connection = await pool.connect();
  let locked = false;
  let transaction = false;
  let attempted = false;
  let brokenConnection = null;
  let nextAttemptAt = null;
  const started = Date.now();
  try {
    const lock = await connection.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_KEY]);
    locked = Boolean(lock.rows[0]?.locked);
    if (!locked) return { status: 'busy' };
    const { rows: stateRows } = await connection.query(
      'SELECT last_attempt_at, last_success_at FROM marketing_ads_sync_state WHERE id = 1');
    const attemptAt = now();
    const previous = new Date(stateRows[0]?.last_attempt_at || stateRows[0]?.last_success_at || 0).getTime();
    if (!force && previous && attemptAt.getTime() - previous < intervalMs) {
      return { status: 'not-due', nextAttemptAt: previous + intervalMs };
    }
    nextAttemptAt = attemptAt.getTime() + intervalMs;
    attempted = true;
    await connection.query(`INSERT INTO marketing_ads_sync_state (id, last_attempt_at) VALUES (1, $1)
      ON CONFLICT (id) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at`, [attemptAt]);

    const { blocks } = await readWorkbook(sheetsClient);
    const rows = toDbRows(blocks);

    await connection.query('BEGIN'); transaction = true;
    await connection.query(STAGE_SQL.create);
    await connection.query(STAGE_SQL.fill, [JSON.stringify(rows)]);
    const previousRows = Number((await connection.query(STAGE_SQL.count)).rows[0]?.n) || 0;
    if (previousRows > 0 && rows.length < previousRows * SHRINK_GUARD_RATIO) {
      const candidate = JSON.stringify(rows);
      if (pendingShrink.fingerprint !== candidate) {
        pendingShrink.fingerprint = candidate;
        await connection.query('ROLLBACK'); transaction = false;
        await connection.query('UPDATE marketing_ads_sync_state SET last_error = $1 WHERE id = 1', [HELD_ERROR]);
        logger.error('[MarketingAds] Held abnormal shrink', { previousRows, rows: rows.length });
        return { status: 'held', previousRows, rowCount: rows.length, nextAttemptAt };
      }
    }
    pendingShrink.fingerprint = null;
    const removed = (await connection.query(STAGE_SQL.remove)).rowCount || 0;
    const written = (await connection.query(STAGE_SQL.upsert)).rowCount || 0;
    const changed = removed + written > 0;
    await connection.query(`UPDATE marketing_ads_sync_state SET last_success_at = $1, last_error = NULL, row_count = $2,
      version = version + $3 WHERE id = 1`, [now(), rows.length, changed ? 1 : 0]);
    await connection.query('COMMIT'); transaction = false;
    logger.info?.(changed ? '[MarketingAds] Updated' : '[MarketingAds] Unchanged',
      { rows: rows.length, written, deleted: removed, durationMs: Date.now() - started });
    return { status: changed ? 'updated' : 'unchanged', rowCount: rows.length, written, deleted: removed, nextAttemptAt };
  } catch (error) {
    if (transaction) {
      try { await connection.query('ROLLBACK'); } catch (rollbackError) { brokenConnection = rollbackError; }
      transaction = false;
    }
    if (attempted && !brokenConnection) {
      // Thieu migration / loi Google khong duoc lam sap server hay lo chi tiet request/auth.
      await connection.query('UPDATE marketing_ads_sync_state SET last_error = $1 WHERE id = 1', [SAFE_ERROR]).catch(() => {});
    }
    logger.error('[MarketingAds] Refresh failed', { code: error.code || 'SOURCE_OR_DATABASE_FAILURE', durationMs: Date.now() - started });
    return { status: 'failed', nextAttemptAt };
  } finally {
    try {
      if (locked && !brokenConnection) await connection.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    } catch (unlockError) {
      brokenConnection = unlockError;
      logger.error('[MarketingAds] Discarding connection after lock release failure.');
    } finally {
      // Khong tra ve pool mot phien co trang thai khoa/transaction khong ro.
      connection.release(brokenConnection || undefined);
    }
  }
}

function startAdsSchedule({
  refresh = refreshAdsCosts, intervalMs = intervalFromEnv(), enabled = () => Boolean(CONFIG.MARKETING_ADS_SPREADSHEET_ID),
  setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, now = Date.now, logger = console
} = {}) {
  let stopped = false;
  let running = false;
  let timer = null;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    let result;
    try { result = await refresh({ intervalMs }); }
    catch { logger.error('[MarketingAds] Scheduler failed; will retry next cycle.'); }
    finally {
      running = false;
      if (!stopped) {
        const delay = result?.nextAttemptAt ? Math.max(1000, result.nextAttemptAt - now()) : intervalMs;
        timer = setTimeoutFn(tick, delay);
        timer?.unref?.();
      }
    }
  };
  const ready = enabled() ? tick() : Promise.resolve();
  return { ready, stop() { stopped = true; if (timer !== null) clearTimeoutFn(timer); timer = null; } };
}

// ---- Doc (fail-soft) -------------------------------------------------------------------------------------------
const ADS_SELECT = `SELECT row_key, kind, page, month, date_text, ad_cost, total_cost, messages, cost_per_message, phones,
  cost_per_phone, total_label FROM marketing_ads_costs WHERE month = $1 ORDER BY sheet_order, block, source_row`;
const num = value => (value == null ? null : Number(value));

// Tra ve { rows, totals, readAt } cho thang `month` (so 1..12) — dung hinh dang parseCosts() — hoac null khi phai lui
// ve Sheets (thieu bang, chua dong bo, qua cu, bang rong, loi DB).
async function readAdsCosts({ pool = getPool(), month, now = Date.now, maxAgeMs = readMaxAgeFromEnv() } = {}) {
  try {
    const { rows: [state] } = await pool.query('SELECT last_success_at, row_count FROM marketing_ads_sync_state WHERE id = 1');
    if (!state?.last_success_at || !(Number(state.row_count) > 0)) return null;
    const readAt = new Date(state.last_success_at);
    if (!Number.isFinite(readAt.getTime()) || now() - readAt.getTime() > maxAgeMs) return null;
    const { rows } = await pool.query(ADS_SELECT, [month]);
    const rowsOut = [];
    const totals = [];
    for (const r of rows) {
      const record = {
        key: r.row_key, page: r.page, date: r.date_text, month: r.month == null ? null : Number(r.month),
        adCost: num(r.ad_cost), totalCost: num(r.total_cost), messages: num(r.messages), costPerMessage: num(r.cost_per_message),
        phones: num(r.phones), costPerPhone: num(r.cost_per_phone), totalLabel: r.total_label
      };
      (r.kind === 'total' ? totals : rowsOut).push(record);
    }
    return { rows: rowsOut, totals, readAt };
  } catch {
    // 42P01 (chua migrate) hay loi ket noi: bao cao tu lui ve Sheets.
    return null;
  }
}

function createAdsStore({ pool, now = Date.now } = {}) {
  return { read: month => readAdsCosts({ pool: pool || getPool(), month, now }) };
}

module.exports = {
  refreshAdsCosts, startAdsSchedule, readAdsCosts, createAdsStore, toDbRows, readWorkbook,
  __test__: { pendingShrink, LOCK_KEY }
};
