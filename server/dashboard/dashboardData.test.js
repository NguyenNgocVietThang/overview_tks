'use strict';
// Test nay tu set bien moi truong gia de config.js khong throw khi thieu
// .env that — khong dung tai khoan Google Sheets that trong test.
process.env.DEBT_MANAGEMENT_SPREADSHEET_ID = process.env.DEBT_MANAGEMENT_SPREADSHEET_ID || 'test-debt-management-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');

// Require lai module tu dau cho moi test de cac cache module-level (let o
// dashboardData.js) khong bi ro ri giua cac test.
//
// dashboardData.js doc du lieu KiotViet qua dashboardPgReader (Postgres) thay
// vi sheetsClient. HN1/HN3/HN7 doc qua customerDebtActivityRepository tu DB;
// "Khach theo hang hoa" doc qua customerProductTopRepository
// (SQL) thay vi 1 sheet rieng.
//
// getDashboardData() gio doc 2 nguon SONG SONG:
//   - dashboardPgReader.readCoreDashboardSheets() — 7/9 tab (bo "Chi tiết hóa
//     đơn"/"Nhập hàng") dung cho getDashboardData() (/api/dashboard).
//   - dashboardPgReader.readDashboardSheets() — du 9 tab, dung cho search/
//     export (getCachedDashboardSheets, khong doi).
//   - dashboardRollupRepository.js — thay the 2 tab da bo (doanh thu theo
//     ngay, top san pham, nhap hang theo NCC, ngay nhap dau tien...), dung
//     boi getDashboardData().
// Ca 3 mock nguon deu mac dinh tra rong/0 o day — tung test override lai khi
// can du lieu cu the.
function freshDashboardData() {
  delete require.cache[require.resolve('./dashboardData')];
  delete require.cache[require.resolve('./customerDebtActivityRepository')];
  delete require.cache[require.resolve('../sheets/debtManagementSheetsClient')];
  delete require.cache[require.resolve('./debtCollectionStatusRepository')];
  delete require.cache[require.resolve('./dashboardPgReader')];
  delete require.cache[require.resolve('./customerProductTopRepository')];
  delete require.cache[require.resolve('./dashboardRollupRepository')];
  const customerDebtActivityRepository = require('./customerDebtActivityRepository');
  customerDebtActivityRepository.readOperationalPeriods = async () => ({
    HN1: [['Khách hàng']], HN3: [['Khách hàng']], HN7: [['Khách hàng']]
  });
  const debtManagementSheetsClient = require('../sheets/debtManagementSheetsClient');
  debtManagementSheetsClient.getDebtManagementSheet = async branch => ({
    sourceSheet: branch === 'Sài Gòn' ? 'Công nợ SG' : 'Công nợ HN',
    rows: []
  });
  const debtCollectionStatusRepository = require('./debtCollectionStatusRepository');
  debtCollectionStatusRepository.listByBranch = async () => [];
  const dashboardPgReader = require('./dashboardPgReader');
  mockPgSheets(dashboardPgReader, {});
  const customerProductTopRepository = require('./customerProductTopRepository');
  customerProductTopRepository.findTopCustomersByProducts = async () => [];
  customerProductTopRepository.findTopCustomersByRevenueForProduct = async () => [];
  const dashboardRollupRepository = require('./dashboardRollupRepository');
  mockDashboardRollups(dashboardRollupRepository, {});
  const dashboardData = require('./dashboardData');
  return {
    dashboardData, customerDebtActivityRepository, debtManagementSheetsClient, debtCollectionStatusRepository,
    dashboardPgReader, customerProductTopRepository, dashboardRollupRepository
  };
}

// Ghi de dashboardPgReader.readDashboardSheets (du 9 tab, dung cho search/
// export) VA readCoreDashboardSheets (7/9 tab, dung cho getDashboardData) bang
// mock tra du lieu co san (rong cho moi tab, tru cac tab duoc chi dinh trong
// `overrides`) — mot override cho tab nam ngoai 7 tab "core" (Chi tiết hóa
// đơn/Nhập hàng) chi anh huong readDashboardSheets, khong anh huong
// readCoreDashboardSheets (giong dung hanh vi that).
function mockPgSheets(dashboardPgReader, overrides) {
  // readDashboardSheets (full): giu hanh vi cu — merge THANG moi override vao
  // ket qua, ke ca ten khong nam trong SHEET_NAMES (vd CONFIG.SHEET_CUSTOMER_REPORT,
  // tab khong co that trong Postgres nhung mot so test can gia lap "neu co").
  dashboardPgReader.readDashboardSheets = async () => {
    const result = {};
    dashboardPgReader.SHEET_NAMES.forEach(name => { result[name] = []; });
    Object.assign(result, overrides);
    return result;
  };
  // readCoreDashboardSheets (7/9 tab): CHI nhan override cho ten thuc su nam
  // trong CORE_SHEET_NAMES — giong dung san pham that (khong bao gio tra "Chi
  // tiết hóa đơn"/"Nhập hàng"/tab khong ton tai).
  dashboardPgReader.readCoreDashboardSheets = async () => {
    const result = {};
    dashboardPgReader.CORE_SHEET_NAMES.forEach(name => { result[name] = []; });
    Object.keys(overrides || {}).forEach(name => {
      if (dashboardPgReader.CORE_SHEET_NAMES.includes(name)) result[name] = overrides[name];
    });
    return result;
  };
}

// Nhu mockPgSheets nhung dem so lan goi thuc su (khong tinh lan lay tu cache).
// `variant: 'full'` (mac dinh) dem readDashboardSheets (dung cho test lien
// quan search/export cache); `variant: 'core'` dem readCoreDashboardSheets
// (dung cho test lien quan cache cua getDashboardData).
function mockPgSheetsCounted(dashboardPgReader, callCounter, { variant = 'full' } = {}) {
  const fn = async () => {
    callCounter.count += 1;
    const names = variant === 'core' ? dashboardPgReader.CORE_SHEET_NAMES : dashboardPgReader.SHEET_NAMES;
    const result = {};
    names.forEach(name => { result[name] = []; });
    return result;
  };
  if (variant === 'core') dashboardPgReader.readCoreDashboardSheets = fn;
  else dashboardPgReader.readDashboardSheets = fn;
}

// Ghi de toan bo dashboardRollupRepository bang gia tri rong/0 mac dinh, roi
// ap dung `overrides` (map tenHam -> gia tri tra ve, hoac tenHam -> function
// async tuy chinh) — dung cho cac test can kiem soat du lieu rollup cu the.
function mockDashboardRollups(dashboardRollupRepository, overrides = {}) {
  const defaults = {
    getInvoiceRevenueByDay: () => [],
    getProductSalesBreakdown: () => [],
    getTopSellingProducts: () => [],
    getPurchasesBySupplier: () => [],
    getPurchaseTotals: () => ({ orderCount: 0, total: 0 }),
    getFirstPurchaseDates: () => [],
    getInvoiceQuantitiesByCode: () => [],
    listPurchaseOrders: () => []
  };
  Object.keys(defaults).forEach(name => {
    const override = overrides[name];
    if (typeof override === 'function') {
      dashboardRollupRepository[name] = async (...args) => override(...args);
    } else if (override !== undefined) {
      dashboardRollupRepository[name] = async () => override;
    } else {
      dashboardRollupRepository[name] = async () => defaults[name]();
    }
  });
}

const BASE_FILTERS = {
  overview: { mode: 'days', days: 30 },
  products: { mode: 'days', days: 30 },
  invoices: { mode: 'days', days: 30 },
  customers: { mode: 'all' },
  newPurchases: { mode: 'days', days: 30 },
  newProducts: { mode: 'days', days: 30 }
};

test('rememberSearchSheets chi rebuild search index khi raw sheet data (cache "full") thuc su duoc fetch lai, khong phai moi lan tim kiem', async () => {
  // getDashboardData() (/api/dashboard) gio doc cache "core", KHONG con dong
  // bo chi muc tim kiem nua (xem getCachedDashboardCoreSheets trong
  // dashboardData.js) — chi muc chi con duoc dong bo boi cache "full" khi co
  // request tim kiem thuc su (searchDashboardRecords -> getSearchSheets).
  const { dashboardData, dashboardPgReader } = freshDashboardData();
  const callCounter = { count: 0 };
  mockPgSheetsCounted(dashboardPgReader, callCounter, { variant: 'full' });
  dashboardData.__test__.resetCaches();

  await dashboardData.searchDashboardRecords('products', 'sp', 'all');
  await dashboardData.searchDashboardRecords('products', 'sp', 'all');
  await dashboardData.searchDashboardRecords('invoices', 'hd', 'all');

  assert.equal(callCounter.count, 1, 'raw sheets (full) phai duoc fetch dung 1 lan (con cache 90s)');
  assert.equal(
    dashboardData.__test__.getSearchIndexBuildCount(),
    1,
    'search index chi duoc rebuild 1 lan, khong phai moi lan tim kiem'
  );
});

test('getCachedDashboardCoreSheets dung stale-while-revalidate: cache vua het han van tra du lieu cu ngay lap tuc, am tham lam moi o nen', async () => {
  const { dashboardData, dashboardPgReader } = freshDashboardData();
  const callCounter = { count: 0 };
  let releaseSecondFetch;
  dashboardPgReader.readCoreDashboardSheets = async () => {
    callCounter.count += 1;
    const result = {};
    dashboardPgReader.CORE_SHEET_NAMES.forEach(name => { result[name] = []; });
    if (callCounter.count === 2) {
      await new Promise(resolve => { releaseSecondFetch = resolve; });
    }
    return result;
  };
  dashboardData.__test__.resetCaches();

  await dashboardData.getDashboardData(BASE_FILTERS);
  assert.equal(callCounter.count, 1, 'lan goi dau tien phai fetch that');

  dashboardData.__test__.expireSheetsCacheSoftly();

  const startedAt = Date.now();
  await dashboardData.getDashboardData(BASE_FILTERS);
  const elapsedMs = Date.now() - startedAt;

  assert.equal(callCounter.count, 2, 'cache het han phai kich hoat lam moi nen ngay');
  assert.ok(elapsedMs < 500, `khong duoc cho fetch nen (dang treo) hoan tat, nhung mat ${elapsedMs}ms`);

  releaseSecondFetch();
  await new Promise(resolve => setImmediate(resolve));
});

test('tim nhieu ma khop chinh xac, bo ma trung va giu thu tu ma nhap', async () => {
  const { dashboardData, dashboardPgReader } = freshDashboardData();
  const CONFIG = require('../config');
  mockPgSheets(dashboardPgReader, {
    [CONFIG.SHEET_PRODUCTS]: [
      ['Mã hàng', 'Tên hàng'],
      ['SP-02', 'Sản phẩm hai'],
      ['SP-01', 'Sản phẩm một'],
      ['SP-010', 'Không được khớp một phần']
    ]
  });
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
  const { dashboardData } = freshDashboardData();
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
  const { dashboardData, dashboardPgReader } = freshDashboardData();
  const CONFIG = require('../config');
  mockPgSheets(dashboardPgReader, {
    [CONFIG.SHEET_PRODUCTS]: [
      ['Mã hàng', 'Tên hàng'],
      ['AT-01', 'Áo thun xanh']
    ]
  });
  dashboardData.__test__.resetCaches();

  const result = await dashboardData.searchDashboardRecords('products', 'áo thun', 'all');
  assert.deepEqual(result.results.map(item => item.code), ['AT-01']);
});

// Cac dong nay mo phong dung KET QUA DA GOM (nhu customerProductTopRepository
// se tra ve sau khi chay SQL that) — logic gom/khu trung/xep hang gio nam
// trong SQL (xem server/dashboard/customerProductTopRepository.js va test
// rieng cua no), nen o day chi con kiem tra dashboardData.js NOI DAY dung:
// giu thu tu ma theo yeu cau, dat ten lai truong "...AllTime", tinh netRevenue,
// format ngay dd/MM/yyyy, va chuyen dung filter/range/limit xuong repository.
function mockTopCustomerRows() {
  return [
    {
      productCode: 'SP-02', productName: 'Sản phẩm hai', customerCode: '', customerName: 'Khách lẻ',
      purchasedQuantity: 2, purchaseRevenue: 250, returnedQuantity: 0, returnValue: 0,
      lastPurchaseDate: new Date('2026-08-12T08:00:00+07:00')
    },
    {
      productCode: 'SP-01', productName: 'Sản phẩm một', customerCode: 'KH-B', customerName: 'Khách B',
      purchasedQuantity: 8, purchaseRevenue: 700, returnedQuantity: 0, returnValue: 0,
      lastPurchaseDate: new Date('2026-08-11T09:00:00+07:00')
    },
    {
      productCode: 'SP-01', productName: 'Sản phẩm một', customerCode: 'KH-C', customerName: 'Khách C',
      purchasedQuantity: 8, purchaseRevenue: 650, returnedQuantity: 1, returnValue: 50,
      lastPurchaseDate: new Date('2026-08-12T10:00:00+07:00')
    },
    {
      productCode: 'SP-01', productName: 'Sản phẩm một', customerCode: 'KH-D', customerName: 'Khách D',
      purchasedQuantity: 8, purchaseRevenue: 650, returnedQuantity: 1, returnValue: 50,
      lastPurchaseDate: new Date('2026-08-12T10:00:00+07:00')
    }
  ];
}

test('top KH theo san pham: giu thu tu ma theo yeu cau, doi ten truong AllTime, tinh netRevenue va format ngay', async () => {
  const { dashboardData, customerProductTopRepository } = freshDashboardData();
  const calls = [];
  customerProductTopRepository.findTopCustomersByProducts = async (args) => {
    calls.push(args);
    return mockTopCustomerRows();
  };
  dashboardData.__test__.resetCaches();

  const result = await dashboardData.searchTopCustomersByProducts(
    ' SP-02\nsp-01 SP-02 KHONG-CO ',
    { mode: 'range', from: '2026-08-10', to: '2026-08-12' },
    new Date('2026-08-14T12:00:00+07:00')
  );

  assert.equal(calls.length, 1, 'searchTopCustomersByProducts goi repository dung 1 lan (khong con cache o tang dashboardData — repository/Postgres chiu trach nhiem hieu nang)');
  assert.deepEqual(calls[0].codes, ['SP-02', 'sp-01', 'KHONG-CO'], 'ma trung nhau bi bo, giu nguyen thu tu xuat hien dau tien');
  assert.equal(calls[0].limit, 3);
  assert.equal(calls[0].range.mode, 'range');

  assert.equal(result.requestedCount, 3);
  assert.equal(result.matchedCount, 2, 'chi 2 ma hang co trong ket qua repository tra ve (SP-02, SP-01)');
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
    ],
    'SP-02 dung truoc SP-01 vi xuat hien truoc trong query, dung thu tu repository tra ve trong tung ma'
  );

  const customerC = result.results.find(item => item.customerName === 'Khách C');
  assert.equal(customerC.returnedQuantityAllTime, 1);
  assert.equal(customerC.returnValueAllTime, 50);
  assert.equal(customerC.netRevenue, 600);
  assert.equal(customerC.lastPurchaseDate, '12/08/2026');
});

test('top KH theo san pham: chuyen dung khoang ngay 1/7/30/90/tat ca xuong repository', async () => {
  const { dashboardData, customerProductTopRepository } = freshDashboardData();
  const capturedRanges = [];
  customerProductTopRepository.findTopCustomersByProducts = async ({ range }) => {
    capturedRanges.push(range);
    return [];
  };
  dashboardData.__test__.resetCaches();
  const now = new Date('2026-08-14T12:00:00+07:00');

  await dashboardData.searchTopCustomersByProducts('SP-01', { mode: 'days', days: 1 }, now);
  await dashboardData.searchTopCustomersByProducts('SP-01', { mode: 'days', days: 7 }, now);
  await dashboardData.searchTopCustomersByProducts('SP-01', { mode: 'days', days: 30 }, now);
  await dashboardData.searchTopCustomersByProducts('SP-01', { mode: 'days', days: 90 }, now);
  const allTime = await dashboardData.searchTopCustomersByProducts('SP-01', { mode: 'all' }, now);

  assert.equal(capturedRanges.length, 5);
  assert.deepEqual(capturedRanges.map(r => r.days), [1, 7, 30, 90, undefined]);
  const DAY_MS = 24 * 60 * 60 * 1000;
  assert.ok(capturedRanges[0].start.getTime() <= now.getTime() && now.getTime() <= capturedRanges[0].end.getTime(), 'khoang 1 ngay phai chua thoi diem now');
  assert.ok(
    capturedRanges[0].end.getTime() - capturedRanges[0].start.getTime() < 2 * DAY_MS,
    'khoang "1 ngày" phai ngan hon nhieu so voi khoang "90 ngày"'
  );
  assert.ok(
    capturedRanges[3].end.getTime() - capturedRanges[3].start.getTime() > 80 * DAY_MS,
    'khoang "90 ngày" phai dai hon nhieu so voi khoang "1 ngày"'
  );
  assert.equal(capturedRanges[4].mode, 'all');
  assert.equal(capturedRanges[4].start, null);
  assert.equal(capturedRanges[4].end, null);
  assert.equal(allTime.filter.label, 'Tất cả');
});

test('top KH theo san pham chap nhan 50 ma va tu choi 51 ma', async () => {
  const { dashboardData } = freshDashboardData();
  dashboardData.__test__.resetCaches();

  const fiftyCodes = Array.from({ length: 50 }, (_, index) => `MA-${index + 1}`).join(' ');
  const accepted = await dashboardData.searchTopCustomersByProducts(fiftyCodes, { mode: 'all' });
  assert.equal(accepted.requestedCount, 50);

  await assert.rejects(
    dashboardData.searchTopCustomersByProducts(`${fiftyCodes} MA-51`, { mode: 'all' }),
    error => error.code === 'TOO_MANY_SEARCH_CODES' && error.statusCode === 400
  );
});

module.exports = { freshDashboardData, mockPgSheets, mockPgSheetsCounted, mockDashboardRollups, BASE_FILTERS };

test('getDashboardData cache ket qua da tinh theo tung bo loc, khong tinh lai khi bo loc khong doi va raw sheets van con hieu luc', async () => {
  const { dashboardData, dashboardPgReader } = freshDashboardData();
  const callCounter = { count: 0 };
  mockPgSheetsCounted(dashboardPgReader, callCounter, { variant: 'core' });
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
  const { dashboardData, dashboardPgReader } = freshDashboardData();
  const callCounter = { count: 0 };
  mockPgSheetsCounted(dashboardPgReader, callCounter, { variant: 'core' });
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
  // GHI CHU: dashboardPgReader.readDashboardSheets() THAT (production) khong
  // bao gio tra CONFIG.SHEET_CUSTOMER_REPORT (khong co bang Postgres tuong
  // ung — xem SRS/plan), nen nhanh nay chi con ton tai de phong truong hop
  // sau nay co nguon du lieu bo sung cho tab do. Mock o day gia lap tinh
  // huong "sheet co san" de xac nhan dashboardData.js van uu tien dung no khi
  // co, truoc khi rot xuong fallback tinh tu Hoa don+Khach hang+Tra hang.
  const { dashboardData, dashboardPgReader } = freshDashboardData();
  const CONFIG = require('../config');
  const row = new Array(18).fill('');
  row[0] = 'KH-A'; row[1] = 'Khách A'; row[12] = '10/08/2026 10:00:00'; row[17] = 700000;
  const rowOutsideRange = new Array(18).fill('');
  rowOutsideRange[0] = 'KH-A'; rowOutsideRange[1] = 'Khách A'; rowOutsideRange[12] = '01/01/2020 10:00:00'; rowOutsideRange[17] = 999999;
  mockPgSheets(dashboardPgReader, {
    [CONFIG.SHEET_CUSTOMERS]: [
      ['Mã khách hàng', 'Tên khách hàng', 'Điện thoại', 'Giới tính', 'Nhóm khách hàng', 'Địa chỉ', 'Email', 'Nợ hiện tại', 'Tổng bán'],
      ['KH-A', 'Khách A', '0900000001', 'Nữ', 'VIP', '', '', 500000, 12]
    ],
    [CONFIG.SHEET_CUSTOMER_REPORT]: [
      ['Mã KH', 'Tên KH', '', '', '', '', '', '', '', '', '', '', 'Thời gian', '', '', '', '', 'Doanh thu'],
      row,
      rowOutsideRange
    ]
  });
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
  const { dashboardData, dashboardPgReader } = freshDashboardData();
  const CONFIG = require('../config');
  mockPgSheets(dashboardPgReader, {
    [CONFIG.SHEET_CUSTOMERS]: [
      ['Mã khách hàng', 'Tên khách hàng'],
      ['KH-Z', 'Khách Z']
    ]
  });
  dashboardData.__test__.resetCaches();

  const result = await dashboardData.searchDashboardRecords('customers', 'Khách Z', 'all');

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].revenue, 0);
});

test('getDashboardData tong hop topRevenue tu sheet Hoa don khi sheet Bao cao ban hang khong co', async () => {
  const { dashboardData, dashboardPgReader } = freshDashboardData();
  const CONFIG = require('../config');
  mockPgSheets(dashboardPgReader, {
    [CONFIG.SHEET_CUSTOMERS]: [
      ['Mã khách hàng', 'Tên khách hàng', 'Điện thoại', 'Giới tính', 'Nhóm khách hàng', 'Địa chỉ', 'Email', 'Nợ hiện tại'],
      ['KH-01', 'Khách Số Một', '0901111111', '', '', '', '', 0],
      ['KH-02', 'Khách Số Hai', '0902222222', '', '', '', '', 0]
    ],
    [CONFIG.SHEET_INVOICES]: [
      ['Mã hóa đơn', 'Ngày bán', 'Khách hàng', 'SĐT khách', 'Nhân viên bán', 'Chi nhánh', 'Tổng tiền hàng', 'Giảm giá', 'Khách đã trả', 'Trạng thái', 'ID', 'ID gian', 'Mã đặt', 'ID CN', 'ID NV', 'ID KH', 'Mã khách hàng'],
      ['HD-01', '10/08/2026 10:00:00', 'Khách Số Một', '0901111111', '', '', 500000, 0, 500000, 'Hoàn thành', '', '', '', '', '', '', 'KH-01'],
      ['HD-02', '11/08/2026 14:00:00', 'Khách Số Một', '0901111111', '', '', 300000, 0, 300000, 'Hoàn thành', '', '', '', '', '', '', 'KH-01'],
      ['HD-03', '11/08/2026 15:00:00', 'Khách Số Hai', '0902222222', '', '', 1200000, 0, 1200000, 'Hoàn thành', '', '', '', '', '', '', 'KH-02'],
      ['HD-04', '11/08/2026 16:00:00', 'Khách Hủy', '0903333333', '', '', 9999999, 0, 0, 'Đã hủy', '', '', '', '', '', '', 'KH-03']
    ],
    [CONFIG.SHEET_RETURNS]: [
      ['Mã trả hàng', 'Ngày trả', 'Mã hóa đơn', 'Khách hàng', 'Tổng tiền trả', 'Trạng thái', 'ID', 'ID gian', 'ID HĐ', 'ID CN', 'CN', 'ID NV', 'NV', 'ID KH', 'Mã khách hàng'],
      ['TH-01', '12/08/2026 09:00:00', 'HD-03', 'Khách Số Hai', 200000, 'Hoàn thành', '', '', '', '', '', '', '', '', 'KH-02']
    ]
  });
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

test('getDashboardData tra toan bo dat hang/tra hang trong khoang loc, khong cat 8 dong, moi nhat len dau', async () => {
  const { dashboardData, dashboardPgReader } = freshDashboardData();
  const CONFIG = require('../config');
  const pad = n => String(n).padStart(2, '0');
  const orderRows = [];
  const returnRows = [];
  for (let i = 1; i <= 12; i++) {
    orderRows.push([`DH-${pad(i)}`, `${pad(i)}/08/2026 09:00:00`, 'Khách A', '', '', '', 100000 * i, 'Phiếu tạm']);
    returnRows.push([`TH-${pad(i)}`, `${pad(i)}/08/2026 10:00:00`, 'HD-01', 'Khách A', 50000 * i, 'Đã trả hàng']);
  }
  mockPgSheets(dashboardPgReader, {
    [CONFIG.SHEET_ORDERS]: [['Mã đặt hàng', 'Ngày đặt', 'Khách hàng', 'Nhân viên lập', 'Chi nhánh', 'Tổng tiền', 'Trạng thái'], ...orderRows]
      .map((row, index) => index === 0 ? row : [row[0], row[1], row[2], row[3], row[4], row[6], row[7]]),
    [CONFIG.SHEET_RETURNS]: [['Mã trả hàng', 'Ngày trả', 'Mã hóa đơn', 'Khách hàng', 'Tổng tiền trả', 'Trạng thái'], ...returnRows]
  });
  dashboardData.__test__.resetCaches();

  const data = await dashboardData.getDashboardData({ ...BASE_FILTERS, invoices: { mode: 'all' } });

  assert.equal(data.invoices.periodOrders.length, 12);
  assert.equal(data.invoices.periodOrders[0].code, 'DH-12');
  assert.equal(data.invoices.periodOrders[11].code, 'DH-01');
  assert.equal(data.invoices.periodReturns.length, 12);
  assert.equal(data.invoices.periodReturns[0].code, 'TH-12');
  assert.equal(data.invoices.recentOrders, undefined);
  assert.equal(data.invoices.recentReturns, undefined);
});


test('cache cua Ha Noi khong ro ri sang Sai Gon — moi co so fetch rieng', async () => {
  const { dashboardData, dashboardPgReader, customerDebtActivityRepository, debtManagementSheetsClient } = freshDashboardData();
  const { BRANCHES } = require('../branch/branches');
  const seen = [];
  // Ghi de dashboardPgReader.readCoreDashboardSheets de biet getDashboardData
  // hoi du lieu cua co so nao (nguon chinh cho /api/dashboard, nhan branch
  // truc tiep).
  dashboardPgReader.readCoreDashboardSheets = async (branch) => {
    seen.push(branch);
    const result = {};
    dashboardPgReader.CORE_SHEET_NAMES.forEach(name => { result[name] = []; });
    return result;
  };
  customerDebtActivityRepository.readOperationalPeriods = async () => ({
    HN1: [['Khách hàng']], HN3: [['Khách hàng']], HN7: [['Khách hàng']]
  });
  debtManagementSheetsClient.getDebtManagementSheet = async branch => ({
    sourceSheet: branch === BRANCHES.SAIGON ? 'Công nợ SG' : 'Công nợ HN',
    rows: []
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

test('dashboard tải song song nguồn vận hành và workbook công nợ rồi trả debtManagement thay cho debt cũ', async () => {
  const { dashboardData, customerDebtActivityRepository, debtManagementSheetsClient } = freshDashboardData();
  const started = [];
  let releaseOperating;
  let releaseDebt;
  const operatingGate = new Promise(resolve => { releaseOperating = resolve; });
  const debtGate = new Promise(resolve => { releaseDebt = resolve; });

  customerDebtActivityRepository.readOperationalPeriods = async () => {
    started.push('operating');
    await operatingGate;
    return { HN1: [['Khách hàng']], HN3: [['Khách hàng'], ['Khách A']], HN7: [['Khách hàng']] };
  };
  debtManagementSheetsClient.getDebtManagementSheet = async () => {
    started.push('debt');
    await debtGate;
    return {
      sourceSheet: 'Công nợ HN',
      rows: [
        ['Khách hàng', 'Sale', 'Lịch TT HN', 'Nợ đầu kỳ', 'Nợ hiện tại', 'Nợ quá hạn', '% nợ/Doanh số', '% quá hạn / TB DS', 'TB T6/26-T9/26'],
        ['TỔNG'],
        ['Khách A', 'Lan', 1, 0, 500000, 0, 0.5, 0, 1000000]
      ]
    };
  };
  dashboardData.__test__.resetCaches();

  const pending = dashboardData.getDashboardData(BASE_FILTERS);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started.sort(), ['debt', 'operating']);
  releaseOperating();
  releaseDebt();
  const result = await pending;

  assert.equal(result.debt, undefined);
  assert.equal(result.debtManagement.available, true);
  assert.deepEqual(result.debtManagement.customers[0].alertCodes, ['uncollected']);
});

test('cache nguồn công nợ độc lập 90 giây và phiên bản nguồn nằm trong cache key kết quả', async () => {
  const { dashboardData, customerDebtActivityRepository, debtManagementSheetsClient } = freshDashboardData();
  let operatingFetches = 0;
  let debtFetches = 0;
  customerDebtActivityRepository.readOperationalPeriods = async () => {
    operatingFetches += 1;
    return { HN1: [['Khách hàng']], HN3: [['Khách hàng']], HN7: [['Khách hàng']] };
  };
  debtManagementSheetsClient.getDebtManagementSheet = async () => {
    debtFetches += 1;
    return { sourceSheet: 'Công nợ HN', rows: [] };
  };
  dashboardData.__test__.resetCaches();

  await dashboardData.getDashboardData(BASE_FILTERS);
  await dashboardData.getDashboardData(BASE_FILTERS);
  assert.equal(operatingFetches, 1);
  assert.equal(debtFetches, 1);
  assert.equal(dashboardData.__test__.getComputeCallCount(), 1);

  dashboardData.__test__.expireDebtManagementCache();
  await dashboardData.getDashboardData(BASE_FILTERS);
  assert.equal(operatingFetches, 1);
  assert.equal(debtFetches, 2);
  assert.equal(dashboardData.__test__.getComputeCallCount(), 2);
});

test('lỗi workbook công nợ chỉ làm debtManagement unavailable, không làm sập dashboard', async () => {
  const { dashboardData, debtManagementSheetsClient } = freshDashboardData();
  debtManagementSheetsClient.getDebtManagementSheet = async () => {
    const error = new Error('Workbook chưa cấu hình');
    error.code = 'BRANCH_NOT_CONFIGURED';
    throw error;
  };
  dashboardData.__test__.resetCaches();

  const result = await dashboardData.getDashboardData(BASE_FILTERS);
  assert.equal(result.debtManagement.available, false);
  assert.ok(result.debtManagement.dataWarnings.some(warning => warning.includes('Workbook chưa cấu hình')));
  assert.ok(result.overview);
});

test('dashboard ghép workflow theo cơ sở, phân quyền sửa và khóa khi PostgreSQL lỗi', async () => {
  const { dashboardData, customerDebtActivityRepository, debtManagementSheetsClient, debtCollectionStatusRepository } = freshDashboardData();
  const { createAlertSignature } = require('./debtManagement');
  customerDebtActivityRepository.readOperationalPeriods = async () => ({
    HN1: [['Khách hàng']], HN3: [['Khách hàng']], HN7: [['Khách hàng']]
  });
  debtManagementSheetsClient.getDebtManagementSheet = async () => ({
    sourceSheet: 'Công nợ HN',
    rows: [
      ['Khách hàng', 'Sale', 'Lịch TT HN', 'Nợ đầu kỳ', 'Nợ hiện tại', 'Nợ quá hạn', '% nợ/Doanh số', '% quá hạn / TB DS', 'TB T6/26-T9/26'],
      ['TỔNG'],
      ['Khách A', 'Lan', 7, 0, 500000, 500000, 0.5, 0.5, 1000000]
    ]
  });
  const signature = createAlertSignature(['overdue'], 500000, 500000);
  debtCollectionStatusRepository.listByBranch = async branch => [{
    branch,
    customer_key: require('node:crypto').createHash('sha256').update('khách a').digest('hex'),
    status: 'Đã xử lý',
    alert_signature: signature,
    updated_by_name: 'Quản lý'
  }];
  dashboardData.__test__.resetCaches();

  const manager = await dashboardData.getDashboardData(BASE_FILTERS, 'Hà Nội', { vaiTro: 'Quản lý' });
  assert.equal(manager.debtManagement.customers[0].workflowStatus, 'Đã xử lý');
  assert.equal(manager.debtManagement.customers[0].needsAction, false);
  assert.equal(manager.debtManagement.customers[0].canEditStatus, true);

  const accountant = await dashboardData.getDashboardData(BASE_FILTERS, 'Hà Nội', { vaiTro: 'Kế toán' });
  assert.equal(accountant.debtManagement.customers[0].canEditStatus, false);

  dashboardData.__test__.resetCaches();
  debtCollectionStatusRepository.listByBranch = async () => { throw new Error('db down'); };
  const unavailable = await dashboardData.getDashboardData(BASE_FILTERS, 'Hà Nội', { vaiTro: 'Quản lý' });
  assert.equal(unavailable.debtManagement.customers[0].canEditStatus, false);
  assert.ok(unavailable.debtManagement.dataWarnings.some(warning => warning.includes('trạng thái xử lý')));
});

test('findDebtCustomerBranches tra chu ky canh bao RIENG cua tung co so, co so khong doc duoc la "chua xac dinh"', async () => {
  const { dashboardData, debtManagementSheetsClient } = freshDashboardData();
  const crypto = require('node:crypto');
  const { createAlertSignature } = require('./debtManagement');
  const headerFor = branch => ['Khách hàng', 'Sale', branch === 'Sài Gòn' ? 'Lịch TT SG' : 'Lịch TT HN',
    'Nợ đầu kỳ', 'Nợ hiện tại', 'Nợ quá hạn', '% nợ/Doanh số', '% quá hạn / TB DS', 'TB T6/26-T9/26'];
  // Cung mot khach o CA HAI co so nhung so no khac nhau -> chu ky canh bao
  // khac nhau: Ha Noi co no qua han (canh bao "Quá hạn"), Sai Gon thi khong.
  const rowFor = branch => (branch === 'Sài Gòn'
    ? ['Khách A', 'Lan', 7, 0, 700000, 0, 0, 0, 0]
    : ['Khách A', 'Lan', 7, 0, 500000, 500000, 0, 0, 0]);
  debtManagementSheetsClient.getDebtManagementSheet = async branch => ({
    sourceSheet: branch === 'Sài Gòn' ? 'Công nợ SG' : 'Công nợ HN',
    rows: [headerFor(branch), ['TỔNG'], rowFor(branch)]
  });
  dashboardData.__test__.resetCaches();

  const keyA = crypto.createHash('sha256').update('khách a').digest('hex');
  const hanoiSignature = createAlertSignature(['overdue'], 500000, 500000);
  const saigonSignature = createAlertSignature([], 700000, 0);
  assert.notEqual(hanoiSignature, saigonSignature);

  const both = await dashboardData.findDebtCustomerBranches(keyA, ['Hà Nội', 'Sài Gòn']);
  assert.deepEqual(both, {
    found: [
      { branch: 'Hà Nội', alertSignature: hanoiSignature },
      { branch: 'Sài Gòn', alertSignature: saigonSignature }
    ],
    undetermined: []
  });

  const missing = await dashboardData.findDebtCustomerBranches('f'.repeat(64), ['Hà Nội', 'Sài Gòn']);
  assert.deepEqual(missing, { found: [], undetermined: [] });

  dashboardData.__test__.resetCaches();
  debtManagementSheetsClient.getDebtManagementSheet = async branch => {
    if (branch === 'Sài Gòn') throw new Error('Sheets loi');
    return { sourceSheet: 'Công nợ HN', rows: [headerFor(branch), ['TỔNG'], rowFor(branch)] };
  };
  const partial = await dashboardData.findDebtCustomerBranches(keyA, ['Hà Nội', 'Sài Gòn']);
  assert.deepEqual(partial, {
    found: [{ branch: 'Hà Nội', alertSignature: hanoiSignature }],
    undetermined: ['Sài Gòn']
  });
});

test('Ca hai: trang thai ket thuc ghi kem chu ky RIENG tung co so thi khong bi het hieu luc o co so con lai', async () => {
  const { dashboardData, debtManagementSheetsClient, debtCollectionStatusRepository } = freshDashboardData();
  const crypto = require('node:crypto');
  const { BRANCHES, BRANCH_BOTH } = require('../branch/branches');
  const { createAlertSignature } = require('./debtManagement');
  const headerFor = branch => ['Khách hàng', 'Sale', branch === BRANCHES.SAIGON ? 'Lịch TT SG' : 'Lịch TT HN',
    'Nợ đầu kỳ', 'Nợ hiện tại', 'Nợ quá hạn', '% nợ/Doanh số', '% quá hạn / TB DS', 'TB'];
  debtManagementSheetsClient.getDebtManagementSheet = async branch => ({
    sourceSheet: branch === BRANCHES.SAIGON ? 'Công nợ SG' : 'Công nợ HN',
    rows: [headerFor(branch), ['TỔNG'], branch === BRANCHES.SAIGON
      ? ['Khách A', 'Lan', 7, 0, 800000, 800000, 0, 0, 0]
      : ['Khách A', 'Lan', 7, 0, 500000, 500000, 0, 0, 0]]
  });
  const customerKey = crypto.createHash('sha256').update('khách a').digest('hex');
  const signatureByBranch = {
    [BRANCHES.HANOI]: createAlertSignature(['overdue'], 500000, 500000),
    [BRANCHES.SAIGON]: createAlertSignature(['overdue'], 800000, 800000)
  };
  const storedStatus = (branch, alertSignature) => [{
    branch, customer_key: customerKey, status: 'Đã xử lý', alert_signature: alertSignature, updated_by_name: 'Quản lý'
  }];

  // Sau khi sua: moi co so giu chu ky cua chinh no.
  debtCollectionStatusRepository.listByBranch = async branchCode => storedStatus(
    branchCode,
    branchCode === 'saigon' ? signatureByBranch[BRANCHES.SAIGON] : signatureByBranch[BRANCHES.HANOI]
  );
  dashboardData.__test__.resetCaches();
  const fixed = await dashboardData.getDashboardData(BASE_FILTERS, BRANCH_BOTH, { vaiTro: 'Quản lý' });
  const mergedFixed = fixed.debtManagement.customers.find(customer => customer.customerKey === customerKey);
  assert.equal(mergedFixed.workflowStatus, 'Đã xử lý');
  assert.equal(mergedFixed.needsAction, false, 'khong con mau thuan "Đã xử lý" nhung van nam trong hang cho');

  const saigonOnly = await dashboardData.getDashboardData(BASE_FILTERS, BRANCHES.SAIGON, { vaiTro: 'Quản lý' });
  assert.equal(saigonOnly.debtManagement.customers[0].workflowStatus, 'Đã xử lý', 'xem rieng Sai Gon van la Đã xử lý');

  // Loi cu: nhan ban chu ky Ha Noi sang Sai Gon -> Sai Gon het hieu luc.
  debtCollectionStatusRepository.listByBranch = async branchCode => storedStatus(branchCode, signatureByBranch[BRANCHES.HANOI]);
  dashboardData.__test__.resetCaches();
  const broken = await dashboardData.getDashboardData(BASE_FILTERS, BRANCHES.SAIGON, { vaiTro: 'Quản lý' });
  assert.equal(broken.debtManagement.customers[0].workflowStatus, 'Chưa xử lý');
});

test('findDebtCustomerBranches dung dung chu ky ma dashboard tinh cho tung co so', async () => {
  const { dashboardData, debtManagementSheetsClient } = freshDashboardData();
  const crypto = require('node:crypto');
  const header = ['Khách hàng', 'Sale', 'Lịch TT SG', 'Nợ đầu kỳ', 'Nợ hiện tại', 'Nợ quá hạn', '% nợ/Doanh số', '% quá hạn / TB DS', 'TB T6/26-T9/26'];
  debtManagementSheetsClient.getDebtManagementSheet = async () => ({
    sourceSheet: 'Công nợ SG',
    rows: [header, ['TỔNG'], ['Khách A', 'Lan', 7, 0, 900000, 300000, 0, 0, 0]]
  });
  dashboardData.__test__.resetCaches();

  const keyA = crypto.createHash('sha256').update('khách a').digest('hex');
  const { found } = await dashboardData.findDebtCustomerBranches(keyA, ['Sài Gòn']);
  const dashboard = await dashboardData.getDashboardData(BASE_FILTERS, 'Sài Gòn', { vaiTro: 'Quản lý' });
  const onScreen = dashboard.debtManagement.customers.find(customer => customer.customerKey === keyA);

  assert.equal(found[0].alertSignature, onScreen.alertSignature,
    'chu ky luu xuong DB phai trung chu ky debtManagement.js so sanh khi doc');
});

test('Ca hai cong KPI/bucket va gop thuc the trung ma truoc khi xep hang', async () => {
  const { dashboardData, dashboardPgReader, dashboardRollupRepository } = freshDashboardData();
  const CONFIG = require('../config');
  const { BRANCHES, BRANCH_BOTH } = require('../branch/branches');
  const productHeader = ['Mã hàng', 'Tên hàng', 'Nhóm hàng', 'Loại hàng', 'Giá vốn', 'Giá bán', 'Tồn kho', 'Khách đặt', 'Trạng thái', 'Ngày sửa cuối', 'Mã nhóm hàng'];
  const customerHeader = ['Mã khách hàng', 'Tên khách hàng', 'Điện thoại', 'Nợ hiện tại'];
  const supplierHeader = ['Mã NCC', 'Tên NCC', 'Điện thoại', 'Địa chỉ', 'Nợ cần trả'];
  dashboardPgReader.readCoreDashboardSheets = async branch => {
    const result = Object.fromEntries(dashboardPgReader.CORE_SHEET_NAMES.map(name => [name, []]));
    result[CONFIG.SHEET_CATEGORIES] = [['Mã nhóm hàng', 'Tên nhóm hàng', 'Mã nhóm cha']];
    result[CONFIG.SHEET_PRODUCTS] = branch === BRANCHES.HANOI
      ? [productHeader, ['SP-1', 'Tên Hà Nội', '', 'Hàng hóa', 10, 20, 2, 0, 'Đang kinh doanh', '', ''], ['SP-2', 'SP 2', '', 'Hàng hóa', 10, 20, 1, 0, 'Đang kinh doanh', '', '']]
      : [productHeader, ['SP-1', 'Tên Sài Gòn', '', 'Hàng hóa', 10, 20, 3, 0, 'Đang kinh doanh', '', ''], ['SP-3', 'SP 3', '', 'Hàng hóa', 10, 20, 4, 0, 'Đang kinh doanh', '', '']];
    result[CONFIG.SHEET_CUSTOMERS] = branch === BRANCHES.HANOI
      ? [customerHeader, ['KH-1', 'Khách Hà Nội', '0901', 100], ['KH-2', 'Khách 2', '0902', 50]]
      : [customerHeader, ['KH-1', 'Khách Sài Gòn', '0901', 200], ['KH-3', 'Khách 3', '0903', 70]];
    result[CONFIG.SHEET_SUPPLIERS] = branch === BRANCHES.HANOI
      ? [supplierHeader, ['NCC-1', 'NCC Hà Nội', '', '', 300]]
      : [supplierHeader, ['NCC-1', 'NCC Sài Gòn', '', '', 400], ['NCC-2', 'NCC 2', '', '', 50]];
    return result;
  };
  mockDashboardRollups(dashboardRollupRepository, {
    getInvoiceRevenueByDay: ({ branch }) => branch === BRANCHES.HANOI
      ? [
          { dateKey: '10/08/2026', revenue: 1000, invoiceCount: 1 },
          { dateKey: '12/08/2026', revenue: 1200, invoiceCount: 1 }
        ]
      : [
          { dateKey: '10/08/2026', revenue: 2500, invoiceCount: 1 },
          { dateKey: '11/08/2026', revenue: 1100, invoiceCount: 1 }
        ],
    getProductSalesBreakdown: ({ branch }) => branch === BRANCHES.HANOI
      ? [{ code: 'SP-1', name: 'Tên Hà Nội', qty: 1, revenue: 100 }, { code: 'SP-2', name: 'SP 2', qty: 1, revenue: 80 }]
      : [{ code: 'SP-1', name: 'Tên Sài Gòn', qty: 2, revenue: 300 }]
  });
  dashboardData.__test__.resetCaches();

  const data = await dashboardData.getDashboardData({
    ...BASE_FILTERS,
    overview: { mode: 'all' }, products: { mode: 'all' }, invoices: { mode: 'all' }
  }, BRANCH_BOTH);

  assert.equal(data.kpi.totalProducts, 3);
  assert.equal(data.kpi.totalStock, 10);
  assert.equal(data.kpi.totalCustomers, 3);
  assert.equal(data.kpi.totalDebt, 420);
  assert.equal(data.kpi.totalSuppliers, 2);
  assert.equal(data.kpi.totalSupplierDebt, 750);
  assert.deepEqual(data.overview.revenueByDay, [
    { date: '10/08/2026', label: '10/08', revenue: 3500, count: 2 },
    { date: '11/08/2026', label: '11/08', revenue: 1100, count: 1 },
    { date: '12/08/2026', label: '12/08', revenue: 1200, count: 1 }
  ]);
  assert.deepEqual(data.products.topSellingProducts[0], { code: 'SP-1', name: 'Tên Hà Nội', qty: 3, revenue: 400 });
  assert.equal(data.allProducts.find(product => product.code === 'SP-1').name, 'Tên Hà Nội');
  assert.equal(data.suppliers.find(supplier => supplier.code === 'NCC-1').name, 'NCC Hà Nội');
});

test('Ca hai giu giao dich trung ma theo (co so, ma) va gan provenance', async () => {
  const { dashboardData, dashboardPgReader, dashboardRollupRepository } = freshDashboardData();
  const CONFIG = require('../config');
  const { BRANCHES, BRANCH_BOTH } = require('../branch/branches');
  dashboardPgReader.readCoreDashboardSheets = async branch => {
    const result = Object.fromEntries(dashboardPgReader.CORE_SHEET_NAMES.map(name => [name, []]));
    result[CONFIG.SHEET_CATEGORIES] = [['Mã nhóm hàng', 'Tên nhóm hàng', 'Mã nhóm cha']];
    result[CONFIG.SHEET_PRODUCTS] = [['Mã hàng', 'Tên hàng', 'Nhóm hàng', 'Loại hàng', 'Giá vốn', 'Giá bán', 'Tồn kho', 'Khách đặt', 'Trạng thái']];
    result[CONFIG.SHEET_CUSTOMERS] = [['Mã khách hàng', 'Tên khách hàng', 'Điện thoại', 'Nợ hiện tại']];
    result[CONFIG.SHEET_SUPPLIERS] = [['Mã NCC', 'Tên NCC', 'Điện thoại', 'Địa chỉ', 'Nợ cần trả']];
    result[CONFIG.SHEET_INVOICES] = [
      ['Mã hóa đơn', 'Ngày bán', 'Khách hàng', 'SĐT khách', 'Nhân viên bán', 'Chi nhánh', 'Tổng tiền hàng', 'Giảm giá', 'Khách đã trả', 'Trạng thái'],
      ['HD-TRUNG', '10/08/2026 10:00:00', 'Khách', '', '', '', branch === BRANCHES.HANOI ? 100 : 200, 0, 0, 'Hoàn thành']
    ];
    result[CONFIG.SHEET_ORDERS] = [
      ['Mã đặt hàng', 'Ngày đặt', 'Khách hàng', 'Nhân viên lập', 'Chi nhánh', 'Tổng tiền', 'Trạng thái'],
      ['DH-TRUNG', '10/08/2026 11:00:00', 'Khách', '', '', 10, 'Phiếu tạm']
    ];
    result[CONFIG.SHEET_RETURNS] = [
      ['Mã trả hàng', 'Ngày trả', 'Khách hàng', 'Tổng tiền trả', 'Trạng thái', 'Chi nhánh'],
      ['TH-TRUNG', '10/08/2026 12:00:00', 'Khách', 5, 'Đã trả', '']
    ];
    return result;
  };
  mockDashboardRollups(dashboardRollupRepository, {
    getInvoiceQuantitiesByCode: ({ branch }) => [{ code: 'HD-TRUNG', quantity: branch === BRANCHES.HANOI ? 1 : 2 }],
    listPurchaseOrders: ({ branch }) => [{ code: 'PN-TRUNG', date: '10/08/2026 13:00', supplier: 'NCC', branch: 'ten-kho', total: 7, status: 'Hoàn thành' }]
  });
  dashboardData.__test__.resetCaches();

  const data = await dashboardData.getDashboardData({
    ...BASE_FILTERS, invoices: { mode: 'all' }, newPurchases: { mode: 'all' }
  }, BRANCH_BOTH);

  assert.deepEqual(data.invoices.transactionsReport.transactions.map(row => [row.code, row.branch, row.quantity]), [
    ['HD-TRUNG', BRANCHES.HANOI, 1], ['HD-TRUNG', BRANCHES.SAIGON, 2]
  ]);
  assert.deepEqual(data.invoices.periodOrders.map(row => [row.code, row.branch]), [
    ['DH-TRUNG', BRANCHES.HANOI], ['DH-TRUNG', BRANCHES.SAIGON]
  ]);
  assert.deepEqual(data.invoices.periodReturns.map(row => [row.code, row.branch]), [
    ['TH-TRUNG', BRANCHES.HANOI], ['TH-TRUNG', BRANCHES.SAIGON]
  ]);
  assert.deepEqual(data.newPurchases.orders.map(row => [row.code, row.branch]), [
    ['PN-TRUNG', BRANCHES.HANOI], ['PN-TRUNG', BRANCHES.SAIGON]
  ]);
});

test('cache Ca hai co scope rieng va doi key khi version mot nguon vat ly thay doi', async () => {
  const { dashboardData, dashboardPgReader } = freshDashboardData();
  const { BRANCHES, BRANCH_BOTH } = require('../branch/branches');
  const calls = { [BRANCHES.HANOI]: 0, [BRANCHES.SAIGON]: 0 };
  dashboardPgReader.readCoreDashboardSheets = async branch => {
    calls[branch] += 1;
    return Object.fromEntries(dashboardPgReader.CORE_SHEET_NAMES.map(name => [name, []]));
  };
  dashboardData.__test__.resetCaches();

  await dashboardData.getDashboardData(BASE_FILTERS, BRANCHES.HANOI);
  await dashboardData.getDashboardData(BASE_FILTERS, BRANCHES.SAIGON);
  const physicalComputeCount = dashboardData.__test__.getComputeCallCount();
  await dashboardData.getDashboardData(BASE_FILTERS, BRANCH_BOTH);
  const aggregateComputeCount = dashboardData.__test__.getComputeCallCount();
  await dashboardData.getDashboardData(BASE_FILTERS, BRANCH_BOTH);

  assert.equal(aggregateComputeCount, physicalComputeCount + 1);
  assert.equal(dashboardData.__test__.getComputeCallCount(), aggregateComputeCount, 'lan hai phai dung aggregate cache');
  dashboardData.__test__.expireSheetsCache(BRANCHES.SAIGON);
  await dashboardData.getDashboardData(BASE_FILTERS, BRANCH_BOTH);
  assert.deepEqual(calls, { [BRANCHES.HANOI]: 1, [BRANCHES.SAIGON]: 2 });
  assert.equal(dashboardData.__test__.getComputeCallCount(), aggregateComputeCount + 1);
});

test('Ca hai giu cong no nguon con lai khi mot workbook loi va neu ro nguon that bai', async () => {
  const { dashboardData, debtManagementSheetsClient } = freshDashboardData();
  const { BRANCHES, BRANCH_BOTH } = require('../branch/branches');
  debtManagementSheetsClient.getDebtManagementSheet = async branch => {
    if (branch === BRANCHES.SAIGON) throw new Error('Workbook SG lỗi');
    return {
      sourceSheet: 'Công nợ HN',
      rows: [
        ['Khách hàng', 'Sale', 'Lịch TT HN', 'Nợ đầu kỳ', 'Nợ hiện tại', 'Nợ quá hạn', '% nợ/Doanh số', '% quá hạn / TB DS', 'TB'],
        ['TỔNG'],
        ['Khách A', 'Lan', 7, 10, 500000, 100000, 0.5, 0.1, 1000000]
      ]
    };
  };
  dashboardData.__test__.resetCaches();

  const data = await dashboardData.getDashboardData(BASE_FILTERS, BRANCH_BOTH);

  assert.equal(data.debtManagement.available, true);
  assert.equal(data.debtManagement.kpi.totalCurrentDebt, 500000);
  assert.deepEqual(data.debtManagement.sources.map(source => [source.branch, source.available]), [
    [BRANCHES.HANOI, true], [BRANCHES.SAIGON, false]
  ]);
  assert.ok(data.debtManagement.dataWarnings.some(warning => warning.includes('Sài Gòn') && warning.includes('Workbook SG lỗi')));
  assert.deepEqual(data.debtManagement.customers[0].branchDetails.map(detail => detail.branch), [BRANCHES.HANOI]);
});

test('Ca hai fail request neu nguon van han cua mot co so loi', async () => {
  const { dashboardData, dashboardPgReader } = freshDashboardData();
  const { BRANCHES, BRANCH_BOTH } = require('../branch/branches');
  dashboardPgReader.readCoreDashboardSheets = async branch => {
    if (branch === BRANCHES.SAIGON) throw new Error('Supabase SG lỗi');
    return Object.fromEntries(dashboardPgReader.CORE_SHEET_NAMES.map(name => [name, []]));
  };
  dashboardData.__test__.resetCaches();

  await assert.rejects(dashboardData.getDashboardData(BASE_FILTERS, BRANCH_BOTH), /Supabase SG lỗi/);
});

test('Ca hai gom thong ke phieu nhap theo ma NCC chuan hoa, khong theo ten hien thi', async () => {
  const { dashboardData, dashboardRollupRepository } = freshDashboardData();
  const { BRANCHES, BRANCH_BOTH } = require('../branch/branches');
  mockDashboardRollups(dashboardRollupRepository, {
    listPurchaseOrders: ({ branch }) => branch === BRANCHES.HANOI
      ? [
          { code: 'PN-HN-1', date: '10/08/2026 09:00', supplierCode: 'NCC-1', supplier: 'Tên Hà Nội', total: 100, status: 'Hoàn thành' },
          { code: 'PN-HN-2', date: '10/08/2026 08:00', supplierCode: 'NCC-2', supplier: 'Trùng tên', total: 50, status: 'Hoàn thành' }
        ]
      : [
          { code: 'PN-SG-1', date: '11/08/2026 09:00', supplierCode: ' ncc-1 ', supplier: 'Tên Sài Gòn', total: 200, status: 'Hoàn thành' },
          { code: 'PN-SG-2', date: '11/08/2026 08:00', supplierCode: 'NCC-3', supplier: 'Trùng tên', total: 70, status: 'Hoàn thành' }
        ]
  });
  dashboardData.__test__.resetCaches();

  const data = await dashboardData.getDashboardData({ ...BASE_FILTERS, newPurchases: { mode: 'all' } }, BRANCH_BOTH);

  assert.equal(data.newPurchases.supplierCount, 3);
  assert.deepEqual(data.newPurchases.bySupplier, [
    { name: 'Tên Hà Nội', orderCount: 2, total: 300 },
    { name: 'Trùng tên', orderCount: 1, total: 70 },
    { name: 'Trùng tên', orderCount: 1, total: 50 }
  ]);
});

test('Ca hai lay ten that dau tien HN-SG cho product rollup thay vi giu fallback ma', async () => {
  const { dashboardData, dashboardRollupRepository } = freshDashboardData();
  const { BRANCHES, BRANCH_BOTH } = require('../branch/branches');
  mockDashboardRollups(dashboardRollupRepository, {
    getProductSalesBreakdown: ({ branch }) => branch === BRANCHES.HANOI
      ? [{ code: 'SP-CHUNG', name: 'SP-CHUNG', _hasDisplayName: false, qty: 1, revenue: 100 }]
      : [{ code: 'SP-CHUNG', name: 'Tên thật Sài Gòn', _hasDisplayName: true, qty: 2, revenue: 200 }]
  });
  dashboardData.__test__.resetCaches();

  const data = await dashboardData.getDashboardData({ ...BASE_FILTERS, products: { mode: 'all' } }, BRANCH_BOTH);

  assert.deepEqual(data.products.topSellingProducts, [
    { code: 'SP-CHUNG', name: 'Tên thật Sài Gòn', qty: 3, revenue: 300 }
  ]);
});

test('Ca hai cong truc tiep averageSales ke ca nguon co no qua han bang 0', async () => {
  const { dashboardData, debtManagementSheetsClient } = freshDashboardData();
  const { BRANCHES, BRANCH_BOTH } = require('../branch/branches');
  debtManagementSheetsClient.getDebtManagementSheet = async branch => ({
    sourceSheet: branch === BRANCHES.HANOI ? 'Công nợ HN' : 'Công nợ SG',
    rows: [
      ['Khách hàng', 'Sale', branch === BRANCHES.HANOI ? 'Lịch TT HN' : 'Lịch TT SG', 'Nợ đầu kỳ', 'Nợ hiện tại', 'Nợ quá hạn', '% nợ/Doanh số', '% quá hạn / TB DS', 'TB T6/26-T9/26'],
      ['TỔNG'],
      branch === BRANCHES.HANOI
        ? ['Khách HN', 'Lan', 7, 0, 500000, 0, 0.5, 0, 1000000]
        : ['Khách SG', 'Mai', 7, 0, 500000, 100000, 0.5, 0.1, 1000000]
    ]
  });
  dashboardData.__test__.resetCaches();

  const data = await dashboardData.getDashboardData(BASE_FILTERS, BRANCH_BOTH);

  assert.equal(data.debtManagement.kpi.totalOverdueDebt, 100000);
  assert.equal(data.debtManagement.kpi.overdueToSalesRatio, 0.05);
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

function mockCustomerProductRevenueSheets(dashboardPgReader, { invoices = [], details = [], customers = [] }) {
  const CONFIG = require('../config');
  mockPgSheets(dashboardPgReader, {
    [CONFIG.SHEET_INVOICES]: [INVOICE_HEADERS, ...invoices],
    [CONFIG.SHEET_INVOICE_DETAILS]: [DETAIL_HEADERS, ...details],
    [CONFIG.SHEET_CUSTOMERS]: [['Mã khách hàng', 'Tên khách hàng', 'Điện thoại'], ...customers]
  });
}

test('bao cao doanh thu theo khach: join dung hoa don hoan thanh/trong ky/dung khach, bo qua phan con lai', async () => {
  const { dashboardData, dashboardPgReader } = freshDashboardData();
  const now = new Date('2026-08-14T12:00:00+07:00');
  mockCustomerProductRevenueSheets(dashboardPgReader, {
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
  const { dashboardData, dashboardPgReader } = freshDashboardData();
  const now = new Date('2026-08-14T12:00:00+07:00');
  mockCustomerProductRevenueSheets(dashboardPgReader, {
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
  const { dashboardData, dashboardPgReader } = freshDashboardData();
  const now = new Date('2026-08-14T12:00:00+07:00');
  const offsetDates = {
    0: '14/08/2026', 29: '16/07/2026', 30: '15/07/2026',
    59: '16/06/2026', 60: '15/06/2026', 89: '17/05/2026', 90: '16/05/2026'
  };
  const invoices = Object.entries(offsetDates).map(([offset, date]) =>
    invoiceRow({ code: 'HD-' + offset, date: date + ' 08:00:00', custCode: 'KH-A' }));
  const details = Object.keys(offsetDates).map(offset =>
    detailRow({ invoiceCode: 'HD-' + offset, itemCode: 'SP-01', itemName: 'Sản phẩm một', qty: 1, total: 100 }));
  mockCustomerProductRevenueSheets(dashboardPgReader, { invoices, details });
  dashboardData.__test__.resetCaches();

  const report = await dashboardData.getCustomerProductRevenueReport('KH-A', '', undefined, now);
  const product = report.products.find(p => p.code === 'SP-01');

  assert.equal(product.month1Revenue, 200, 'ngay 0 va 29 thuoc T.nay');
  assert.equal(product.month2Revenue, 200, 'ngay 30 va 59 thuoc T.truoc');
  assert.equal(product.month3Revenue, 200, 'ngay 60 va 89 thuoc T.truoc nua');
  assert.equal(product.revenue, 600, 'hoa don ngay thu 90 nam ngoai cua so 90 ngay, khong duoc tinh');
});

test('bao cao doanh thu theo khach: khop khach qua SDT hoac ten khi hoa don thieu ma khach hang', async () => {
  const { dashboardData, dashboardPgReader } = freshDashboardData();
  const now = new Date('2026-08-14T12:00:00+07:00');
  mockCustomerProductRevenueSheets(dashboardPgReader, {
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
  const { dashboardData } = freshDashboardData();
  dashboardData.__test__.resetCaches();

  await assert.rejects(
    dashboardData.getCustomerProductRevenueReport('', '', undefined, new Date('2026-08-14T12:00:00+07:00')),
    error => error.statusCode === 400 && error.code === 'CUSTOMER_CODE_REQUIRED'
  );
});

test('bao cao doanh thu theo khach: co lap theo chi nhanh, khong ro ri du lieu giua Ha Noi va Sai Gon', async () => {
  const { dashboardData, dashboardPgReader, customerDebtActivityRepository } = freshDashboardData();
  const { BRANCHES } = require('../branch/branches');
  const CONFIG = require('../config');
  const seen = [];
  customerDebtActivityRepository.readOperationalPeriods = async () => ({
    HN1: [['Khách hàng']], HN3: [['Khách hàng']], HN7: [['Khách hàng']]
  });
  dashboardPgReader.readDashboardSheets = async branch => {
    seen.push(branch);
    const result = {};
    dashboardPgReader.SHEET_NAMES.forEach(name => { result[name] = []; });
    result[CONFIG.SHEET_INVOICES] = [INVOICE_HEADERS,
      invoiceRow({ code: 'HD-1', date: '10/08/2026 10:00:00', custCode: 'KH-A', status: 'Hoàn thành' })];
    result[CONFIG.SHEET_INVOICE_DETAILS] = [DETAIL_HEADERS,
      detailRow({ invoiceCode: 'HD-1', itemCode: 'SP-01', itemName: 'Sản phẩm một', qty: 1, total: branch === BRANCHES.SAIGON ? 999 : 100 })];
    return result;
  };
  dashboardData.__test__.resetCaches();
  const now = new Date('2026-08-14T12:00:00+07:00');

  const hanoi = await dashboardData.getCustomerProductRevenueReport('KH-A', '', BRANCHES.HANOI, now);
  const saigon = await dashboardData.getCustomerProductRevenueReport('KH-A', '', BRANCHES.SAIGON, now);

  assert.equal(hanoi.totalRevenue, 100);
  assert.equal(saigon.totalRevenue, 999);
  assert.deepEqual(seen, [BRANCHES.HANOI, BRANCHES.SAIGON]);
});

const PRODUCT_HEADERS = [
  'Mã hàng', 'Tên hàng', 'Nhóm hàng', 'Đơn vị', 'Loại hàng', 'Giá vốn', 'Giá bán',
  'Tồn kho', 'Khách đặt', 'Trạng thái', 'Ghi chú', 'Mã nhóm hàng'
];
function productRow({ code, name, cost = 0, price = 0, stock = 0, status = 'Đang kinh doanh' }) {
  const row = new Array(PRODUCT_HEADERS.length).fill('');
  row[0] = code; row[1] = name; row[5] = cost; row[6] = price; row[7] = stock; row[9] = status;
  return row;
}

// ===== getDashboardData: cac khoi da chuyen tu quet "Chi tiết hóa đơn"/
// "Nhập hàng" (bo khoi cache "core") sang dashboardRollupRepository.js =====
// Dung bo loc 'range' (tu ngay/den ngay co dinh) cho cac tab lien quan de
// khong phu thuoc "now" that (BASE_FILTERS dung 'days' tuong doi, khong hop
// de kiem tra tham so from/to truyen xuong repository mot cach xac dinh).

const CATEGORY_HEADERS = ['Mã nhóm hàng', 'Tên nhóm hàng', 'Mã nhóm cha'];
function categoryRow({ id, name, parentId = '' }) {
  return [id, name, parentId];
}

test('getDashboardData: Hang moi nhap doc tu getFirstPurchaseDates (rollup), loc theo range + trang thai kinh doanh', async () => {
  const { dashboardData, dashboardPgReader, dashboardRollupRepository } = freshDashboardData();
  const CONFIG = require('../config');
  mockPgSheets(dashboardPgReader, {
    [CONFIG.SHEET_PRODUCTS]: [
      PRODUCT_HEADERS,
      productRow({ code: 'SP-01', name: 'Sản phẩm một', status: 'Đang kinh doanh' }),
      productRow({ code: 'SP-02', name: 'Sản phẩm hai', status: 'Ngừng kinh doanh' })
    ]
  });
  const calls = [];
  mockDashboardRollups(dashboardRollupRepository, {
    getFirstPurchaseDates: (args) => {
      calls.push(args);
      return [
        { code: 'SP-01', name: 'Sản phẩm một', firstPurchaseDateText: '10/08/2026 09:00:00' },
        { code: 'SP-02', name: 'Sản phẩm hai', firstPurchaseDateText: '10/08/2026 09:00:00' },
        { code: 'VAT01', name: 'Thuế GTGT', firstPurchaseDateText: '10/08/2026 09:00:00' },
        { code: 'SP-03', name: 'Ngoai ky', firstPurchaseDateText: '01/01/2020 09:00:00' }
      ];
    }
  });
  dashboardData.__test__.resetCaches();

  const filters = {
    ...BASE_FILTERS,
    products: { mode: 'range', from: '2026-08-01', to: '2026-08-31', status: 'all' }
  };
  const data = await dashboardData.getDashboardData(filters);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].branch, undefined, 'branch mac dinh Ha Noi khong truyen tuong minh o day');
  assert.deepEqual(
    data.products.newlyImported.products.map(p => p.code).sort(),
    ['SP-01', 'SP-02'],
    'SP-03 ngoai khoang productsRange va VAT01 la ma VAT deu bi loai'
  );

  const filteredActive = await dashboardData.getDashboardData({
    ...filters,
    products: { ...filters.products, status: 'Đang kinh doanh' }
  });
  assert.deepEqual(
    filteredActive.products.newlyImported.products.map(p => p.code),
    ['SP-01'],
    'loc theo trang thai kinh doanh dung nhu productStatusByCode (tu tab Hang hoa)'
  );
});

test('getDashboardData: Top san pham ban chay + nhom hang doc tu getProductSalesBreakdown (rollup)', async () => {
  const { dashboardData, dashboardPgReader, dashboardRollupRepository } = freshDashboardData();
  const CONFIG = require('../config');
  const productWithCategory = (code, name) => {
    const row = productRow({ code, name });
    row[2] = 'Đồ uống'; // Nhóm hàng (ten)
    row[11] = '1'; // Mã nhóm hàng (id) — khop id nhom cha trong CATEGORY_HEADERS
    return row;
  };
  mockPgSheets(dashboardPgReader, {
    [CONFIG.SHEET_CATEGORIES]: [CATEGORY_HEADERS, categoryRow({ id: '1', name: 'Đồ uống' })],
    [CONFIG.SHEET_PRODUCTS]: [
      PRODUCT_HEADERS,
      productWithCategory('SP-01', 'Sản phẩm một'),
      productWithCategory('SP-02', 'Sản phẩm hai')
    ]
  });
  const calls = [];
  mockDashboardRollups(dashboardRollupRepository, {
    getProductSalesBreakdown: (args) => {
      calls.push(args);
      return [
        { code: 'SP-01', name: 'Sản phẩm một', qty: 5, revenue: 500000 },
        { code: 'SP-02', name: 'Sản phẩm hai', qty: 2, revenue: 100000 }
      ];
    }
  });
  dashboardData.__test__.resetCaches();

  const filters = { ...BASE_FILTERS, products: { mode: 'range', from: '2026-08-01', to: '2026-08-31' } };
  const data = await dashboardData.getDashboardData(filters);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].from, '2026-08-01');
  assert.equal(calls[0].to, '2026-08-31');
  assert.deepEqual(
    data.products.topSellingProducts.map(p => [p.code, p.revenue]),
    [['SP-01', 500000], ['SP-02', 100000]]
  );
  assert.equal(data.products.topSellingParentCategories.length, 1);
  assert.equal(data.products.topSellingParentCategories[0].revenue, 600000);
});

test('getDashboardData: doanh thu theo ngay (Tong quan/Hoa don) doc tu getInvoiceRevenueByDay (rollup)', async () => {
  const { dashboardData, dashboardRollupRepository } = freshDashboardData();
  const calls = [];
  mockDashboardRollups(dashboardRollupRepository, {
    getInvoiceRevenueByDay: (args) => {
      calls.push(args);
      return [{ dateKey: '10/08/2026', revenue: 500000, invoiceCount: 3 }];
    }
  });
  dashboardData.__test__.resetCaches();

  const filters = {
    ...BASE_FILTERS,
    overview: { mode: 'range', from: '2026-08-01', to: '2026-08-31' },
    invoices: { mode: 'range', from: '2026-08-10', to: '2026-08-10' }
  };
  const data = await dashboardData.getDashboardData(filters);

  assert.equal(calls.length, 2, 'goi rieng cho overviewRange va invoicesRange');
  assert.deepEqual([calls[0].from, calls[0].to], ['2026-08-01', '2026-08-31']);
  assert.deepEqual([calls[1].from, calls[1].to], ['2026-08-10', '2026-08-10']);

  assert.equal(data.overview.periodRevenue, 500000);
  assert.equal(data.overview.periodInvoices, 3);
  const day = data.overview.revenueByDay.find(d => d.date === '10/08/2026');
  assert.equal(day.revenue, 500000);
  assert.equal(day.count, 3);

  // invoicesRange chi 1 ngay (10/08 - 10/08) -> dung 1 dong, khop dong rollup.
  assert.equal(data.invoices.periodRevenue, 500000);
  assert.equal(data.invoices.periodInvoices, 3);
});

test('getDashboardData: NHẬP HÀNG (KPI toan thoi gian) doc tu getPurchaseTotals, HÀNG NHẬP (danh sach + NCC) doc tu listPurchaseOrders', async () => {
  const { dashboardData, dashboardRollupRepository } = freshDashboardData();
  const purchaseTotalsCalls = [];
  const listCalls = [];
  mockDashboardRollups(dashboardRollupRepository, {
    getPurchaseTotals: (args) => {
      purchaseTotalsCalls.push(args);
      return { orderCount: 12, total: 34000000 };
    },
    listPurchaseOrders: (args) => {
      listCalls.push(args);
      return [
        { code: 'PN-02', date: '11/08/2026 10:00', supplier: 'NCC A', branch: 'Hà Nội', total: 2000000, status: 'Hoàn thành' },
        { code: 'PN-01', date: '10/08/2026 09:00', supplier: 'NCC A', branch: 'Hà Nội', total: 1000000, status: 'Hoàn thành' },
        { code: 'PN-03', date: '10/08/2026 08:00', supplier: '', branch: 'Hà Nội', total: 500000, status: 'Đã hủy' }
      ];
    }
  });
  dashboardData.__test__.resetCaches();

  const filters = { ...BASE_FILTERS, newPurchases: { mode: 'range', from: '2026-08-01', to: '2026-08-31' } };
  const data = await dashboardData.getDashboardData(filters);

  assert.equal(purchaseTotalsCalls.length, 1);
  assert.equal(data.kpi.purchaseOrdersCount, 12, 'KPI toan thoi gian, khong loc theo newPurchasesRange');
  assert.equal(data.kpi.totalPurchaseSpend, 34000000);

  assert.equal(listCalls.length, 1);
  assert.deepEqual([listCalls[0].from, listCalls[0].to], ['2026-08-01', '2026-08-31']);
  assert.equal(data.newPurchases.orderCount, 3);
  assert.equal(data.newPurchases.totalAmount, 3500000);
  assert.equal(data.newPurchases.supplierCount, 2, '"NCC A" va "(Không xác định)" (fallback khi supplier rong)');
  assert.deepEqual(
    data.newPurchases.orders.map(o => o.code),
    ['PN-02', 'PN-01', 'PN-03'],
    'giu nguyen thu tu tra ve tu listPurchaseOrders (da sap xep moi nhat truoc trong SQL)'
  );
  const bySupplierA = data.newPurchases.bySupplier.find(s => s.name === 'NCC A');
  assert.equal(bySupplierA.orderCount, 2);
  assert.equal(bySupplierA.total, 3000000);
});

test('getDashboardData: cot SL cua "Chi tiết giao dịch" doc tu getInvoiceQuantitiesByCode (rollup)', async () => {
  const { dashboardData, dashboardPgReader, dashboardRollupRepository } = freshDashboardData();
  const CONFIG = require('../config');
  mockPgSheets(dashboardPgReader, {
    [CONFIG.SHEET_INVOICES]: [
      INVOICE_HEADERS,
      invoiceRow({ code: 'HD-01', date: '10/08/2026 10:00:00', status: 'Hoàn thành' })
    ]
  });
  mockDashboardRollups(dashboardRollupRepository, {
    getInvoiceQuantitiesByCode: () => [{ code: 'HD-01', quantity: 7 }]
  });
  dashboardData.__test__.resetCaches();

  // Bao cao giao dich thuoc tab Hoa don nen theo bo loc "invoices", khong phai "overview".
  const filters = {
    ...BASE_FILTERS,
    overview: { mode: 'days', days: 1 },
    invoices: { mode: 'range', from: '2026-08-01', to: '2026-08-31' }
  };
  const data = await dashboardData.getDashboardData(filters);

  const row = data.invoices.transactionsReport.transactions.find(t => t.code === 'HD-01');
  assert.ok(row, 'hoa don HD-01 phai xuat hien trong bang chi tiet giao dich');
  assert.equal(row.quantity, 7);
  assert.equal(row.quantityKnown, true);
});

// ---------- Ca hai: tim kiem, chi tiet, bao cao doanh thu ----------

const AGG_PRODUCT_HEADER = ['Mã hàng', 'Tên hàng', 'Nhóm hàng', 'Loại hàng', 'Giá vốn', 'Giá bán', 'Tồn kho', 'Khách đặt', 'Trạng thái'];
const AGG_CUSTOMER_HEADER = ['Mã khách hàng', 'Tên khách hàng', 'Điện thoại', 'Nợ hiện tại'];
const AGG_INVOICE_HEADER = ['Mã hóa đơn', 'Ngày bán', 'Khách hàng', 'SĐT khách', 'Chi nhánh', 'Tổng tiền hàng', 'Trạng thái', 'Mã khách hàng'];
const AGG_DETAIL_HEADER = ['Mã hóa đơn', 'Mã hàng', 'Tên hàng', 'Số lượng', 'Đơn giá', 'Giảm giá', 'Thành tiền'];

// readDashboardSheets (9 tab, dung cho search/export) theo tung co so VAT LY:
// `byBranch` = { [branch]: { [sheetName]: rows } }. Ghi lai moi co so duoc doc.
function mockFullSheetsByBranch(dashboardPgReader, byBranch, seenBranches = []) {
  dashboardPgReader.readDashboardSheets = async branch => {
    seenBranches.push(branch);
    const result = {};
    dashboardPgReader.SHEET_NAMES.forEach(name => { result[name] = []; });
    return Object.assign(result, byBranch[branch] || {});
  };
}

test('Ca hai tim kiem gop ma trung, ap dung limit sau khi gop va chi doc co so vat ly', async () => {
  const { dashboardData, dashboardPgReader } = freshDashboardData();
  const CONFIG = require('../config');
  const { BRANCHES, BRANCH_BOTH } = require('../branch/branches');
  const seen = [];
  mockFullSheetsByBranch(dashboardPgReader, {
    [BRANCHES.HANOI]: {
      [CONFIG.SHEET_PRODUCTS]: [AGG_PRODUCT_HEADER,
        ['SP-1', 'Áo Hà Nội', '', '', 10, 20, 2, 0, 'Đang kinh doanh'],
        ['SP-2', 'Áo hai', '', '', 5, 9, 1, 0, 'Đang kinh doanh']]
    },
    [BRANCHES.SAIGON]: {
      [CONFIG.SHEET_PRODUCTS]: [AGG_PRODUCT_HEADER,
        ['SP-1', 'Áo Sài Gòn', '', '', 20, 25, 3, 0, 'Đang kinh doanh'],
        ['SP-3', 'Áo ba', '', '', 5, 9, 4, 0, 'Đang kinh doanh']]
    }
  }, seen);
  dashboardData.__test__.resetCaches();

  const result = await dashboardData.searchDashboardRecords('products', 'áo', 2, undefined, undefined, BRANCH_BOTH);

  assert.equal(result.total, 3, 'SP-1 trung ma chi tinh 1 lan');
  assert.deepEqual(result.results.map(item => item.code), ['SP-1', 'SP-2'], 'limit ap dung sau khi gop');
  assert.equal(result.results[0].name, 'Áo Hà Nội');
  const stock = result.results[0].fields.find(field => field.label === 'Tồn kho');
  const cost = result.results[0].fields.find(field => field.label === 'Giá vốn');
  assert.equal(stock.value, '5');
  assert.equal(cost.value, '16', 'gia von tinh binh quan theo ton kho');
  assert.deepEqual(seen.sort(), [BRANCHES.HANOI, BRANCHES.SAIGON]);

  await dashboardData.searchDashboardRecords('products', 'sp-3', 8, undefined, undefined, BRANCH_BOTH);
  assert.equal(seen.length, 2, 'chi muc gop duoc cache, khong doc lai khi version khong doi');
});

test('Ca hai tim nhieu ma giu thu tu nhap, giu giao dich trung ma theo co so va dem thieu dung', async () => {
  const { dashboardData, dashboardPgReader } = freshDashboardData();
  const CONFIG = require('../config');
  const { BRANCHES, BRANCH_BOTH } = require('../branch/branches');
  mockFullSheetsByBranch(dashboardPgReader, {
    [BRANCHES.HANOI]: {
      [CONFIG.SHEET_INVOICES]: [AGG_INVOICE_HEADER,
        ['HD-TRUNG', '10/08/2026 10:00:00', 'Khách HN', '', 'Kho A', 100, 'Hoàn thành', 'KH-1']]
    },
    [BRANCHES.SAIGON]: {
      [CONFIG.SHEET_INVOICES]: [AGG_INVOICE_HEADER,
        ['HD-RIENG', '10/08/2026 11:00:00', 'Khách SG', '', 'Kho B', 50, 'Hoàn thành', 'KH-2'],
        ['HD-TRUNG', '10/08/2026 12:00:00', 'Khách SG', '', 'Kho B', 200, 'Hoàn thành', 'KH-2']]
    }
  });
  dashboardData.__test__.resetCaches();

  const result = await dashboardData.searchDashboardRecords(
    'invoices', 'hd-rieng HD-TRUNG KHONG-CO', 'all', 'codes', undefined, BRANCH_BOTH
  );

  assert.deepEqual(result.results.map(item => [item.code, item.branch]), [
    ['HD-RIENG', BRANCHES.SAIGON], ['HD-TRUNG', BRANCHES.HANOI], ['HD-TRUNG', BRANCHES.SAIGON]
  ]);
  assert.equal(result.requestedCount, 3);
  assert.equal(result.matchedCount, 2);
  assert.equal(result.missingCount, 1);
  assert.equal(result.total, 3);
  const totals = result.results.filter(item => item.code === 'HD-TRUNG')
    .map(item => item.fields.find(field => field.label === 'Tổng tiền hàng').value);
  assert.deepEqual(totals, ['100', '200']);
});

test('Ca hai tim khach cong doanh thu theo ma khach cua ca hai co so', async () => {
  const { dashboardData, dashboardPgReader } = freshDashboardData();
  const CONFIG = require('../config');
  const { BRANCHES, BRANCH_BOTH } = require('../branch/branches');
  mockFullSheetsByBranch(dashboardPgReader, {
    [BRANCHES.HANOI]: {
      [CONFIG.SHEET_CUSTOMERS]: [AGG_CUSTOMER_HEADER, ['KH-1', 'Khách Hà Nội', '0901', 100]],
      [CONFIG.SHEET_INVOICES]: [AGG_INVOICE_HEADER,
        ['HD-1', '10/08/2026 10:00:00', 'Khách Hà Nội', '', '', 100, 'Hoàn thành', 'KH-1']]
    },
    [BRANCHES.SAIGON]: {
      [CONFIG.SHEET_CUSTOMERS]: [AGG_CUSTOMER_HEADER, ['KH-1', 'Khách Sài Gòn', '0901', 200]],
      [CONFIG.SHEET_INVOICES]: [AGG_INVOICE_HEADER,
        ['HD-1', '11/08/2026 10:00:00', 'Khách Sài Gòn', '', '', 200, 'Hoàn thành', 'KH-1']]
    }
  });
  dashboardData.__test__.resetCaches();

  const result = await dashboardData.searchDashboardRecords(
    'customers', 'KH-1', 'all', undefined, { mode: 'all' }, BRANCH_BOTH
  );

  assert.equal(result.total, 1);
  assert.equal(result.results[0].name, 'Khách Hà Nội');
  assert.equal(result.results[0].revenue, 300);
});

function aggregateRevenueSheets(BRANCHES, CONFIG) {
  return {
    [BRANCHES.HANOI]: {
      [CONFIG.SHEET_PRODUCTS]: [AGG_PRODUCT_HEADER, ['SP-1', 'Áo Hà Nội', '', '', 10, 20, 2, 0, 'Đang kinh doanh']],
      [CONFIG.SHEET_INVOICES]: [AGG_INVOICE_HEADER,
        ['HD-1', '18/08/2026 10:00:00', 'Khách 1', '', '', 100, 'Hoàn thành', 'KH-1']],
      [CONFIG.SHEET_INVOICE_DETAILS]: [AGG_DETAIL_HEADER, ['HD-1', 'SP-1', 'Áo Hà Nội', 1, 100, 0, 100]]
    },
    [BRANCHES.SAIGON]: {
      [CONFIG.SHEET_PRODUCTS]: [AGG_PRODUCT_HEADER, ['SP-1', 'Áo Sài Gòn', '', '', 20, 25, 3, 0, 'Đang kinh doanh']],
      [CONFIG.SHEET_INVOICES]: [AGG_INVOICE_HEADER,
        ['HD-1', '18/08/2026 11:00:00', 'Khách 9', '', '', 999, 'Hoàn thành', 'KH-9'],
        ['HD-2', '19/08/2026 09:00:00', 'Khách 1', '', '', 350, 'Hoàn thành', 'KH-1']],
      [CONFIG.SHEET_INVOICE_DETAILS]: [AGG_DETAIL_HEADER,
        ['HD-1', 'SP-1', 'Áo Sài Gòn', 5, 200, 0, 999],
        ['HD-2', 'SP-1', 'Áo Sài Gòn', 2, 150, 0, 300],
        ['HD-2', 'SP-2', 'Hàng hai', 1, 50, 0, 50]]
    }
  };
}

test('Ca hai bao cao doanh thu theo khach cong theo ma hang va ngay, khong ghep hoa don trung ma giua co so', async () => {
  const { dashboardData, dashboardPgReader } = freshDashboardData();
  const CONFIG = require('../config');
  const { BRANCHES, BRANCH_BOTH } = require('../branch/branches');
  const seen = [];
  mockFullSheetsByBranch(dashboardPgReader, aggregateRevenueSheets(BRANCHES, CONFIG), seen);
  dashboardData.__test__.resetCaches();

  const report = await dashboardData.getCustomerProductRevenueReport(
    'KH-1', 'Khách 1', BRANCH_BOTH, new Date('2026-08-20T03:00:00.000Z')
  );

  assert.deepEqual(report.products.map(product => [product.code, product.name, product.quantity, product.revenue]), [
    ['SP-1', 'Áo Hà Nội', 3, 400], ['SP-2', 'Hàng hai', 1, 50]
  ]);
  assert.equal(report.totalRevenue, 450);
  assert.equal(report.totalQuantity, 4);
  assert.equal(report.products[0].month1Revenue, 400);
  const dayRevenue = date => report.totalRevenueByDay.find(day => day.date === date).revenue;
  assert.equal(dayRevenue('18/08/2026'), 100);
  assert.equal(dayRevenue('19/08/2026'), 350);
  assert.equal(report.products[0].revenueByDay.find(day => day.date === '19/08/2026').revenue, 300);
  assert.deepEqual(seen.sort(), [BRANCHES.HANOI, BRANCHES.SAIGON]);
});

test('Ca hai top khach theo san pham giu thu tu ma nhap va chuyen pham vi gop xuong repository', async () => {
  const { dashboardData, customerProductTopRepository } = freshDashboardData();
  const { BRANCH_BOTH } = require('../branch/branches');
  const calls = [];
  customerProductTopRepository.findTopCustomersByProducts = async params => {
    calls.push(params);
    return [
      { productCode: 'SP-2', productName: 'Hai', customerCode: 'KH-1', customerName: 'A', purchasedQuantity: 1, purchaseRevenue: 10, returnedQuantity: 0, returnValue: 0, lastPurchaseDate: null },
      { productCode: 'SP-1', productName: 'Một', customerCode: 'KH-2', customerName: 'B', purchasedQuantity: 2, purchaseRevenue: 20, returnedQuantity: 0, returnValue: 0, lastPurchaseDate: null }
    ];
  };
  dashboardData.__test__.resetCaches();

  const result = await dashboardData.searchTopCustomersByProducts('SP-1 SP-2 SP-9', { mode: 'all' }, undefined, BRANCH_BOTH);

  assert.equal(calls[0].branch, BRANCH_BOTH);
  assert.deepEqual(result.results.map(row => row.productCode), ['SP-1', 'SP-2']);
  assert.equal(result.missingCount, 1);
});

test('Ca hai chi muc tim kiem dung lai khi nguon khong doi va xay lai khi mot co so vat ly lam moi', async () => {
  const { dashboardData, dashboardPgReader } = freshDashboardData();
  const CONFIG = require('../config');
  const { BRANCHES, BRANCH_BOTH } = require('../branch/branches');
  const seen = [];
  const byBranch = {
    [BRANCHES.HANOI]: { [CONFIG.SHEET_PRODUCTS]: [AGG_PRODUCT_HEADER, ['SP-1', 'Áo', '', '', 10, 20, 2, 0, 'Đang kinh doanh']] },
    [BRANCHES.SAIGON]: { [CONFIG.SHEET_PRODUCTS]: [AGG_PRODUCT_HEADER] }
  };
  mockFullSheetsByBranch(dashboardPgReader, byBranch, seen);
  dashboardData.__test__.resetCaches();

  await dashboardData.searchDashboardRecords('products', 'sp', 8, undefined, undefined, BRANCH_BOTH);
  await dashboardData.searchDashboardRecords('products', 'sp', 8, undefined, undefined, BRANCH_BOTH);
  const buildsBeforeRefresh = dashboardData.__test__.getSearchIndexBuildCount();

  byBranch[BRANCHES.SAIGON][CONFIG.SHEET_PRODUCTS] = [AGG_PRODUCT_HEADER, ['SP-9', 'Áo mới ở Sài Gòn', '', '', 1, 2, 7, 0, 'Đang kinh doanh']];
  dashboardData.__test__.expireFullSheetsCache(BRANCHES.SAIGON);
  const result = await dashboardData.searchDashboardRecords('products', 'sp-9', 8, undefined, undefined, BRANCH_BOTH);

  assert.deepEqual(result.results.map(item => item.code), ['SP-9']);
  assert.deepEqual(seen.sort(), [BRANCHES.HANOI, BRANCHES.SAIGON, BRANCHES.SAIGON]);
  assert.ok(dashboardData.__test__.getSearchIndexBuildCount() > buildsBeforeRefresh, 'chi muc gop phai duoc xay lai');
});
