'use strict';
const { randomUUID } = require('node:crypto');
const CONFIG = require('../config');
const { getPool } = require('../db/pool');
const { createReadOnlyClient } = require('../sheets/sheetsClient');
const { SHEET_NAMES, INTERVAL_MS, parseContainerSheet } = require('./parser');
const LOCK_KEY = 20531015;
const SAFE_ERROR = 'Không đọc hoặc lưu được đủ 6 sheet CONT. Giữ nguyên bản thành công gần nhất.';

// true khi tap dong sheet moi GIONG HET bang hien tai (cung so dong, tung dong theo khoa (sheet,source_row)
// khong khac cot nao) va canh bao khong doi. ROW(i.*) so sanh ca dong cung kieu bang nen numeric 1.0 = 1.
const UNCHANGED_SQL = `WITH incoming AS (
    SELECT * FROM jsonb_populate_recordset(NULL::product_container_lines,$1::jsonb)
  )
  SELECT (SELECT count(*) FROM incoming) = (SELECT count(*) FROM product_container_lines)
    AND NOT EXISTS (
      SELECT 1 FROM incoming i
      LEFT JOIN product_container_lines l ON l.sheet_name = i.sheet_name AND l.source_row = i.source_row
      WHERE l.sheet_name IS NULL OR ROW(i.*) IS DISTINCT FROM ROW(l.*))
    AND COALESCE((SELECT version IS NOT NULL AND warnings = $2::jsonb
                  FROM product_container_sync WHERE singleton = true), false) AS unchanged`;

async function refreshContainers({
  pool = getPool(), spreadsheetId = CONFIG.PRODUCT_CONTAINER_SPREADSHEET_ID,
  client = createReadOnlyClient(() => spreadsheetId, 'Hàng dự kiến'),
  now = () => new Date(), logger = console
} = {}) {
  if (!spreadsheetId) return { status: 'disabled' };
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
    const { rows } = await connection.query('SELECT last_attempt_at,last_success_at FROM product_container_sync WHERE singleton = true');
    const attemptAt = now();
    // Also gate on attempts, so restarts after a failed first run cannot hammer
    // Sheets. This same persisted gate serializes staggered server instances.
    const previous = new Date(rows[0]?.last_attempt_at || rows[0]?.last_success_at || 0).getTime();
    if (previous && attemptAt.getTime() - previous < INTERVAL_MS) return { status: 'not-due', nextAttemptAt:previous + INTERVAL_MS };
    nextAttemptAt = attemptAt.getTime() + INTERVAL_MS;
    attempted = true;
    await connection.query('UPDATE product_container_sync SET last_attempt_at=$1 WHERE singleton=true',[attemptAt]);
    const titles = await client.listSheetTitles();
    if (SHEET_NAMES.some(title => !titles.includes(title))) throw new Error('CONTAINER_SHEET_MISSING');
    // All calls settle before releasing the shared lock, including failures.
    const reads = await Promise.allSettled(SHEET_NAMES.map(async (sheetName) => {
      const pair = await Promise.allSettled([
        client.getValues(sheetName,{valueRenderOption:'UNFORMATTED_VALUE',cellRange:'A:X'}),
        client.getValues(sheetName,{valueRenderOption:'FORMATTED_VALUE',cellRange:'A:X'})
      ]);
      if (pair.some(result => result.status === 'rejected')) throw new Error('CONTAINER_SHEET_READ_FAILED');
      return parseContainerSheet(sheetName,pair[0].value,pair[1].value);
    }));
    if (reads.some(result=>result.status==='rejected')) throw new Error('CONTAINER_SOURCE_READ_FAILED');
    const parsed = reads.map(result=>result.value);
    const warnings = parsed.flatMap(sheet=>sheet.warnings);
    const lines = parsed.flatMap((sheet,sheetOrder)=>sheet.rows.map(row=>({
      sheet_name:row.sheetName,sheet_order:sheetOrder,container_row:row.containerRow,source_row:row.sourceRow,
      product_code:row.productCode,product_key:row.productKey,container_name:row.containerName,
      status:row.status,status_label:row.statusLabel,eta:row.eta,color:row.color,sale_note:row.saleNote,
      ordered_by:row.orderedBy,listed_at:row.listedAt,units_per_package:row.unitsPerPackage,
      package_count:row.packageCount,quantity:row.quantity,vietnam_price:row.vietnamPrice
    })));
    await connection.query('BEGIN'); transaction = true;
    // Noi dung sheet khong doi => KHONG xoa/nap lai 11K dong va GIU NGUYEN `version`. Client so `version`
    // de quyet dinh tai lai ca bao cao hang hoa (10,9K dong); neu moi lan sync deu doi version thi rut chu ky
    // xuong 10 phut se bat moi nguoi xem tai lai + ghi WAL lien tuc du khong co gi moi (xem
    // docs/superpowers/specs/2026-10-16-realtime-customer-product-reports-design.md muc 3.C).
    const same = await connection.query(UNCHANGED_SQL,[JSON.stringify(lines),JSON.stringify(warnings)]);
    if (same.rows[0]?.unchanged === true) {
      await connection.query(`UPDATE product_container_sync SET last_success_at=$1,
        last_attempt_at=$2,last_error=NULL WHERE singleton=true`,[now(),attemptAt]);
      await connection.query('COMMIT'); transaction = false;
      logger.info('[ProductContainers] Unchanged', { durationMs:Date.now()-started, rows:lines.length });
      return { status:'unchanged',rowCount:lines.length,nextAttemptAt };
    }
    await connection.query('DELETE FROM product_container_lines');
    if (lines.length) await connection.query(`INSERT INTO product_container_lines
      SELECT * FROM jsonb_populate_recordset(NULL::product_container_lines,$1::jsonb)`,[JSON.stringify(lines)]);
    const version = randomUUID();
    await connection.query(`UPDATE product_container_sync SET version=$1,last_success_at=$2,
      last_attempt_at=$3,last_error=NULL,warnings=$4::jsonb WHERE singleton=true`,[version,now(),attemptAt,JSON.stringify(warnings)]);
    await connection.query('COMMIT'); transaction = false;
    logger.info('[ProductContainers] Updated', { durationMs:Date.now()-started, sheets:SHEET_NAMES.map((sheetName,index)=>({sheetName,rows:parsed[index].rows.length,skipped:parsed[index].warnings.length})),version });
    return { status:'updated',version,rowCount:lines.length,nextAttemptAt };
  } catch (error) {
    if (transaction) {
      try { await connection.query('ROLLBACK'); }
      catch (rollbackError) { brokenConnection = rollbackError; }
      transaction = false;
    }
    if (attempted && !brokenConnection) {
      // Missing migration must not crash server startup or expose raw SQL/auth.
      await connection.query('UPDATE product_container_sync SET last_error=$1 WHERE singleton=true',[SAFE_ERROR]).catch(()=>{});
    }
    logger.error('[ProductContainers] Refresh failed', {code:error.code || 'SOURCE_OR_DATABASE_FAILURE',durationMs:Date.now()-started});
    return { status:'failed',nextAttemptAt };
  } finally {
    try {
      if (locked && !brokenConnection) await connection.query('SELECT pg_advisory_unlock($1)',[LOCK_KEY]);
    } catch (unlockError) {
      brokenConnection = unlockError;
      logger.error('[ProductContainers] Discarding connection after lock release failure.');
    } finally {
      // Never return a session with an unknown advisory-lock/transaction state
      // to the pool. pg destroys it when release receives an error.
      connection.release(brokenConnection || undefined);
    }
  }
}

function startContainerSchedule({
  spreadsheetId = CONFIG.PRODUCT_CONTAINER_SPREADSHEET_ID, refresh = refreshContainers,
  setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, now = Date.now, logger = console
} = {}) {
  if (!spreadsheetId) return { ready:Promise.resolve(),stop(){} };
  let running = false;
  let stopped = false;
  let timer;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    let result;
    try { result = await refresh({spreadsheetId}); }
    catch { logger.error('[ProductContainers] Scheduler failed; will retry next cycle.'); }
    finally {
      running = false;
      if (!stopped) {
        const delay = result?.nextAttemptAt ? Math.max(1,result.nextAttemptAt-now()) : INTERVAL_MS;
        timer = setTimeoutFn(tick,delay);
        timer.unref?.();
      }
    }
  };
  const ready = tick();
  return {ready,stop(){stopped=true;if(timer)clearTimeoutFn(timer);}};
}
module.exports = { refreshContainers, startContainerSchedule, __sql__: { UNCHANGED_SQL } };
