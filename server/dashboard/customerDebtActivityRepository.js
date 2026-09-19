'use strict';

const { getPool } = require('../db/pool');
const { BRANCHES, branchLabelToCode } = require('../branch/branches');

const PERIOD_TO_SHEET = Object.freeze({ 1: 'HN1', 3: 'HN3', 7: 'HN7' });

function createCustomerDebtActivityRepository({ pool = getPool() } = {}) {
  async function readOperationalPeriods(branch = BRANCHES.HANOI) {
    const branchCode = branchLabelToCode(branch);
    if (!branchCode) {
      const error = new Error(`Cơ sở không hợp lệ: ${branch}`);
      error.code = 'INVALID_BRANCH';
      error.statusCode = 400;
      throw error;
    }
    const result = await pool.query(`
      SELECT period_days, customer_name
      FROM customer_debt_activity_periods
      WHERE branch = $1
      ORDER BY period_days, customer_name`, [branchCode]);
    const sheets = { HN1: [['Khách hàng']], HN3: [['Khách hàng']], HN7: [['Khách hàng']] };
    for (const row of result.rows || []) {
      const sheetName = PERIOD_TO_SHEET[Number(row.period_days)];
      if (sheetName) sheets[sheetName].push([row.customer_name]);
    }
    return sheets;
  }
  return { readOperationalPeriods };
}

const repository = createCustomerDebtActivityRepository();
module.exports = {
  createCustomerDebtActivityRepository,
  readOperationalPeriods: (...args) => repository.readOperationalPeriods(...args)
};
