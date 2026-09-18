'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  refreshDashboardRollups, startDashboardRollupSchedule, DEFAULT_WINDOW_DAYS
} = require('./dashboardRollupRefresh');

function fakePool(rowCountByCallIndex = []) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      const rowCount = rowCountByCallIndex[calls.length - 1];
      return { rowCount: rowCount === undefined ? 0 : rowCount };
    }
  };
}

test('refreshDashboardRollups chay dung 4 cau SQL cho tung co so da cau hinh, dung windowDays mac dinh', async () => {
  const pool = fakePool([3, 5, 2, 1]);
  const logs = [];
  const results = await refreshDashboardRollups(pool, {
    getConfiguredBranches: () => [{ branch: 'hanoi' }],
    log: (m) => logs.push(m)
  });

  assert.equal(pool.calls.length, 4, 'phai chay 4 cau SQL (invoice/product/purchase/first-purchase) cho 1 co so');
  assert.match(pool.calls[0].sql, /daily_invoice_summary/);
  assert.deepEqual(pool.calls[0].params, ['hanoi', DEFAULT_WINDOW_DAYS]);
  assert.match(pool.calls[1].sql, /daily_product_sales/);
  assert.deepEqual(pool.calls[1].params, ['hanoi', DEFAULT_WINDOW_DAYS]);
  assert.match(pool.calls[2].sql, /daily_purchase_summary/);
  assert.deepEqual(pool.calls[2].params, ['hanoi', DEFAULT_WINDOW_DAYS]);
  assert.match(pool.calls[3].sql, /product_first_purchase/);
  // Bang "ngay nhap dau tien" KHONG gioi han cua so ngay - chi truyen branch.
  assert.deepEqual(pool.calls[3].params, ['hanoi']);

  assert.deepEqual(results, [{
    branch: 'hanoi', dailyInvoiceSummary: 3, dailyProductSales: 5, dailyPurchaseSummary: 2, productFirstPurchase: 1
  }]);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /hanoi/);
});

test('refreshDashboardRollups chay lan luot cho tung co so da cau hinh, dung windowDays tuy chinh', async () => {
  const pool = fakePool();
  const results = await refreshDashboardRollups(pool, {
    windowDays: 30,
    getConfiguredBranches: () => [{ branch: 'hanoi' }, { branch: 'saigon' }]
  });

  assert.equal(pool.calls.length, 8, '2 co so x 4 cau SQL');
  assert.deepEqual(pool.calls[0].params, ['hanoi', 30]);
  assert.deepEqual(pool.calls[4].params, ['saigon', 30]);
  assert.deepEqual(results.map((r) => r.branch), ['hanoi', 'saigon']);
});

test('refreshDashboardRollups khong chay gi khi khong co co so nao du cau hinh', async () => {
  const pool = fakePool();
  const results = await refreshDashboardRollups(pool, { getConfiguredBranches: () => [] });
  assert.equal(pool.calls.length, 0);
  assert.deepEqual(results, []);
});

test('startDashboardRollupSchedule dang ky dung interval, chay refresh khi trigger', async () => {
  let scheduledFn;
  let scheduledMs;
  const setIntervalFn = (fn, ms) => { scheduledFn = fn; scheduledMs = ms; return 'handle-rollup'; };
  const pool = fakePool([1, 1, 1, 1]);
  const logs = [];
  const handle = startDashboardRollupSchedule(pool, {
    intervalMs: 5000, setIntervalFn, log: (m) => logs.push(m),
    getConfiguredBranches: () => [{ branch: 'hanoi' }]
  });

  assert.equal(handle, 'handle-rollup');
  assert.equal(scheduledMs, 5000);
  await scheduledFn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pool.calls.length, 4, '1 co so x 4 cau SQL phai duoc chay khi trigger');
});

test('startDashboardRollupSchedule khong nem loi ra ngoai neu refresh that bai', async () => {
  let scheduledFn;
  const setIntervalFn = (fn) => { scheduledFn = fn; return 'h'; };
  const pool = { query: async () => { throw new Error('db down'); } };
  const logs = [];
  startDashboardRollupSchedule(pool, {
    setIntervalFn,
    log: (m) => logs.push(m),
    getConfiguredBranches: () => [{ branch: 'hanoi' }]
  });
  assert.doesNotThrow(() => scheduledFn());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Loi khi refresh/);
});
