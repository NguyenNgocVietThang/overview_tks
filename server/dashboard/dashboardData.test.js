'use strict';
// Test nay tu set bien moi truong gia de config.js khong throw khi thieu
// .env that — khong dung tai khoan Google Sheets that trong test.
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

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

test('tim nhieu ma khop chinh xac, bo ma trung va giu thu tu ma nhap', async () => {
  const { dashboardData, sheetsClient } = freshDashboardData();
  const CONFIG = require('../config');
  sheetsClient.getMultipleSheetValues = async (names) => {
    const result = {};
    names.forEach(name => { result[name] = []; });
    result[CONFIG.SHEET_PRODUCTS] = [
      ['Mã hàng', 'Tên hàng'],
      ['SP-02', 'Sản phẩm hai'],
      ['SP-01', 'Sản phẩm một'],
      ['SP-010', 'Không được khớp một phần']
    ];
    return result;
  };
  dashboardData.__test__.resetCaches();

  const result = await dashboardData.searchDashboardRecords(
    'products',
    '  sp-01\nSP-02\tSP-01  MA-KHONG-CO ',
    'all',
    'codes'
  );

  assert.deepEqual(result.results.map(item => item.code), ['SP-01', 'SP-02']);
  assert.equal(result.requestedCount, 3);
  assert.equal(result.matchedCount, 2);
  assert.equal(result.missingCount, 1);
  assert.equal(result.total, 2);
});

test('tim nhieu ma chap nhan 50 ma va tu choi 51 ma', async () => {
  const { dashboardData, sheetsClient } = freshDashboardData();
  mockSheets(sheetsClient, { count: 0 });
  dashboardData.__test__.resetCaches();

  const fiftyCodes = Array.from({ length: 50 }, (_, index) => `MA-${index + 1}`).join(' ');
  const accepted = await dashboardData.searchDashboardRecords('products', fiftyCodes, 'all', 'codes');
  assert.equal(accepted.requestedCount, 50);

  const fiftyOneCodes = `${fiftyCodes} MA-51`;
  await assert.rejects(
    dashboardData.searchDashboardRecords('products', fiftyOneCodes, 'all', 'codes'),
    error => error.code === 'TOO_MANY_SEARCH_CODES' && error.statusCode === 400
  );
});

test('tim thong thuong van ho tro ten nhieu tu', async () => {
  const { dashboardData, sheetsClient } = freshDashboardData();
  const CONFIG = require('../config');
  sheetsClient.getMultipleSheetValues = async (names) => {
    const result = {};
    names.forEach(name => { result[name] = []; });
    result[CONFIG.SHEET_PRODUCTS] = [
      ['Mã hàng', 'Tên hàng'],
      ['AT-01', 'Áo thun xanh']
    ];
    return result;
  };
  dashboardData.__test__.resetCaches();

  const result = await dashboardData.searchDashboardRecords('products', 'áo thun', 'all');
  assert.deepEqual(result.results.map(item => item.code), ['AT-01']);
});

function customerProductTopRows() {
  return [
    [
      'Mã hàng', 'Tên hàng', 'Mã KH', 'Khách hàng',
      'SL Trả (theo khách hàng)', 'Giá trị trả (theo khách hàng)',
      'Thời gian', 'SL chi tiết', 'Thành tiền chi tiết'
    ],
    ['SP-01', 'Sản phẩm một', 'KH-A', 'Khách A', 2, 120, '10/08/2026 00:00:00', 3, 300],
    ['SP-01', 'Sản phẩm một', 'KH-A', 'Khách A', 2, 120, '12/08/2026 23:59:59', 4, 400],
    ['SP-01', 'Sản phẩm một', 'KH-A', 'Khách A', 2, 120, '13/08/2026 00:00:00', 100, 10000],
    ['SP-01', 'Sản phẩm một', 'KH-B', 'Khách B', 0, 0, '11/08/2026 09:00:00', 8, 700],
    ['SP-01', 'Sản phẩm một', 'KH-C', 'Khách C', 1, 50, '12/08/2026 10:00:00', 8, 650],
    ['SP-01', 'Sản phẩm một', 'KH-D', 'Khách D', 1, 50, '12/08/2026 10:00:00', 8, 650],
    ['SP-01', 'Sản phẩm một', 'KH-E', 'Khách E', 0, 0, '09/08/2026 23:59:59', 99, 9999],
    ['SP-02', 'Sản phẩm hai', '', 'Khách lẻ', 0, 0, '12/08/2026 08:00:00', 2, 250]
  ];
}

test('top KH theo san pham cong chi tiet trong ky, khong cong trung cot tra va xep hang on dinh', async () => {
  const { dashboardData, sheetsClient } = freshDashboardData();
  const CONFIG = require('../config');
  let fetchCount = 0;
  sheetsClient.getMultipleSheetValues = async names => {
    fetchCount += 1;
    const result = {};
    names.forEach(name => { result[name] = []; });
    result[CONFIG.SHEET_CUSTOMER_BY_PRODUCT_REPORT] = customerProductTopRows();
    return result;
  };
  dashboardData.__test__.resetCaches();

  const result = await dashboardData.searchTopCustomersByProducts(
    ' SP-02\nsp-01 SP-02 KHONG-CO ',
    { mode: 'range', from: '2026-08-10', to: '2026-08-12' },
    new Date('2026-08-14T12:00:00+07:00')
  );

  assert.equal(fetchCount, 1, 'sheet rieng chi duoc doc mot lan');
  assert.equal(result.requestedCount, 3);
  assert.equal(result.matchedCount, 2);
  assert.equal(result.missingCount, 1);
  assert.equal(result.total, 4);
  assert.equal(result.filter.label, '10/08/2026 – 12/08/2026');
  assert.deepEqual(
    result.results.map(item => [item.productCode, item.customerName]),
    [
      ['SP-02', 'Khách lẻ'],
      ['SP-01', 'Khách B'],
      ['SP-01', 'Khách C'],
      ['SP-01', 'Khách D']
    ]
  );

  const customerAAllTimeCheck = await dashboardData.searchTopCustomersByProducts(
    'SP-01',
    { mode: 'range', from: '2026-08-10', to: '2026-08-12' },
    new Date('2026-08-14T12:00:00+07:00')
  );
  assert.equal(fetchCount, 1, 'cache 90 giay duoc tai su dung');
  assert.equal(customerAAllTimeCheck.results.length, 3);

  const customerC = result.results.find(item => item.customerName === 'Khách C');
  assert.equal(customerC.returnedQuantityAllTime, 1);
  assert.equal(customerC.returnValueAllTime, 50);
  assert.equal(customerC.netRevenue, 600);
  assert.equal(customerC.lastPurchaseDate, '12/08/2026');
});

test('top KH theo san pham loc dung 1/7/30/90 ngay va che do tat ca', async () => {
  const { dashboardData, sheetsClient } = freshDashboardData();
  const CONFIG = require('../config');
  sheetsClient.getMultipleSheetValues = async names => {
    const result = {};
    names.forEach(name => { result[name] = []; });
    result[CONFIG.SHEET_CUSTOMER_BY_PRODUCT_REPORT] = customerProductTopRows();
    return result;
  };
  dashboardData.__test__.resetCaches();
  const now = new Date('2026-08-14T12:00:00+07:00');

  const oneDay = await dashboardData.searchTopCustomersByProducts('SP-01', { mode: 'days', days: 1 }, now);
  const sevenDays = await dashboardData.searchTopCustomersByProducts('SP-01', { mode: 'days', days: 7 }, now);
  const thirtyDays = await dashboardData.searchTopCustomersByProducts('SP-01', { mode: 'days', days: 30 }, now);
  const ninetyDays = await dashboardData.searchTopCustomersByProducts('SP-01', { mode: 'days', days: 90 }, now);
  const allTime = await dashboardData.searchTopCustomersByProducts('SP-01', { mode: 'all' }, now);

  assert.equal(oneDay.matchedCount, 0);
  assert.equal(sevenDays.matchedCount, 1);
  assert.equal(thirtyDays.matchedCount, 1);
  assert.equal(ninetyDays.matchedCount, 1);
  assert.equal(allTime.matchedCount, 1);
  assert.equal(allTime.filter.label, 'Tất cả');
  assert.equal(allTime.results[0].customerName, 'Khách A');
  assert.equal(allTime.results[0].purchasedQuantity, 107);
  assert.equal(allTime.results[0].purchaseRevenue, 10700);
  assert.equal(allTime.results[0].returnedQuantityAllTime, 2, 'cot tong tra lap lai khong duoc cong ba lan');
  assert.equal(allTime.results[0].returnValueAllTime, 120, 'gia tri tra lap lai khong duoc cong ba lan');
  assert.equal(allTime.results[0].netRevenue, 10580);
});

test('top KH theo san pham chap nhan 50 ma va tu choi 51 ma', async () => {
  const { dashboardData, sheetsClient } = freshDashboardData();
  const CONFIG = require('../config');
  sheetsClient.getMultipleSheetValues = async names => {
    const result = {};
    names.forEach(name => { result[name] = []; });
    result[CONFIG.SHEET_CUSTOMER_BY_PRODUCT_REPORT] = [customerProductTopRows()[0]];
    return result;
  };
  dashboardData.__test__.resetCaches();

  const fiftyCodes = Array.from({ length: 50 }, (_, index) => `MA-${index + 1}`).join(' ');
  const accepted = await dashboardData.searchTopCustomersByProducts(fiftyCodes, { mode: 'all' });
  assert.equal(accepted.requestedCount, 50);

  await assert.rejects(
    dashboardData.searchTopCustomersByProducts(`${fiftyCodes} MA-51`, { mode: 'all' }),
    error => error.code === 'TOO_MANY_SEARCH_CODES' && error.statusCode === 400
  );
});

module.exports = { freshDashboardData, mockSheets, BASE_FILTERS };

test('getDashboardData cache ket qua da tinh theo tung bo loc, khong tinh lai khi bo loc khong doi va raw sheets van con hieu luc', async () => {
  const { dashboardData, sheetsClient } = freshDashboardData();
  const callCounter = { count: 0 };
  mockSheets(sheetsClient, callCounter);
  dashboardData.__test__.resetCaches();

  await dashboardData.getDashboardData(BASE_FILTERS);
  await dashboardData.getDashboardData(BASE_FILTERS); // cung bo loc -> phai lay tu cache
  assert.equal(dashboardData.__test__.getComputeCallCount(), 1, 'bo loc khong doi -> khong tinh lai');

  const otherFilters = { ...BASE_FILTERS, products: { mode: 'days', days: 7 } };
  await dashboardData.getDashboardData(otherFilters); // bo loc khac -> phai tinh lai
  assert.equal(dashboardData.__test__.getComputeCallCount(), 2, 'bo loc khac -> phai tinh lai');

  dashboardData.__test__.expireSheetsCache();
  await dashboardData.getDashboardData(BASE_FILTERS); // raw sheets het han -> version moi -> phai tinh lai du bo loc giong lan dau
  assert.equal(dashboardData.__test__.getComputeCallCount(), 3, 'raw sheets refetch -> ket qua cu bi coi la stale, phai tinh lai');
  assert.equal(callCounter.count, 2, 'raw sheets phai duoc fetch lai dung 1 lan nua sau khi het han');
});

test('dashboardResultCache khong phinh vo han trong cung 1 phien ban raw sheets khi bo loc khac nhau khong gioi han', async () => {
  const { dashboardData, sheetsClient } = freshDashboardData();
  const callCounter = { count: 0 };
  mockSheets(sheetsClient, callCounter);
  dashboardData.__test__.resetCaches();

  // 40 bo loc khac nhau (> muc tran 32) nhung cung 1 phien ban raw sheets ->
  // phai bi cat bot, khong duoc phinh vo han theo so bo loc tu query string.
  for (let days = 1; days <= 40; days++) {
    await dashboardData.getDashboardData({ ...BASE_FILTERS, products: { mode: 'days', days } });
  }

  assert.equal(callCounter.count, 1, 'raw sheets van chi fetch 1 lan (chua het han 90s)');
  assert.equal(dashboardData.__test__.getComputeCallCount(), 40, 'moi bo loc khac nhau deu phai tinh rieng (chua bi cache trung)');
  assert.ok(
    dashboardData.__test__.getResultCacheSize() <= 32,
    `dashboardResultCache phai bi gioi han <= 32 entry, hien tai la ${dashboardData.__test__.getResultCacheSize()}`
  );
});

test('tim khach hang gan them revenue tong hop tu sheet Bao cao ban hang theo ky loc', async () => {
  const { dashboardData, sheetsClient } = freshDashboardData();
  const CONFIG = require('../config');
  sheetsClient.getMultipleSheetValues = async (names) => {
    const result = {};
    names.forEach(name => { result[name] = []; });
    if (names.includes(CONFIG.SHEET_CUSTOMERS)) {
      result[CONFIG.SHEET_CUSTOMERS] = [
        ['Mã khách hàng', 'Tên khách hàng', 'Điện thoại', 'Giới tính', 'Nhóm khách hàng', 'Địa chỉ', 'Email', 'Nợ hiện tại', 'Tổng bán'],
        ['KH-A', 'Khách A', '0900000001', 'Nữ', 'VIP', '', '', 500000, 12]
      ];
    }
    if (names.includes(CONFIG.SHEET_CUSTOMER_REPORT)) {
      const row = new Array(18).fill('');
      row[0] = 'KH-A'; row[1] = 'Khách A'; row[12] = '10/08/2026 10:00:00'; row[17] = 700000;
      const rowOutsideRange = new Array(18).fill('');
      rowOutsideRange[0] = 'KH-A'; rowOutsideRange[1] = 'Khách A'; rowOutsideRange[12] = '01/01/2020 10:00:00'; rowOutsideRange[17] = 999999;
      result[CONFIG.SHEET_CUSTOMER_REPORT] = [
        ['Mã KH', 'Tên KH', '', '', '', '', '', '', '', '', '', '', 'Thời gian', '', '', '', '', 'Doanh thu'],
        row,
        rowOutsideRange
      ];
    }
    return result;
  };
  dashboardData.__test__.resetCaches();

  const result = await dashboardData.searchDashboardRecords(
    'customers', 'Khách A', 'all', undefined,
    { mode: 'range', from: '08/08/2026', to: '12/08/2026' }
  );

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].code, 'KH-A');
  assert.equal(result.results[0].revenue, 700000, 'chi cong doanh thu trong khoang ngay duoc loc, bo qua dong ngoai ky');
});

test('tim khach hang khong co filterSpec van tra ve, revenue mac dinh 0 neu khong co du lieu bao cao', async () => {
  const { dashboardData, sheetsClient } = freshDashboardData();
  const CONFIG = require('../config');
  sheetsClient.getMultipleSheetValues = async (names) => {
    const result = {};
    names.forEach(name => { result[name] = []; });
    if (names.includes(CONFIG.SHEET_CUSTOMERS)) {
      result[CONFIG.SHEET_CUSTOMERS] = [
        ['Mã khách hàng', 'Tên khách hàng'],
        ['KH-Z', 'Khách Z']
      ];
    }
    return result;
  };
  dashboardData.__test__.resetCaches();

  const result = await dashboardData.searchDashboardRecords('customers', 'Khách Z', 'all');

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].revenue, 0);
});
