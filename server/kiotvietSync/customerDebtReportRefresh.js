'use strict';

// Refresh dinh ky bang customer_debt_report_lines (bao cao cong no khach
// hang HN1/HN3/HN7 — xem 0014_customer_debt_report_lines.sql va
// customerDebtReportCompute.js) dung pattern giong het
// dashboardRollupRefresh.js: ham thuan (refreshCustomerDebtReports) tach
// khoi ham dang ky lich (startCustomerDebtReportRefreshSchedule),
// setIntervalFn injectable de test khong phai cho interval that.
//
// KHONG dung ON CONFLICT DO UPDATE nhu 4 bang rollup 0013 — bang nay khong
// co khoa nghiep vu tu nhien (moi dong la 1 dong hien thi, khong phai 1
// giao dich KiotViet cu the), nen moi lan refresh XOA HET dong cua 1 co so
// roi ghi lai tu dau trong 1 transaction (DELETE+INSERT), tranh dong cu con
// sot lai neu so dong ky nao do giam di giua 2 lan refresh.

if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* dotenv là tùy chọn trong môi trường production */ }
}

const { getConfiguredBranches } = require('./config');
const { getPool } = require('../db/pool');
const { computeCustomerDebtReports } = require('./customerDebtReportCompute');

const INSERT_SQL = `INSERT INTO customer_debt_report_lines (
  branch, period_days, seq, customer_code, customer_name, phone, customer_group,
  opening_debt, debit, credit, closing_debt, txn_code, txn_time, txn_type, txn_value, running_debt,
  product_code, product_name, category_name, price, quantity, amount, discount, total
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`;

async function refreshBranchCustomerDebtReports(pool, branchCode) {
  const periods = await computeCustomerDebtReports(branchCode, pool);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM customer_debt_report_lines WHERE branch = $1', [branchCode]);
    for (const period of periods) {
      let seq = 0;
      for (const row of period.rows) {
        seq += 1;
        await client.query(INSERT_SQL, [
          branchCode, period.days, seq,
          row.customerCode, row.customerName, row.phone, row.customerGroup,
          row.openingDebt, row.debit, row.credit, row.closingDebt,
          row.txnCode, row.txnTime, row.txnType, row.txnValue, row.runningDebt,
          row.productCode, row.productName, row.categoryName,
          row.price, row.quantity, row.amount, row.discount, row.total
        ]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const rowCounts = {};
  periods.forEach(period => { rowCounts[period.days] = period.rows.length; });
  return { branch: branchCode, rowCounts };
}

/**
 * Chay lai bao cao cong no HN1/HN3/HN7 cho tung co so da cau hinh credentials.
 * Moi co so doc lap — 1 co so loi khong chan co so con lai.
 * @returns {Promise<Array<{branch, rowCounts}|{branch, error}>>}
 */
async function refreshCustomerDebtReports(pool, {
  getConfiguredBranches: getBranches = getConfiguredBranches,
  log = console.log
} = {}) {
  const branches = getBranches().map((item) => item.branch);
  const results = [];

  for (const branch of branches) {
    try {
      const result = await refreshBranchCustomerDebtReports(pool, branch);
      results.push(result);
      log(`[customerDebtReportRefresh] ${branch}: HN1=${result.rowCounts[1] || 0} dong, ` +
        `HN3=${result.rowCounts[3] || 0} dong, HN7=${result.rowCounts[7] || 0} dong.`);
    } catch (error) {
      results.push({ branch, error: error.message });
      log(`[customerDebtReportRefresh] Loi refresh ${branch}: ${error.message}`);
    }
  }

  return results;
}

function startCustomerDebtReportRefreshSchedule(pool, {
  intervalMs = 5 * 60 * 1000,
  setIntervalFn = setInterval, log = console.log,
  getConfiguredBranches: getBranches = getConfiguredBranches
} = {}) {
  return setIntervalFn(() => {
    refreshCustomerDebtReports(pool, { log, getConfiguredBranches: getBranches }).catch((error) => {
      log(`[customerDebtReportRefresh] Loi khi refresh: ${error.message}`);
    });
  }, intervalMs);
}

async function main() {
  const pool = getPool();
  const results = await refreshCustomerDebtReports(pool);
  console.log(`[customerDebtReportRefresh] Hoan tat, ${results.length} co so.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[customerDebtReportRefresh] That bai: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  refreshCustomerDebtReports,
  startCustomerDebtReportRefreshSchedule,
  __sql__: { INSERT_SQL }
};
