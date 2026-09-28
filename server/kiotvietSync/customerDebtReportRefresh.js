'use strict';

// Refresh tap khach hang co giao dich trong 1/3/7 ngay tu cac bang Supabase.
// Day la nguon thay the hoan toan cho ba tab Google Sheets HN1/HN3/HN7.
const { getConfiguredBranches } = require('./config');
const { getPool } = require('../db/pool');

// LUU Y IO (do tren Supabase 2026-09-28): ban cu xoa + nap lai tat ca dong cua
// co so moi 5 phut (customer_debt_activity_periods bi UPDATE ~3 trieu lan tren
// ~1.000 dong) va CTE `activity` gom TOAN BO lich su hoa don/tra hang/phieu
// thu chi roi moi loc 7 ngay o buoc JOIN (moi lan doc ~33MB tu dia, ~7s khi
// dia bi bop bang thong). Gio:
//  - loc 7 ngay ngay tai tung nguon bang cot goc (SINCE_SQL, dung duoc index
//    ...purchase_date/return_date/trans_date) - 7 ngay la cua so rong nhat
//    (period_days = 7); 1/3 ngay chi la tap con, van loc chinh xac o buoc JOIN;
//  - chi UPSERT dong doi ten/moi va DELETE dong khong con nam trong tap hien
//    tai, thay vi xoa het roi ghi lai. `refreshed_at` vi vay la "lan thay doi
//    gan nhat" cua dong, khong con la "lan tinh lai gan nhat".
// Moc bat dau tinh theo lich VN tu `now()` THAT, so sanh thang voi cot goc
// ("gio treo tuong VN mang nhan UTC") - xem dashboardRollupRefresh.js.
const SINCE_SQL = `(((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 6)::timestamp AT TIME ZONE 'UTC')`;

const REFRESH_SQL = `
  WITH periods(period_days) AS (VALUES (1), (3), (7)),
  activity AS (
    SELECT customer_id, purchase_date AS activity_at
    FROM invoices
    WHERE branch = $1 AND customer_id IS NOT NULL
      AND purchase_date >= ${SINCE_SQL}
      AND COALESCE(raw->>'statusValue', '') = 'Hoàn thành'
    UNION ALL
    SELECT customer_id, return_date
    FROM returns
    WHERE branch = $1 AND customer_id IS NOT NULL
      AND return_date >= ${SINCE_SQL}
      AND COALESCE(raw->>'statusValue', '') <> 'Đã hủy'
    UNION ALL
    SELECT customer_id, trans_date
    FROM cash_flows
    WHERE branch = $1 AND customer_id IS NOT NULL
      AND trans_date >= ${SINCE_SQL}
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
  ), upserted AS (
    INSERT INTO customer_debt_activity_periods
      (branch, period_days, customer_id, customer_name, refreshed_at)
    SELECT branch, period_days, customer_id, customer_name, now()
    FROM current_rows
    ON CONFLICT (branch, period_days, customer_id) DO UPDATE SET
      customer_name = EXCLUDED.customer_name,
      refreshed_at = EXCLUDED.refreshed_at
    WHERE customer_debt_activity_periods.customer_name IS DISTINCT FROM EXCLUDED.customer_name
    RETURNING 1
  ), removed AS (
    DELETE FROM customer_debt_activity_periods t
    WHERE t.branch = $1
      AND NOT EXISTS (
        SELECT 1 FROM current_rows c
        WHERE c.period_days = t.period_days AND c.customer_id = t.customer_id
      )
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM current_rows)::int AS row_count`;

async function refreshCustomerDebtReports(pool, {
  getConfiguredBranches: getBranches = getConfiguredBranches,
  log = console.log
} = {}) {
  const results = [];
  for (const { branch } of getBranches()) {
    const result = await pool.query(REFRESH_SQL, [branch]);
    // Cau chi tra 1 dong dem tap hien tai (giu nghia "N dong 1/3/7 ngay" cua log);
    // rowCount cua pg luc nay chi la 1 nen chi dung lam du phong (mock test).
    const rowCount = result.rows?.[0]?.row_count ?? result.rowCount ?? 0;
    results.push({ branch, rowCount });
    log(`[customerDebtReportRefresh] ${branch}: ${rowCount} dong 1/3/7 ngay.`);
  }
  return results;
}

function startCustomerDebtReportRefreshSchedule(pool, {
  intervalMs = 5 * 60 * 1000,
  setIntervalFn = setInterval,
  scheduleImmediate = queueMicrotask,
  log = console.log,
  getConfiguredBranches: getBranches = getConfiguredBranches
} = {}) {
  const run = () => {
    refreshCustomerDebtReports(pool, { log, getConfiguredBranches: getBranches }).catch(error => {
      log(`[customerDebtReportRefresh] Loi khi refresh: ${error.message}`);
    });
  };
  // Chay ngay mot luot khi khoi dong — cung ly do nhu dashboardRollupRefresh.js:
  // chi dua vao setInterval thi sau moi lan restart bao cao se cu het mot chu ky.
  scheduleImmediate(run);
  return setIntervalFn(run, intervalMs);
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
