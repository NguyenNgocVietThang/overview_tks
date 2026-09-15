'use strict';

const CONFIG = require('../config');
const { BRANCHES } = require('../branch/branches');
const { createReadOnlyClient } = require('./sheetsClient');

const client = createReadOnlyClient(
  () => CONFIG.DEBT_MANAGEMENT_SPREADSHEET_ID,
  'Bảng Công nợ'
);

function sourceSheetForBranch(branch) {
  return branch === BRANCHES.SAIGON
    ? CONFIG.DEBT_MANAGEMENT_SHEET_SG
    : CONFIG.DEBT_MANAGEMENT_SHEET_HN;
}

async function getDebtManagementSheet(branch) {
  const sourceSheet = sourceSheetForBranch(branch);
  const rows = await client.getValues(sourceSheet);
  return { sourceSheet, rows };
}

module.exports = { getDebtManagementSheet, sourceSheetForBranch };
