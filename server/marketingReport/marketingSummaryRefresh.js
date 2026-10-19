'use strict';

// ==========================================
// BANG GOP SDT PANCAKE (marketing_phone_summary, migration 0069), dung CUOI MOI LUOT DONG BO Pancake.
// Bao cao Marketing (che do pancake) truoc day keo TOAN BO quan sat (~22k dong) vao RAM roi gop bang JS
// moi request. Nay job nay gop MOT LAN bang dung ham aggregateIndependentPhones() (khong anh xa nhan vien —
// bang anh xa doi luc nao cung duoc nen ap luc doc), ghi KHAC BIET vao bang, web chi doc bang.
// Fail-soft: thieu migration / loi DB => bo qua, khong lam hong luot dong bo; phia doc lui ve gop JS neu bang
// thieu hoac cu (marketing_phone_summary_state.max_source_order lech voi bang quan sat).
// ==========================================

const { aggregateIndependentPhones } = require('./marketingAggregation');

const ADVISORY_LOCK_KEY = 20531105;
const CHUNK = 2000;
const COLUMNS = ['page_id', 'phone_key', 'first_order', 'phone', 'first_employee', 'current_employee', 'repeat_employee',
  'first_at', 'current_at', 'repeat_at', 'trace'];

const SQL = {
  create: 'CREATE TEMP TABLE marketing_phone_summary_stage (LIKE marketing_phone_summary) ON COMMIT DROP',
  fill: 'INSERT INTO marketing_phone_summary_stage SELECT * FROM jsonb_populate_recordset(NULL::marketing_phone_summary, $1::jsonb)',
  count: 'SELECT count(*)::int AS n FROM marketing_phone_summary',
  remove: `DELETE FROM marketing_phone_summary s WHERE NOT EXISTS (
    SELECT 1 FROM marketing_phone_summary_stage n WHERE n.page_id = s.page_id AND n.phone_key = s.phone_key)`,
  // Chi dong MOI hoac KHAC toi INSERT (loc o SELECT, khong dua vao WHERE cua ON CONFLICT: xem bai hoc Disk IO 2026-09-28).
  upsert: `INSERT INTO marketing_phone_summary SELECT n.* FROM marketing_phone_summary_stage n
    LEFT JOIN marketing_phone_summary s ON s.page_id = n.page_id AND s.phone_key = n.phone_key
    WHERE s.page_id IS NULL OR ROW(n.*) IS DISTINCT FROM ROW(s.*)
    ON CONFLICT (page_id, phone_key) DO UPDATE SET ${COLUMNS.filter(c => !['page_id', 'phone_key'].includes(c)).map(c => `${c} = EXCLUDED.${c}`).join(', ')}`,
  state: `INSERT INTO marketing_phone_summary_state (id, built_at, max_source_order, observation_count, phone_count, periods, employee_raws, version)
    VALUES (1, now(), $1::bigint, $2, $3, $4::text[], $5::text[], 1)
    ON CONFLICT (id) DO UPDATE SET built_at = EXCLUDED.built_at, max_source_order = EXCLUDED.max_source_order,
      observation_count = EXCLUDED.observation_count, phone_count = EXCLUDED.phone_count, periods = EXCLUDED.periods,
      employee_raws = EXCLUDED.employee_raws, version = marketing_phone_summary_state.version + $6`
};

const unique = values => [...new Set(values.filter(Boolean))].sort();

// trace luu dang mang gon [id, source_order, fact_id, run_id, source_key, observed_at] (~3 lan nho hon dang object):
// bang chi tiet ~30k quan sat nen moi byte deu thanh egress. expandTrace() dung lai dung dang object cua duong gop JS.
const compactTrace = trace => trace.map(t => [t.id ?? null, t.sourceOrder, t.factId ?? null, t.runId ?? null, t.sourceKey, t.observedAt]);
const expandTrace = trace => (Array.isArray(trace) ? trace : []).map(t => ({
  origin: 'pancake-independent', id: t[0] ?? null, sourceOrder: t[1], factId: t[2] ?? null, runId: t[3] ?? null, sourceKey: t[4], observedAt: t[5]
}));

// Dong gop (aggregateIndependentPhones, chua anh xa) -> dong bang. firstOrders: Map(khoa nhom -> source_order dau tien).
function toSummaryRows(observations) {
  const firstOrders = new Map();
  for (const row of observations) {
    const key = JSON.stringify([row.pageId, row.phoneKey ?? row.phone]);
    if (!firstOrders.has(key)) firstOrders.set(key, String(row.sourceOrder));
  }
  return aggregateIndependentPhones(observations, []).map(phone => ({
    page_id: phone.pageId, phone_key: phone.phoneKey, first_order: firstOrders.get(phone.key), phone: phone.phone,
    first_employee: phone.firstEmployee, current_employee: phone.currentEmployee, repeat_employee: phone.repeatEmployee,
    first_at: phone.firstAt, current_at: phone.currentAt, repeat_at: phone.repeatAt, trace: compactTrace(phone.trace)
  }));
}

// readObservations(client, { includeRaw }) -> quan sat theo source_order tang dan (marketingRepository cung cap).
async function refreshPhoneSummary({ pool, readObservations, logger = console } = {}) {
  const client = await pool.connect();
  let transaction = false;
  let brokenConnection = null;
  const started = Date.now();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ'); transaction = true;
    const lock = await client.query('SELECT pg_try_advisory_xact_lock($1::bigint) AS locked', [ADVISORY_LOCK_KEY]);
    if (!lock.rows[0]?.locked) { await client.query('ROLLBACK'); transaction = false; return { status: 'busy' }; }

    const observations = await readObservations(client, { includeRaw: false });
    const rows = toSummaryRows(observations);
    const previousRows = Number((await client.query(SQL.count)).rows[0]?.n) || 0;
    // Quan sat chi them vao, khong xoa: doc ra 0 dong trong khi bang dang co du lieu la bat thuong => khong xoa gi.
    if (!rows.length && previousRows > 0) {
      await client.query('ROLLBACK'); transaction = false;
      logger.error?.('[MarketingSummary] Held: no observations while summary exists');
      return { status: 'held' };
    }
    await client.query(SQL.create);
    for (let i = 0; i < rows.length; i += CHUNK) await client.query(SQL.fill, [JSON.stringify(rows.slice(i, i + CHUNK))]);
    const removed = (await client.query(SQL.remove)).rowCount || 0;
    const written = (await client.query(SQL.upsert)).rowCount || 0;
    const maxOrder = observations.length ? String(observations[observations.length - 1].sourceOrder) : null;
    const periods = unique(observations.map(r => r.creditedDate?.slice(0, 7)));
    const employeeRaws = unique(observations.map(r => r.employeeRaw));
    await client.query(SQL.state, [maxOrder, observations.length, rows.length, periods, employeeRaws, removed + written > 0 ? 1 : 0]);
    await client.query('COMMIT'); transaction = false;
    logger.info?.(removed + written > 0 ? '[MarketingSummary] Updated' : '[MarketingSummary] Unchanged',
      { phones: rows.length, written, deleted: removed, durationMs: Date.now() - started });
    return { status: removed + written > 0 ? 'updated' : 'unchanged', phones: rows.length, written, deleted: removed };
  } catch (error) {
    if (transaction) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) { brokenConnection = rollbackError; }
      transaction = false;
    }
    // Thieu migration 0069 (hoac 0056): bo qua im lang — bao cao van chay bang gop JS.
    if (error?.code === '42P01' || error?.code === '42703') return { status: 'unavailable' };
    logger.error?.('[MarketingSummary] Refresh failed', { code: error?.code || 'DATABASE_FAILURE', durationMs: Date.now() - started });
    return { status: 'failed' };
  } finally {
    client.release(brokenConnection || undefined);
  }
}

module.exports = { refreshPhoneSummary, toSummaryRows, compactTrace, expandTrace, ADVISORY_LOCK_KEY };
