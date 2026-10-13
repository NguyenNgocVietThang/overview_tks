'use strict';

// Dung payload `debtManagement` (tab Cong no cua /api/dashboard) tu ban chot 15:00 + lich TT
// hien tai + phan hoi cua chu ky. Quyen sua tung cot tinh theo nguoi xem.

const { hasFeature } = require('../auth/featureRegistry');
const { branchLabelToCode } = require('../branch/branches');
const { buildCustomerRow, buildDebtReport } = require('./debtScheduleRules');
const debtScheduleRepository = require('./debtScheduleRepository');

const DEBT_ACCESS_FEATURES = Object.freeze({
  saleFeedback: 'reports.debt.saleFeedback',
  managerFeedback: 'reports.debt.managerFeedback',
  status: 'reports.debt.edit',
  schedule: 'reports.debt.schedule'
});

function debtAccessFor(viewer) {
  const access = {};
  for (const [name, feature] of Object.entries(DEBT_ACCESS_FEATURES)) access[name] = hasFeature(viewer, feature);
  return access;
}

/** Chuoi on dinh mo ta quyen sua (dua vao khoa cache ket qua dashboard). */
function debtAccessTag(viewer) {
  const access = debtAccessFor(viewer);
  return Object.keys(DEBT_ACCESS_FEATURES).map(name => (access[name] ? '1' : '0')).join('');
}

/** @param {string[]} branchLabels - co so vat ly dang hien thi (BRANCHES.*) */
async function buildDebtManagement(branchLabels, viewer, { repository = debtScheduleRepository.getDebtScheduleRepository() } = {}) {
  const branches = branchLabels.map(label => branchLabelToCode(label)).filter(Boolean);
  const access = debtAccessFor(viewer);
  try {
    const { cycle, rows, amountsByCustomer } = await repository.readReport(branches);
    const customers = cycle
      ? rows.map(row => buildCustomerRow(row, {
        cycleDate: cycle.cycleDate,
        dailyAmounts: amountsByCustomer.get(`${row.branch}:${row.customerId}`) || [],
        access
      }))
      : [];
    return buildDebtReport({ cycle, customers, access });
  } catch (error) {
    console.error('[debtSchedule] Khong doc duoc cong no:', error.message);
    return buildDebtReport({ cycle: null, customers: [], access, dataWarnings: [`Không tải được công nợ: ${error.message}`] });
  }
}

module.exports = { DEBT_ACCESS_FEATURES, debtAccessFor, debtAccessTag, buildDebtManagement };
