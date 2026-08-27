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

test('getDashboardData tong hop topRevenue tu sheet Hoa don khi sheet Bao cao ban hang khong co', async () => {
  const { dashboardData, sheetsClient, BASE_FILTERS } = freshDashboardData();
  const CONFIG = require('../config');
  sheetsClient.getMultipleSheetValues = async (names) => {
    const result = {};
    names.forEach(name => { result[name] = []; });
    if (names.includes(CONFIG.SHEET_CUSTOMERS)) {
      result[CONFIG.SHEET_CUSTOMERS] = [
        ['Mã khách hàng', 'Tên khách hàng', 'Điện thoại', 'Giới tính', 'Nhóm khách hàng', 'Địa chỉ', 'Email', 'Nợ hiện tại'],
        ['KH-01', 'Khách Số Một', '0901111111', '', '', '', '', 0],
        ['KH-02', 'Khách Số Hai', '0902222222', '', '', '', '', 0]
      ];
    }
    if (names.includes(CONFIG.SHEET_INVOICES)) {
      result[CONFIG.SHEET_INVOICES] = [
        ['Mã hóa đơn', 'Ngày bán', 'Khách hàng', 'SĐT khách', 'Nhân viên bán', 'Chi nhánh', 'Tổng tiền hàng', 'Giảm giá', 'Khách đã trả', 'Trạng thái', 'ID', 'ID gian', 'Mã đặt', 'ID CN', 'ID NV', 'ID KH', 'Mã khách hàng'],
        ['HD-01', '10/08/2026 10:00:00', 'Khách Số Một', '0901111111', '', '', 500000, 0, 500000, 'Hoàn thành', '', '', '', '', '', '', 'KH-01'],
        ['HD-02', '11/08/2026 14:00:00', 'Khách Số Một', '0901111111', '', '', 300000, 0, 300000, 'Hoàn thành', '', '', '', '', '', '', 'KH-01'],
        ['HD-03', '11/08/2026 15:00:00', 'Khách Số Hai', '0902222222', '', '', 1200000, 0, 1200000, 'Hoàn thành', '', '', '', '', '', '', 'KH-02'],
        ['HD-04', '11/08/2026 16:00:00', 'Khách Hủy', '0903333333', '', '', 9999999, 0, 0, 'Đã hủy', '', '', '', '', '', '', 'KH-03']
      ];
    }
    if (names.includes(CONFIG.SHEET_RETURNS)) {
      result[CONFIG.SHEET_RETURNS] = [
        ['Mã trả hàng', 'Ngày trả', 'Mã hóa đơn', 'Khách hàng', 'Tổng tiền trả', 'Trạng thái', 'ID', 'ID gian', 'ID HĐ', 'ID CN', 'CN', 'ID NV', 'NV', 'ID KH', 'Mã khách hàng'],
        ['TH-01', '12/08/2026 09:00:00', 'HD-03', 'Khách Số Hai', 200000, 'Hoàn thành', '', '', '', '', '', '', '', '', 'KH-02']
      ];
    }
    return result;
  };
  dashboardData.__test__.resetCaches();

  const data = await dashboardData.getDashboardData({
    ...BASE_FILTERS,
    customers: { mode: 'all' }
  });

  const topRevenue = data.customers.topRevenue;
  assert.ok(topRevenue, 'co topRevenue trong customers');
  assert.equal(topRevenue.top15.length, 2, 'co dung 2 khach hoan thanh giao dich');
  // KH-02: 1,200,000 - 200,000 = 1,000,000
  assert.equal(topRevenue.top15[0].code, 'KH-02');
  assert.equal(topRevenue.top15[0].revenue, 1000000);
  assert.equal(topRevenue.top15[0].saleOrderCount, 1);
  // KH-01: 500,000 + 300,000 = 800,000
  assert.equal(topRevenue.top15[1].code, 'KH-01');
  assert.equal(topRevenue.top15[1].revenue, 800000);
  assert.equal(topRevenue.top15[1].saleOrderCount, 2);
});


test('cache cua Ha Noi khong ro ri sang Sai Gon — moi co so fetch client rieng', async () => {
  const { dashboardData, sheetsClient } = freshDashboardData();
  const { BRANCHES } = require('../branch/branches');
  const seen = [];
  // Ghi de getSheetsClient de biet dashboardData hoi du lieu cua co so nao.
  sheetsClient.getSheetsClient = (branch) => ({
    getMultipleSheetValues: async (names) => {
      seen.push(branch);
      const result = {};
      names.forEach(name => { result[name] = []; });
      return result;
    }
  });
  dashboardData.__test__.resetCaches();

  await dashboardData.getDashboardData(BASE_FILTERS, BRANCHES.HANOI);
  await dashboardData.getDashboardData(BASE_FILTERS, BRANCHES.SAIGON);
  await dashboardData.getDashboardData(BASE_FILTERS, BRANCHES.HANOI);

  assert.deepEqual(
    seen,
    [BRANCHES.HANOI, BRANCHES.SAIGON],
    'moi co so fetch dung 1 lan; lan goi Ha Noi thu hai phai lay tu cache cua Ha Noi'
  );
});

// ===== getCustomerProductRevenueReport (tab Khach hang, phan 4) =====

const INVOICE_HEADERS = [
  'Mã hóa đơn', 'Ngày bán', 'Khách hàng', 'SĐT khách', 'Nhân viên bán', 'Chi nhánh',
  'Tổng tiền hàng', 'Giảm giá', 'Khách đã trả', 'Trạng thái', 'ID hóa đơn', 'Mã đặt hàng',
  'ID chi nhánh', 'ID nhân viên bán', 'ID khách hàng', 'Mã khách hàng', 'Mã trạng thái',
  'Tên trạng thái API', 'Ghi chú', 'Thu hộ COD', 'Ngày tạo'
];
const DETAIL_HEADERS = [
  'Mã hóa đơn', 'Mã hàng', 'Tên hàng', 'Số lượng', 'Đơn giá', 'Giảm giá', 'Thành tiền',
  'ID hóa đơn', 'ID hàng hóa', 'Giảm giá (%)', 'Ghi chú'
];

function invoiceRow({ code, date, name = '', phone = '', status = 'Hoàn thành', custCode = '' }) {
  const row = new Array(INVOICE_HEADERS.length).fill('');
  row[0] = code; row[1] = date; row[2] = name; row[3] = phone; row[9] = status; row[15] = custCode;
  return row;
}

function detailRow({ invoiceCode, itemCode, itemName, qty, total }) {
  const row = new Array(DETAIL_HEADERS.length).fill('');
  row[0] = invoiceCode; row[1] = itemCode; row[2] = itemName; row[3] = qty; row[6] = total;
  return row;
}

function mockCustomerProductRevenueSheets(sheetsClient, { invoices = [], details = [], customers = [] }) {
  const CONFIG = require('../config');
  sheetsClient.getMultipleSheetValues = async names => {
    const result = {};
    names.forEach(name => { result[name] = []; });
    result[CONFIG.SHEET_INVOICES] = [INVOICE_HEADERS, ...invoices];
    result[CONFIG.SHEET_INVOICE_DETAILS] = [DETAIL_HEADERS, ...details];
    result[CONFIG.SHEET_CUSTOMERS] = [['Mã khách hàng', 'Tên khách hàng', 'Điện thoại'], ...customers];
    return result;
  };
}

test('bao cao doanh thu theo khach: join dung hoa don hoan thanh/trong ky/dung khach, bo qua phan con lai', async () => {
  const { dashboardData, sheetsClient } = freshDashboardData();
  const now = new Date('2026-08-14T12:00:00+07:00');
  mockCustomerProductRevenueSheets(sheetsClient, {
    invoices: [
      invoiceRow({ code: 'HD-1', date: '10/08/2026 10:00:00', custCode: 'KH-A', status: 'Hoàn thành' }),
      invoiceRow({ code: 'HD-2', date: '10/08/2026 11:00:00', custCode: 'KH-A', status: 'Đang xử lý' }),
      invoiceRow({ code: 'HD-3', date: '10/08/2026 12:00:00', custCode: 'KH-B', status: 'Hoàn thành' }),
      invoiceRow({ code: 'HD-4', date: '01/01/2026 09:00:00', custCode: 'KH-A', status: 'Hoàn thành' })
    ],
    details: [
      detailRow({ invoiceCode: 'HD-1', itemCode: 'SP-01', itemName: 'Sản phẩm một', qty: 2, total: 200 }),
      detailRow({ invoiceCode: 'HD-1', itemCode: 'SP-02', itemName: 'Sản phẩm hai', qty: 1, total: 100 }),
      detailRow({ invoiceCode: 'HD-2', itemCode: 'SP-01', itemName: 'Sản phẩm một', qty: 5, total: 500 }),
      detailRow({ invoiceCode: 'HD-3', itemCode: 'SP-01', itemName: 'Sản phẩm một', qty: 9, total: 900 }),
      detailRow({ invoiceCode: 'HD-4', itemCode: 'SP-01', itemName: 'Sản phẩm một', qty: 7, total: 700 })
    ]
  });
  dashboardData.__test__.resetCaches();

  const report = await dashboardData.getCustomerProductRevenueReport('KH-A', '', undefined, now);

  assert.equal(report.customer.code, 'KH-A');
  assert.equal(report.totalRevenue, 300);
  assert.equal(report.totalQuantity, 3);
  assert.deepEqual(
    report.products.map(p => [p.code, p.quantity, p.revenue]),
    [['SP-01', 2, 200], ['SP-02', 1, 100]]
  );
});

test('bao cao doanh thu theo khach: totalRevenueByDay luon du 90 diem, ngay khong phat sinh la 0', async () => {
  const { dashboardData, sheetsClient } = freshDashboardData();
  const now = new Date('2026-08-14T12:00:00+07:00');
  mockCustomerProductRevenueSheets(sheetsClient, {
    invoices: [invoiceRow({ code: 'HD-1', date: '10/08/2026 10:00:00', custCode: 'KH-A' })],
    details: [detailRow({ invoiceCode: 'HD-1', itemCode: 'SP-01', itemName: 'Sản phẩm một', qty: 1, total: 150 })]
  });
  dashboardData.__test__.resetCaches();

  const report = await dashboardData.getCustomerProductRevenueReport('KH-A', '', undefined, now);

  assert.equal(report.totalRevenueByDay.length, 90);
  assert.equal(report.totalRevenueByDay.reduce((s, d) => s + d.revenue, 0), 150);
  const emptyDay = report.totalRevenueByDay.find(d => d.date === '01/08/2026');
  assert.equal(emptyDay.revenue, 0);
  const invoiceDay = report.totalRevenueByDay.find(d => d.date === '10/08/2026');
  assert.equal(invoiceDay.revenue, 150);
});

test('bao cao doanh thu theo khach: chia dung 3 bucket T.nay/T.truoc/T.truoc nua, loai hoa don o ngay thu 90', async () => {
  const { dashboardData, sheetsClient } = freshDashboardData();
  const now = new Date('2026-08-14T12:00:00+07:00');
  const offsetDates = {
    0: '14/08/2026', 29: '16/07/2026', 30: '15/07/2026',
    59: '16/06/2026', 60: '15/06/2026', 89: '17/05/2026', 90: '16/05/2026'
  };
  const invoices = Object.entries(offsetDates).map(([offset, date]) =>
    invoiceRow({ code: 'HD-' + offset, date: date + ' 08:00:00', custCode: 'KH-A' }));
  const details = Object.keys(offsetDates).map(offset =>
    detailRow({ invoiceCode: 'HD-' + offset, itemCode: 'SP-01', itemName: 'Sản phẩm một', qty: 1, total: 100 }));
  mockCustomerProductRevenueSheets(sheetsClient, { invoices, details });
  dashboardData.__test__.resetCaches();

  const report = await dashboardData.getCustomerProductRevenueReport('KH-A', '', undefined, now);
  const product = report.products.find(p => p.code === 'SP-01');

  assert.equal(product.month1Revenue, 200, 'ngay 0 va 29 thuoc T.nay');
  assert.equal(product.month2Revenue, 200, 'ngay 30 va 59 thuoc T.truoc');
  assert.equal(product.month3Revenue, 200, 'ngay 60 va 89 thuoc T.truoc nua');
  assert.equal(product.revenue, 600, 'hoa don ngay thu 90 nam ngoai cua so 90 ngay, khong duoc tinh');
});

test('bao cao doanh thu theo khach: khop khach qua SDT hoac ten khi hoa don thieu ma khach hang', async () => {
  const { dashboardData, sheetsClient } = freshDashboardData();
  const now = new Date('2026-08-14T12:00:00+07:00');
  mockCustomerProductRevenueSheets(sheetsClient, {
    customers: [['KH-A', 'Khách   A  ', '0900000001']],
    invoices: [
      invoiceRow({ code: 'HD-1', date: '10/08/2026 10:00:00', phone: '0900000001', status: 'Hoàn thành' }),
      invoiceRow({ code: 'HD-2', date: '11/08/2026 10:00:00', name: '  khách A', status: 'Hoàn thành' })
    ],
    details: [
      detailRow({ invoiceCode: 'HD-1', itemCode: 'SP-01', itemName: 'Sản phẩm một', qty: 1, total: 100 }),
      detailRow({ invoiceCode: 'HD-2', itemCode: 'SP-01', itemName: 'Sản phẩm một', qty: 1, total: 100 })
    ]
  });
  dashboardData.__test__.resetCaches();

  const report = await dashboardData.getCustomerProductRevenueReport('KH-A', '', undefined, now);

  assert.equal(report.totalRevenue, 200, 'ca 2 hoa don (khop qua SDT va qua ten chuan hoa) deu duoc tinh');
});

test('bao cao doanh thu theo khach: thieu ma khach hang thi bao loi ro rang, khong quet du lieu', async () => {
  const { dashboardData, sheetsClient } = freshDashboardData();
  mockSheets(sheetsClient, { count: 0 });
  dashboardData.__test__.resetCaches();

  await assert.rejects(
    dashboardData.getCustomerProductRevenueReport('', '', undefined, new Date('2026-08-14T12:00:00+07:00')),
    error => error.statusCode === 400 && error.code === 'CUSTOMER_CODE_REQUIRED'
  );
});

test('bao cao doanh thu theo khach: co lap theo chi nhanh, khong ro ri du lieu giua Ha Noi va Sai Gon', async () => {
  const { dashboardData, sheetsClient } = freshDashboardData();
  const { BRANCHES } = require('../branch/branches');
  const CONFIG = require('../config');
  const seen = [];
  sheetsClient.getSheetsClient = branch => ({
    getMultipleSheetValues: async names => {
      seen.push(branch);
      const result = {};
      names.forEach(name => { result[name] = []; });
      result[CONFIG.SHEET_INVOICES] = [INVOICE_HEADERS,
        invoiceRow({ code: 'HD-1', date: '10/08/2026 10:00:00', custCode: 'KH-A', status: 'Hoàn thành' })];
      result[CONFIG.SHEET_INVOICE_DETAILS] = [DETAIL_HEADERS,
        detailRow({ invoiceCode: 'HD-1', itemCode: 'SP-01', itemName: 'Sản phẩm một', qty: 1, total: branch === BRANCHES.SAIGON ? 999 : 100 })];
      return result;
    }
  });
  dashboardData.__test__.resetCaches();
  const now = new Date('2026-08-14T12:00:00+07:00');

  const hanoi = await dashboardData.getCustomerProductRevenueReport('KH-A', '', BRANCHES.HANOI, now);
  const saigon = await dashboardData.getCustomerProductRevenueReport('KH-A', '', BRANCHES.SAIGON, now);

  assert.equal(hanoi.totalRevenue, 100);
  assert.equal(saigon.totalRevenue, 999);
  assert.deepEqual(seen, [BRANCHES.HANOI, BRANCHES.SAIGON]);
});
