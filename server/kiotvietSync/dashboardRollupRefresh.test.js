'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  refreshDashboardRollups, refreshDashboardRollupsAndNotify, startDashboardRollupSchedule,
  DEFAULT_WINDOW_DAYS, HOT_WINDOW_DAYS
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
    intervalMs: 5000, setIntervalFn, scheduleImmediate: () => {}, log: (m) => logs.push(m),
    getConfiguredBranches: () => [{ branch: 'hanoi' }]
  });

  assert.equal(handle, 'handle-rollup');
  assert.equal(scheduledMs, 5000);
  await scheduledFn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pool.calls.length, 4, '1 co so x 4 cau SQL phai duoc chay khi trigger');
});

// Thieu lan chay ngay nay chinh la nguyen nhan Dashboard treo o so lieu cu sau
// moi lan restart/redeploy (quan sat tren Supabase 2026-09-24: server len luc
// 06:47 nhung rollup den 06:52 moi chay).
test('startDashboardRollupSchedule chay NGAY mot luot khi khoi dong, khong doi het interval', async () => {
  const pool = fakePool([1, 1, 1, 1]);
  const events = { emit: () => {} };
  let immediateFn;
  startDashboardRollupSchedule(pool, {
    setIntervalFn: () => 'h',
    scheduleImmediate: (fn) => { immediateFn = fn; },
    log: () => {},
    events,
    getConfiguredBranches: () => [{ branch: 'hanoi' }]
  });

  assert.equal(typeof immediateFn, 'function', 'phai dang ky mot luot chay ngay');
  assert.equal(pool.calls.length, 0, 'chua chay gi truoc khi scheduleImmediate kich hoat');
  await immediateFn();
  assert.equal(pool.calls.length, 4, 'luot chay ngay phai tinh lai du 4 bang');
});

test('startDashboardRollupSchedule khong nem loi ra ngoai neu refresh that bai', async () => {
  let scheduledFn;
  const setIntervalFn = (fn) => { scheduledFn = fn; return 'h'; };
  const pool = { query: async () => { throw new Error('db down'); } };
  const logs = [];
  startDashboardRollupSchedule(pool, {
    setIntervalFn,
    scheduleImmediate: () => {},
    log: (m) => logs.push(m),
    getConfiguredBranches: () => [{ branch: 'hanoi' }]
  });
  assert.doesNotThrow(() => scheduledFn());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Loi khi refresh/);
});

test('luot "nong" bo qua product_first_purchase va chi tinh HOT_WINDOW_DAYS ngay', async () => {
  const pool = fakePool([2, 2, 2]);
  const results = await refreshDashboardRollups(pool, {
    windowDays: HOT_WINDOW_DAYS,
    includeFirstPurchase: false,
    log: () => {},
    getConfiguredBranches: () => [{ branch: 'hanoi' }]
  });

  assert.equal(pool.calls.length, 3, 'chi 3 cau SQL - khong dung toi product_first_purchase');
  assert.ok(!pool.calls.some((c) => /product_first_purchase/.test(c.sql)));
  assert.deepEqual(pool.calls[0].params, ['hanoi', HOT_WINDOW_DAYS]);
  assert.equal(results[0].productFirstPurchase, 0);
});

test('hai luot rollup goi chong nhau duoc noi tiep, khong dam vao cung dong', async () => {
  const order = [];
  const slowPool = {
    query: async () => {
      order.push('day-du:bat-dau');
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('day-du:xong');
      return { rowCount: 0 };
    }
  };
  const fastPool = {
    query: async () => { order.push('nong'); return { rowCount: 0 }; }
  };
  const events = { emit: () => {} };
  const opts = { events, log: () => {}, getConfiguredBranches: () => [{ branch: 'hanoi' }] };

  await Promise.all([
    refreshDashboardRollupsAndNotify(slowPool, { ...opts, includeFirstPurchase: false }),
    refreshDashboardRollupsAndNotify(fastPool, { ...opts, includeFirstPurchase: false })
  ]);

  const firstHot = order.indexOf('nong');
  assert.ok(firstHot > order.lastIndexOf('day-du:xong'),
    'luot "nong" chi duoc chay sau khi luot day du ket thuc, thu tu thuc te: ' + order.join(','));
});

test('refreshDashboardRollupsAndNotify chi phat su kien khi refresh thanh cong', async () => {
  const emitted = [];
  const events = { emit: (name) => emitted.push(name) };

  await refreshDashboardRollupsAndNotify(fakePool(), {
    events, log: () => {}, getConfiguredBranches: () => [{ branch: 'hanoi' }]
  });
  assert.deepEqual(emitted, ['updated']);

  const logs = [];
  await refreshDashboardRollupsAndNotify({ query: async () => { throw new Error('db down'); } }, {
    events, log: (m) => logs.push(m), getConfiguredBranches: () => [{ branch: 'hanoi' }]
  });
  assert.deepEqual(emitted, ['updated'], 'refresh loi thi KHONG duoc bao "co du lieu moi"');
  assert.match(logs[0], /Loi khi refresh/);
});
