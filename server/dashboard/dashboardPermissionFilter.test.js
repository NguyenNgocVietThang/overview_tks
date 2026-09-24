'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  filterDashboardForUser,
  searchFeatureForView,
  allowedSearchEntities,
  SECTION_FEATURE
} = require('./dashboardPermissionFilter');

function samplePayload() {
  return {
    updatedAt: '01/01/2026 08:00:00',
    filters: { overview: { label: '30 ngày' } },
    kpi: { revenueToday: 1000, totalCustomers: 5 },
    overview: { revenueByDay: [1] },
    products: { topSellingProducts: [{ code: 'A' }] },
    lowStock: [{ code: 'A' }],
    stockValueByCategory: [{ name: 'X' }],
    allProducts: [{ code: 'A' }],
    stockByCategory: [{ name: 'X' }],
    invoices: { revenueByDay: [2] },
    customers: { topRevenue: [{ name: 'KH' }] },
    suppliers: [{ name: 'NCC' }],
    newPurchases: { orderCount: 3 },
    debtManagement: { customers: [{ customerName: 'KH nợ' }] }
  };
}

test('giu lai updatedAt/filters/kpi va dung cac phan duoc phep', () => {
  const filtered = filterDashboardForUser(samplePayload(), ['reports.overview', 'reports.debt']);

  assert.ok(filtered.updatedAt);
  assert.ok(filtered.filters);
  assert.ok(filtered.kpi, 'kpi la so tong hop cua chinh tab Tong quan, luon giu');
  assert.ok(filtered.overview);
  assert.ok(filtered.debtManagement);

  for (const key of ['products', 'lowStock', 'stockValueByCategory', 'allProducts', 'stockByCategory',
    'invoices', 'customers', 'suppliers', 'newPurchases']) {
    assert.equal(key in filtered, false, `${key} phai bi cat bo`);
  }
});

test('quyen reports.products mo dung 5 khoa cua tab Hang hoa', () => {
  const filtered = filterDashboardForUser(samplePayload(), ['reports.products']);
  assert.deepEqual(
    Object.keys(filtered).sort(),
    ['allProducts', 'filters', 'kpi', 'lowStock', 'products', 'stockByCategory', 'stockValueByCategory', 'updatedAt'].sort()
  );
});

test('quyen reports.suppliers mo ca suppliers lan newPurchases', () => {
  const filtered = filterDashboardForUser(samplePayload(), ['reports.suppliers']);
  assert.ok(filtered.suppliers);
  assert.ok(filtered.newPurchases);
});

test('KHONG sua object dau vao — getDashboardData dung chung cache cho moi nguoi dung', () => {
  const original = samplePayload();
  const snapshot = JSON.stringify(original);

  const filtered = filterDashboardForUser(original, ['reports.overview']);

  assert.equal(JSON.stringify(original), snapshot, 'object goc phai nguyen ven');
  assert.notEqual(filtered, original, 'phai la object moi');
  assert.ok(!('debtManagement' in filtered));
  assert.ok('debtManagement' in original);

  // Nguoi dung du quyen goi ngay sau do van phai nhan du du lieu.
  const full = filterDashboardForUser(original, Object.values(SECTION_FEATURE));
  assert.ok(full.debtManagement);
  assert.ok(full.products);
});

test('khoa la trong payload duoc giu nguyen (khong lam mat du lieu khi them muc moi)', () => {
  const filtered = filterDashboardForUser({ kpi: {}, mucMoiChuaKhaiBao: 42 }, []);
  assert.equal(filtered.mucMoiChuaKhaiBao, 42);
});

test('searchFeatureForView anh xa dung, view la roi ve Tong quan', () => {
  assert.equal(searchFeatureForView('customers'), 'reports.customers');
  assert.equal(searchFeatureForView('suppliers'), 'reports.suppliers');
  assert.equal(searchFeatureForView('overview'), 'reports.overview');
  assert.equal(searchFeatureForView('khong-ton-tai'), 'reports.overview');
  assert.equal(searchFeatureForView(undefined), 'reports.overview');
});

test('allowedSearchEntities gioi han pham vi quet cua view Tong quan', () => {
  assert.deepEqual(
    allowedSearchEntities(['reports.overview', 'reports.customers']).sort(),
    ['customers']
  );
  assert.deepEqual(
    allowedSearchEntities(['reports.invoices']).sort(),
    ['invoices', 'orders', 'returns'].sort()
  );
  assert.deepEqual(allowedSearchEntities([]), []);
});
