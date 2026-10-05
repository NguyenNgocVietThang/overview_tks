'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  filterDashboardForUser,
  SECTION_FEATURE
} = require('./dashboardPermissionFilter');

function samplePayload() {
  return {
    updatedAt: '01/01/2026 08:00:00',
    filters: { invoices: { label: '30 ngày' } },
    kpi: { totalStock: 1000, totalCustomers: 5 },
    overview: { revenueByDay: [1] },
    products: { topSellingProducts: [{ code: 'A' }] },
    allProducts: [{ code: 'A' }],
    invoices: { revenueByDay: [2] },
    customers: { topRevenue: [{ name: 'KH' }] },
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

  for (const key of ['products', 'allProducts', 'invoices', 'customers']) {
    assert.equal(key in filtered, false, `${key} phai bi cat bo`);
  }
});

test('quyen reports.products mo dung cac khoa cua tab Hang hoa', () => {
  const filtered = filterDashboardForUser(samplePayload(), ['reports.products']);
  assert.deepEqual(
    Object.keys(filtered).sort(),
    ['allProducts', 'filters', 'kpi', 'products', 'updatedAt'].sort()
  );
  assert.equal('stockByCategory' in SECTION_FEATURE, false, 'stockByCategory da go khoi payload');
  assert.equal('stockValueByCategory' in SECTION_FEATURE, false, 'stockValueByCategory da go khoi payload');
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
