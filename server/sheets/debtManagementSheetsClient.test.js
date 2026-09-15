'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BRANCHES } = require('../branch/branches');

test('ánh xạ cơ sở sang đúng tab công nợ trong workbook chung', () => {
  const client = require('./debtManagementSheetsClient');
  assert.equal(client.sourceSheetForBranch(BRANCHES.HANOI), 'Công nợ HN');
  assert.equal(client.sourceSheetForBranch(BRANCHES.SAIGON), 'Công nợ SG');
});

test('thiếu DEBT_MANAGEMENT_SPREADSHEET_ID trả lỗi fail-soft 503 khi được gọi, không làm crash lúc require', async () => {
  const CONFIG = require('../config');
  const original = CONFIG.DEBT_MANAGEMENT_SPREADSHEET_ID;
  CONFIG.DEBT_MANAGEMENT_SPREADSHEET_ID = null;
  delete require.cache[require.resolve('./debtManagementSheetsClient')];
  const client = require('./debtManagementSheetsClient');

  try {
    await assert.rejects(
      client.getDebtManagementSheet(BRANCHES.HANOI),
      error => error.code === 'BRANCH_NOT_CONFIGURED' && error.statusCode === 503
    );
  } finally {
    CONFIG.DEBT_MANAGEMENT_SPREADSHEET_ID = original;
  }
});
