'use strict';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const CONFIG = require('../config');
const {
  VIEW_NAMES, VIEW_FEATURE, VIEW_PAYLOAD, PERIODS_KEY, ALL_CORE_KEYS, ALL_ROLLUPS,
  parseViewsParam, resolveViewPlan, pickPayload, pickFilters
} = require('./dashboardViews');
const { SECTION_FEATURE } = require('./dashboardPermissionFilter');

test('chi con 3 tab co payload /api/dashboard: Tong quan, Hoa don, Cong no (Hang hoa / Khach hang da co API rieng)', () => {
  assert.deepEqual([...VIEW_NAMES], ['overview', 'invoices', 'debt']);
});

test('parseViewsParam: bo trong = ca 3 tab (null), tach dau phay, bo trung/khoang trang', () => {
  assert.equal(parseViewsParam(undefined), null);
  assert.equal(parseViewsParam(null), null);
  assert.equal(parseViewsParam(''), null);
  assert.equal(parseViewsParam(' , '), null);
  assert.deepEqual(parseViewsParam('overview'), ['overview']);
  assert.deepEqual(parseViewsParam(' overview , invoices,overview '), ['overview', 'invoices']);
  assert.deepEqual(parseViewsParam(['invoices', 'debt']), ['invoices', 'debt']);
});

test('parseViewsParam: ten tab sai (ke ca tab da go: products, customers) bi tu choi 400 INVALID_VIEW', () => {
  assert.throws(
    () => parseViewsParam('overview,hoadon'),
    error => error.code === 'INVALID_VIEW' && error.statusCode === 400 && /hoadon/.test(error.message)
  );
  assert.throws(() => parseViewsParam('__proto__'), error => error.code === 'INVALID_VIEW');
  assert.throws(() => parseViewsParam('products'), error => error.code === 'INVALID_VIEW');
  assert.throws(() => parseViewsParam('customers'), error => error.code === 'INVALID_VIEW');
});

test('ke hoach ca 3 tab (khong truyen view) = chi doc bang Hoa don + 3 rollup + cong no, khoa cache "all"', () => {
  const plan = resolveViewPlan();
  assert.equal(plan.all, true);
  assert.deepEqual(plan.views, VIEW_NAMES);
  assert.equal(plan.key, 'all');
  assert.deepEqual(plan.coreKeys, ALL_CORE_KEYS);
  assert.deepEqual([...plan.rollups], ALL_ROLLUPS);
  assert.deepEqual([...plan.rollups].sort(), ['invoiceQuantity', 'invoicesRevenue', 'overviewRevenue']);
  assert.equal(plan.needsDebt, true);
  assert.deepEqual(plan.coreKeys, [CONFIG.SHEET_INVOICES]);
  assert.ok(!plan.coreKeys.includes(CONFIG.SHEET_ORDERS));
  assert.ok(!plan.coreKeys.includes(PERIODS_KEY), 'quy tac 1-3-7 da bo');
});

test('Tong quan chi doc bang Hoa don, KHONG doc Dat hang/Tra hang/cong no va khong chay rollup so luong hoa don', () => {
  const plan = resolveViewPlan(['overview']);
  assert.equal(plan.all, false);
  assert.equal(plan.key, 'overview');
  assert.deepEqual(plan.coreKeys, [CONFIG.SHEET_INVOICES]);
  assert.ok(!plan.coreKeys.includes(PERIODS_KEY));
  assert.deepEqual([...plan.rollups].sort(), ['overviewRevenue']);
  assert.equal(plan.needsDebt, false);
  assert.deepEqual(plan.filterKeys, ['invoices'], 'bo loc ov* da bo — Tong quan dung bo loc invoices');
});

test('moi tab chi doc dung nguon cua no; Cong no khong doc bang nguon core nao (doc ban chot rieng)', () => {
  const sheetsOf = name => resolveViewPlan([name]).coreKeys;
  assert.deepEqual(sheetsOf('invoices'), [CONFIG.SHEET_INVOICES], 'Hoa don khong doc Dat hang/Tra hang (the chi so Tra hang da go)');
  assert.throws(() => sheetsOf('customers'), error => error.code === 'INVALID_VIEW', 'tab Khach hang cu da go');
  assert.throws(() => sheetsOf('products'), error => error.code === 'INVALID_VIEW', 'tab Hang hoa cu da go');
  assert.deepEqual(sheetsOf('debt'), []);
  assert.equal(resolveViewPlan(['debt']).needsDebt, true);
  assert.equal(resolveViewPlan(['debt']).rollups.size, 0);
  assert.deepEqual([...resolveViewPlan(['invoices']).rollups].sort(), ['invoiceQuantity', 'invoicesRevenue']);
});

test('nhieu tab: hop cac nguon theo thu tu chuan, khoa cache on dinh khong phu thuoc thu tu truyen vao', () => {
  const a = resolveViewPlan(['invoices', 'overview']);
  const b = resolveViewPlan(['overview', 'invoices', 'overview']);
  assert.equal(a.key, 'overview+invoices');
  assert.equal(b.key, a.key);
  assert.deepEqual(a.coreKeys, b.coreKeys);
  assert.ok(a.has('overview') && a.has('invoices') && !a.has('debt'));
  assert.deepEqual([...a.rollups].sort(), ['invoiceQuantity', 'invoicesRevenue', 'overviewRevenue']);
});

test('resolveViewPlan tu choi ten tab sai', () => {
  assert.throws(() => resolveViewPlan(['overview', 'nope']), error => error.code === 'INVALID_VIEW');
});

test('moi khoa payload top-level cua tab dung quyen cua chinh tab do (khop SECTION_FEATURE), tru khoa luon giu', () => {
  VIEW_NAMES.forEach(view => {
    VIEW_PAYLOAD[view].top.forEach(key => {
      assert.equal(SECTION_FEATURE[key], VIEW_FEATURE[view], `${view}.${key} phai can quyen ${VIEW_FEATURE[view]}`);
    });
  });
});

test('pickFilters: chi giu bo loc anh huong tab (cache key), ke hoach ca 3 tab giu nguyen', () => {
  const filters = {
    overview: { mode: 'days', days: 30 }, products: { mode: 'days', days: 7 }, invoices: { mode: 'days', days: 3 },
    customers: { mode: 'all' }, newProducts: { mode: 'days', days: 30 }
  };
  assert.equal(pickFilters(filters, resolveViewPlan()), filters);
  assert.deepEqual(pickFilters(filters, resolveViewPlan(['invoices'])), { invoices: { mode: 'days', days: 3 } });
  assert.deepEqual(pickFilters(filters, resolveViewPlan(['debt'])), {});
  // Bo loc cu cua tab Hang hoa / Khach hang / orders / returns da go: khong con anh huong cache key.
  assert.deepEqual(pickFilters(filters, resolveViewPlan(['overview'])), { invoices: { mode: 'days', days: 3 } });
  assert.deepEqual(VIEW_PAYLOAD.invoices.filters, ['invoices']);
});

test('pickPayload: cat dung phan cua tab, khong sua ban day du', () => {
  const full = {
    updatedAt: 'x',
    filters: { invoices: 3 },
    kpi: {},
    overview: { a: 1 },
    invoices: { big: 1 }, debtManagement: { k: 1 }
  };
  const snapshot = JSON.stringify(full);

  const overview = pickPayload(full, resolveViewPlan(['overview']));
  assert.deepEqual(Object.keys(overview).sort(), ['filters', 'kpi', 'overview', 'updatedAt']);
  assert.deepEqual(overview.filters, { invoices: 3 });
  assert.equal(overview.invoices, undefined);

  const both = pickPayload(full, resolveViewPlan(['overview', 'invoices']));
  assert.equal(both.overview.a, 1);
  assert.equal(both.invoices, full.invoices);

  const debt = pickPayload(full, resolveViewPlan(['debt']));
  assert.deepEqual(Object.keys(debt).sort(), ['debtManagement', 'filters', 'kpi', 'updatedAt']);
  assert.deepEqual(debt.kpi, {});

  assert.equal(pickPayload(full, resolveViewPlan()), full, 'ke hoach ca 3 tab tra nguyen ban day du');
  assert.equal(JSON.stringify(full), snapshot, 'khong duoc sua ban day du (co the la object trong cache dung chung)');
});
