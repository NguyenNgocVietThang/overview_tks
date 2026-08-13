'use strict';
// Test nay tu set bien moi truong gia de config.js khong throw khi thieu
// .env that — khong dung tai khoan Google Sheets that trong test.
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';

const test = require('node:test');
const assert = require('node:assert/strict');

// Require lai module tu dau cho moi test de cac cache module-level (let o
// dashboardData.js) khong bi ro ri giua cac test.
function freshDashboardData() {
  delete require.cache[require.resolve('./dashboardData')];
  delete require.cache[require.resolve('../sheets/sheetsClient')];
  const sheetsClient = require('../sheets/sheetsClient');
  const dashboardData = require('./dashboardData');
  return { dashboardData, sheetsClient };
}

// Thay the toan bo getMultipleSheetValues bang mock dem so lan goi — dashboardData.js
// luon goi qua `sheetsClient.getMultipleSheetValues(...)` (khong destructure truoc),
// nen ghi de truc tiep property nay la du, khong can thu vien mock.
function mockSheets(sheetsClient, callCounter) {
  sheetsClient.getMultipleSheetValues = async (names) => {
    callCounter.count += 1;
    const result = {};
    names.forEach(name => { result[name] = []; });
    return result;
  };
}

const BASE_FILTERS = {
  overview: { mode: 'days', days: 30 },
  products: { mode: 'days', days: 30 },
  invoices: { mode: 'days', days: 30 },
  customers: { mode: 'all' },
  newPurchases: { mode: 'days', days: 30 },
  newProducts: { mode: 'days', days: 30 },
  deactivated: { mode: 'days', days: 30 }
};

test('rememberSearchSheets chi rebuild search index khi raw sheet data thuc su duoc fetch lai, khong phai moi lan goi getDashboardData', async () => {
  const { dashboardData, sheetsClient } = freshDashboardData();
  const callCounter = { count: 0 };
  mockSheets(sheetsClient, callCounter);
  dashboardData.__test__.resetCaches();

  await dashboardData.getDashboardData(BASE_FILTERS);
  await dashboardData.getDashboardData(BASE_FILTERS);
  await dashboardData.getDashboardData({ ...BASE_FILTERS, products: { mode: 'days', days: 7 } });

  assert.equal(callCounter.count, 1, 'raw sheets phai duoc fetch dung 1 lan (con cache 90s)');
  assert.equal(
    dashboardData.__test__.getSearchIndexBuildCount(),
    1,
    'search index chi duoc rebuild 1 lan, khong phai moi lan goi getDashboardData'
  );
});

module.exports = { freshDashboardData, mockSheets, BASE_FILTERS };
