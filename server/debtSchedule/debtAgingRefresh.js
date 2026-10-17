'use strict';

// Tinh san bang "Tuoi no theo hoa don" (migration 0059) tu cac bang chung:
//   customers (no hien tai, ten, nhom khach = Sale) + debt_payment_schedules (lich TT)
//   + invoices Hoan thanh gom theo ngay VN trong AGING_LOOKBACK_DAYS ngay (chi khach dang no > 0).
// Cong thuc o debtAgingRules.js. Web (/api/debt-management/aging) chi DOC bang ket qua.
//
// Chay sau moi luot dong bo hoa don (fast, 7 phut), khi dong bo khach (20 phut) va khi sua lich TT.
// Ghi KHAC BIET (bai hoc su co IO 2026-09-28): LEFT JOIN bang dich + IS DISTINCT FROM o SELECT
// nen dong khong doi khong toi INSERT; luot nhan roi ghi ~0 dong. Loc ngay so thang cot goc
// purchase_date de dung index (branch, purchase_date).
//
// Chay tay: node debtSchedule/debtAgingRefresh.js

const { getPool } = require('../db/pool');
const { vnDateKey } = require('../kiotvietSync/vnTime');
const { agingHistoryStart, buildAgingRow } = require('./debtAgingRules');

const BRANCH_CODES = Object.freeze(['hanoi', 'saigon']);

// $1 mang co so.
const CUSTOMERS_SQL = `
  SELECT c.branch, c.id::text AS customer_id, COALESCE(c.debt, 0)::text AS current_debt,
         btrim(COALESCE(c.code, '')) AS customer_code,
         COALESCE(NULLIF(btrim(c.name), ''), '') AS customer_name,
         NULLIF(btrim(c.raw->>'groups'), '') AS sale,
         s.schedule_days, c.synced_at
  FROM customers c
  LEFT JOIN debt_payment_schedules s ON s.branch = c.branch AND s.customer_id = c.id
  WHERE c.branch = ANY($1::text[])
    AND COALESCE(c.raw->>'isActive', c.raw->>'IsActive', 'true') <> 'false'`;

// $1 mang co so, $2 ngay dau khoang tra cuu (YYYY-MM-DD gio VN). purchase_date luu gio VN gan
// nhan UTC (nhu debtCycleSnapshot.js) -> moc = ngay::timestamp AT TIME ZONE 'UTC'.
const AMOUNTS_SQL = `
  SELECT i.branch, i.customer_id::text AS customer_id, (i.purchase_date AT TIME ZONE 'UTC')::date::text AS day,
         SUM(COALESCE(i.total, 0))::text AS invoice_amount
  FROM invoices i
  JOIN customers c ON c.branch = i.branch AND c.id = i.customer_id AND c.debt > 0
  WHERE i.branch = ANY($1::text[]) AND i.customer_id IS NOT NULL
    AND i.purchase_date >= ($2::date::timestamp AT TIME ZONE 'UTC')
    AND i.raw->>'statusValue' = 'Hoàn thành'
  GROUP BY i.branch, i.customer_id, (i.purchase_date AT TIME ZONE 'UTC')::date`;

const COLUMNS = ['branch', 'customer_id', 'customer_code', 'customer_name', 'sale', 'schedule_days', 'has_stored_schedule',
  'current_debt', 'overdue_debt', 'payoff_day', 'beyond_history', 'equivalent_days', 'remaining_days'];
const VALUE_COLUMNS = COLUMNS.slice(2);

const UPSERT_SQL = `
  INSERT INTO debt_aging_customers (${COLUMNS.join(', ')})
  SELECT n.branch, n.customer_id, n.customer_code, n.customer_name, n.sale, n.schedule_days, n.has_stored_schedule,
         n.current_debt, n.overdue_debt, n.payoff_day, n.beyond_history, n.equivalent_days, n.remaining_days
  FROM unnest($1::text[], $2::bigint[], $3::text[], $4::text[], $5::text[], $6::int[], $7::boolean[],
              $8::numeric[], $9::numeric[], $10::date[], $11::boolean[], $12::int[], $13::int[])
       AS n(${COLUMNS.join(', ')})
  LEFT JOIN debt_aging_customers t ON t.branch = n.branch AND t.customer_id = n.customer_id
  WHERE t.branch IS NULL
     OR (${VALUE_COLUMNS.map(column => `t.${column}`).join(', ')}) IS DISTINCT FROM (${VALUE_COLUMNS.map(column => `n.${column}`).join(', ')})
  ON CONFLICT (branch, customer_id) DO UPDATE SET
    ${VALUE_COLUMNS.map(column => `${column} = EXCLUDED.${column}`).join(',\n    ')}`;

// $1/$2 khoa dang co, $3 co so da tinh: xoa khach khong con (ngung hoat dong / bi xoa).
const DELETE_SQL = `
  DELETE FROM debt_aging_customers t
  WHERE t.branch = ANY($3::text[])
    AND NOT EXISTS (
      SELECT 1 FROM unnest($1::text[], $2::bigint[]) AS k(branch, customer_id)
      WHERE k.branch = t.branch AND k.customer_id = t.customer_id)`;

const STATE_SQL = `
  INSERT INTO debt_aging_state (id, as_of_day, refreshed_at, customers_synced_at, version)
  VALUES (1, $1::date, now(), $2::timestamptz, 1)
  ON CONFLICT (id) DO UPDATE SET as_of_day = EXCLUDED.as_of_day, refreshed_at = now(),
    customers_synced_at = EXCLUDED.customers_synced_at,
    version = debt_aging_state.version + CASE WHEN $3::boolean THEN 1 ELSE 0 END
  RETURNING version`;

/** Tinh cac dong ket qua tu du lieu da doc (thuan, de test). */
function computeAgingRows(customerRows, amountRows, today) {
  const amountsByCustomer = new Map();
  for (const row of amountRows) {
    const key = `${row.branch}:${row.customer_id}`;
    if (!amountsByCustomer.has(key)) amountsByCustomer.set(key, []);
    amountsByCustomer.get(key).push({ day: row.day, invoiceAmount: Number(row.invoice_amount) || 0 });
  }
  let syncedAt = null;
  const rows = customerRows.map(row => {
    const at = row.synced_at ? new Date(row.synced_at) : null;
    if (at && !Number.isNaN(at.getTime()) && (!syncedAt || at > syncedAt)) syncedAt = at;
    return buildAgingRow({
      branch: row.branch,
      customerId: row.customer_id,
      customerCode: row.customer_code,
      customerName: row.customer_name,
      sale: row.sale,
      scheduleDays: row.schedule_days,
      currentDebt: Number(row.current_debt) || 0
    }, { today, dailyAmounts: amountsByCustomer.get(`${row.branch}:${row.customer_id}`) || [] });
  });
  return { rows, syncedAt: syncedAt ? syncedAt.toISOString() : null };
}

function toColumnArrays(rows) {
  return [
    rows.map(row => row.branchCode),
    rows.map(row => row.customerId),
    rows.map(row => row.customerCode),
    // Luu dung gia tri hien thi (ten du phong, "Chua phan nhom") -> web chi doc, khong doi.
    rows.map(row => row.customerName),
    rows.map(row => row.sale),
    rows.map(row => row.scheduleDays),
    rows.map(row => row.hasStoredSchedule),
    rows.map(row => String(Math.round(row.currentDebt))),
    rows.map(row => String(Math.round(row.overdueDebt))),
    rows.map(row => row.payoffDay),
    rows.map(row => row.beyondHistory),
    rows.map(row => row.equivalentDays),
    rows.map(row => row.remainingDays)
  ];
}

let running = null;
let rerunRequested = false;
const listeners = new Set();

/** Tinh lai + ghi khac biet. Goi trung luc dang chay -> chay them 1 luot sau (khong chong luot). */
async function refreshDebtAging(pool = getPool(), { now = Date.now, log = console.log, branches = BRANCH_CODES } = {}) {
  if (running) {
    rerunRequested = true;
    return running;
  }
  running = (async () => {
    let result;
    do {
      rerunRequested = false;
      result = await refreshOnce(pool, { now, log, branches });
    } while (rerunRequested);
    return result;
  })();
  try {
    return await running;
  } finally {
    running = null;
  }
}

async function refreshOnce(pool, { now, log, branches }) {
  const startedAt = Date.now();
  const today = vnDateKey(new Date(now()));
  const [customers, amounts] = await Promise.all([
    pool.query(CUSTOMERS_SQL, [branches]),
    pool.query(AMOUNTS_SQL, [branches, agingHistoryStart(today)])
  ]);
  const { rows, syncedAt } = computeAgingRows(customers.rows, amounts.rows, today);
  const columns = toColumnArrays(rows);
  const client = pool.connect ? await pool.connect() : pool;
  let written = 0;
  let deleted = 0;
  let version = null;
  try {
    await client.query('BEGIN');
    written = (await client.query(UPSERT_SQL, columns)).rowCount || 0;
    // Chot an toan: doc ra 0 khach (loi nguon) thi khong xoa sach bang dang co.
    if (rows.length) deleted = (await client.query(DELETE_SQL, [columns[0], columns[1], branches])).rowCount || 0;
    version = Number((await client.query(STATE_SQL, [today, syncedAt, written + deleted > 0])).rows[0].version);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (client !== pool && client.release) client.release();
  }
  const changed = written + deleted > 0;
  if (changed) for (const listener of listeners) listener({ version });
  log(`[DebtAging] ${rows.length} khach, ghi ${written}, xoa ${deleted} (${Date.now() - startedAt} ms)`);
  return { customers: rows.length, written, deleted, changed, version, today };
}

/** Goi khi bang ket qua doi (vd xoa cache doc). */
function onDebtAgingChanged(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Lam moi nen, nuot loi (dung cho hook sau dong bo / sua lich TT). */
function requestDebtAgingRefresh(pool = getPool(), { log = console.log } = {}) {
  // Chua cau hinh DB (test/dev) hoac pool gia: khong lam gi.
  if (!pool || typeof pool.query !== 'function' || !require('../config').SUPABASE_DB_URL) return Promise.resolve(null);
  return refreshDebtAging(pool, { log }).catch(error => {
    // Chua ap migration 0059 -> bo qua yen lang (giong cac job tang dan khac).
    if (error && error.code === '42P01') return null;
    console.error('[DebtAging] Loi tinh tuoi no:', error && error.message);
    return null;
  });
}

module.exports = { computeAgingRows, refreshDebtAging, requestDebtAgingRefresh, onDebtAgingChanged, __test__: { UPSERT_SQL } };

if (require.main === module) {
  refreshDebtAging()
    .then(result => { console.log(result); return require('../db/pool').getPool().end(); })
    .catch(error => { console.error(error); process.exitCode = 1; });
}
