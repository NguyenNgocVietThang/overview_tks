'use strict';

// Refresh tap khach hang co giao dich trong 1/3/7 ngay tu cac bang Supabase.
// Day la nguon thay the hoan toan cho ba tab Google Sheets HN1/HN3/HN7.
const { getConfiguredBranches } = require('./config');
const { getPool } = require('../db/pool');

const REFRESH_SQL = `
  WITH periods(period_days) AS (VALUES (1), (3), (7)),
  activity AS (
    SELECT customer_id, purchase_date AS activity_at
    FROM invoices
    WHERE branch = $1 AND customer_id IS NOT NULL
      AND COALESCE(raw->>'statusValue', '') = 'Hoàn thành'
    UNION ALL
    SELECT customer_id, return_date
    FROM returns
    WHERE branch = $1 AND customer_id IS NOT NULL
      AND COALESCE(raw->>'statusValue', '') <> 'Đã hủy'
    UNION ALL
    SELECT customer_id, trans_date
    FROM cash_flows
    WHERE branch = $1 AND customer_id IS NOT NULL
      AND COALESCE(raw->>'status', '0') = '0'
  ), current_rows AS (
    SELECT DISTINCT
      $1::text AS branch,
      p.period_days,
      c.id AS customer_id,
      COALESCE(NULLIF(c.name, ''), NULLIF(c.raw->>'name', ''), c.code, c.id::text) AS customer_name
    FROM periods p
    JOIN activity a
      ON a.activity_at IS NOT NULL
     AND (a.activity_at AT TIME ZONE 'UTC')::date >=
         (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - (p.period_days - 1)
    JOIN customers c ON c.branch = $1 AND c.id = a.customer_id
  ), removed AS (
    DELETE FROM customer_debt_activity_periods WHERE branch = $1
  )
  INSERT INTO customer_debt_activity_periods
    (branch, period_days, customer_id, customer_name, refreshed_at)
  SELECT branch, period_days, customer_id, customer_name, now()
  FROM current_rows
  ON CONFLICT (branch, period_days, customer_id) DO UPDATE SET
    customer_name = EXCLUDED.customer_name,
    refreshed_at = EXCLUDED.refreshed_at`;

async function refreshCustomerDebtReports(pool, {
  getConfiguredBranches: getBranches = getConfiguredBranches,
  log = console.log
} = {}) {
  const results = [];
  for (const { branch } of getBranches()) {
    const result = await pool.query(REFRESH_SQL, [branch]);
    results.push({ branch, rowCount: result.rowCount || 0 });
    log(`[customerDebtReportRefresh] ${branch}: ${result.rowCount || 0} dong 1/3/7 ngay.`);
  }
  return results;
}

function startCustomerDebtReportRefreshSchedule(pool, {
  intervalMs = 5 * 60 * 1000,
  setIntervalFn = setInterval,
  log = console.log,
  getConfiguredBranches: getBranches = getConfiguredBranches
} = {}) {
  return setIntervalFn(() => {
    refreshCustomerDebtReports(pool, { log, getConfiguredBranches: getBranches }).catch(error => {
      log(`[customerDebtReportRefresh] Loi khi refresh: ${error.message}`);
    });
  }, intervalMs);
}

async function main() {
  const results = await refreshCustomerDebtReports(getPool());
  console.log(`[customerDebtReportRefresh] Hoan tat, ${results.length} co so.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[customerDebtReportRefresh] That bai: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  refreshCustomerDebtReports,
  startCustomerDebtReportRefreshSchedule,
  __sql__: { REFRESH_SQL }
};
