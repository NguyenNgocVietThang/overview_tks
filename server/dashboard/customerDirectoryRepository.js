'use strict';
// ==========================================
// DANH BA KHACH HANG (rut gon: ma + ten) — nguon rieng, NHE, cho goi y tim
// kiem o phan "Bao cao doanh thu theo khach" (tab Tong quan). Tach khoi cache
// 9-tab dashboard (getCachedDashboardSheets — doc ca 9 bang mat ~14s khi cache
// nguoi/het han, xem dashboardData.js) vi luc go tim ten chi can ma/ten, chua
// can doanh thu hay bat ky bang nang nao khac.
// ==========================================
const { getPool } = require('../db/pool');
const { BRANCHES, BRANCH_BOTH, branchLabelToCode, resolveBranchScope } = require('../branch/branches');

function createCustomerDirectoryRepository({ pool = getPool() } = {}) {
  function resolveBranchCode(branch) {
    const branchCode = branchLabelToCode(branch || BRANCHES.HANOI);
    if (!branchCode) {
      const error = new Error(`Cơ sở không hợp lệ: ${branch}`);
      error.code = 'INVALID_BRANCH';
      error.statusCode = 400;
      throw error;
    }
    return branchCode;
  }

  /**
   * @param {string} branch nhan co so ('Hà Nội'/'Sài Gòn') hoac BRANCH_BOTH ("Cả hai").
   * @returns {Promise<{branch: string, code: string, name: string}[]>}
   */
  async function readCustomerDirectory(branch = BRANCHES.HANOI) {
    const branchCodes = branch === BRANCH_BOTH
      ? resolveBranchScope(BRANCH_BOTH).map(resolveBranchCode)
      : [resolveBranchCode(branch)];
    const result = await pool.query(
      `SELECT branch, code, name FROM customers WHERE branch = ANY($1::text[]) ORDER BY branch, code`,
      [branchCodes]
    );
    return result.rows.map(row => ({ branch: row.branch, code: row.code || '', name: row.name || '' }));
  }

  return { readCustomerDirectory };
}

const repository = createCustomerDirectoryRepository();
module.exports = {
  createCustomerDirectoryRepository,
  readCustomerDirectory: (...args) => repository.readCustomerDirectory(...args)
};
