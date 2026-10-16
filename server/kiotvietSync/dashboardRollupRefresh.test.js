'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  refreshDashboardRollups, refreshDashboardRollupsAndNotify, startDashboardRollupSchedule,
  DEFAULT_WINDOW_DAYS, HOT_WINDOW_DAYS, __sql__
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

test('refreshDashboardRollups chay dung 3 cau SQL cho tung co so da cau hinh, dung windowDays mac dinh', async () => {
  const pool = fakePool([3, 5, 1]);
  const logs = [];
  const results = await refreshDashboardRollups(pool, {
    getConfiguredBranches: () => [{ branch: 'hanoi' }],
    log: (m) => logs.push(m),
    firstPurchaseFullRunAt: new Map()
  });

  assert.equal(pool.calls.length, 3, 'phai chay 3 cau SQL (invoice/product/first-purchase) cho 1 co so');
  assert.match(pool.calls[0].sql, /daily_invoice_summary/);
  assert.deepEqual(pool.calls[0].params, ['hanoi', DEFAULT_WINDOW_DAYS]);
  assert.match(pool.calls[1].sql, /daily_product_sales/);
  assert.deepEqual(pool.calls[1].params, ['hanoi', DEFAULT_WINDOW_DAYS]);
  assert.match(pool.calls[2].sql, /product_first_purchase/);
  // Bang "ngay nhap dau tien" KHONG gioi han cua so ngay - chi truyen branch.
  assert.deepEqual(pool.calls[2].params, ['hanoi']);

  assert.deepEqual(results, [{
    branch: 'hanoi', dailyInvoiceSummary: 3, dailyProductSales: 5, productFirstPurchase: 1
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

  assert.equal(pool.calls.length, 6, '2 co so x 3 cau SQL');
  assert.deepEqual(pool.calls[0].params, ['hanoi', 30]);
  assert.deepEqual(pool.calls[3].params, ['saigon', 30]);
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
  assert.equal(pool.calls.length, 3, '1 co so x 3 cau SQL phai duoc chay khi trigger');
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
  assert.equal(pool.calls.length, 3, 'luot chay ngay phai tinh lai du 3 bang');
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
  const pool = fakePool([2, 2]);
  const results = await refreshDashboardRollups(pool, {
    windowDays: HOT_WINDOW_DAYS,
    includeFirstPurchase: false,
    log: () => {},
    getConfiguredBranches: () => [{ branch: 'hanoi' }]
  });

  assert.equal(pool.calls.length, 2, 'chi 2 cau SQL - khong dung toi product_first_purchase');
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

// Cac cau rollup chay hang tram lan/ngay: khong duoc ghi de dong khong doi (do
// 2026-09-28: ~115 trieu UPDATE tren 62.000 dong, 36,8GB WAL/34 ngay) va bo
// loc ngay phai dung duoc index. Test chan viec ai do "don gian hoa" lai.
test('cac cau rollup loai dong khong doi o SELECT (LEFT JOIN + IS DISTINCT FROM), khong DO UPDATE vo dieu kien', () => {
  const { INVOICE_SUMMARY_SQL, PRODUCT_SALES_SQL, FIRST_PURCHASE_SQL, FIRST_PURCHASE_RECENT_SQL } = __sql__;
  for (const [sql, table] of [
    [INVOICE_SUMMARY_SQL, 'daily_invoice_summary'],
    [PRODUCT_SALES_SQL, 'daily_product_sales']
  ]) {
    assert.match(sql, new RegExp(`LEFT JOIN ${table} t`), `${table}: phai LEFT JOIN bang dich de biet dong nao doi`);
    assert.match(sql, /t\.branch IS NULL/, `${table}: dong moi phai duoc them`);
    assert.match(sql, /IS DISTINCT FROM/, `${table}: chi ghi khi gia tri khac`);
  }
  for (const sql of [FIRST_PURCHASE_SQL, FIRST_PURCHASE_RECENT_SQL]) {
    assert.match(sql, /LEFT JOIN product_first_purchase t/);
    assert.match(sql, /a\.first_purchase_date < t\.first_purchase_date/, 'chi ghi khi moc moi SOM HON moc dang luu');
  }
});

test('bo loc ngay cua rollup so sanh thang cot goc (dung duoc index), khong boc cot trong ::date', () => {
  for (const sql of [__sql__.INVOICE_AGG_SQL, __sql__.PRODUCT_SALES_AGG_SQL,
    __sql__.FIRST_PURCHASE_RECENT_SQL]) {
    assert.match(sql, /purchase_date >= \(\(\(now\(\) AT TIME ZONE 'Asia\/Ho_Chi_Minh'\)::date - \$2::int\)::timestamp AT TIME ZONE 'UTC'\)/);
    assert.doesNotMatch(sql, /\(\w*\.?purchase_date AT TIME ZONE 'UTC'\)::date >=/,
      'khong duoc quay lai dang (cot AT TIME ZONE ...)::date >= (khong dung duoc index)');
  }
});

test('daily_product_sales tru hang khach tra: dong AM tu return_details (Đã trả) theo ngay tra', () => {
  const sql = __sql__.PRODUCT_SALES_AGG_SQL;
  assert.match(sql, /UNION ALL/);
  assert.match(sql, /FROM return_details rd/);
  assert.match(sql, /r\.raw->>'statusValue' = 'Đã trả'/);
  assert.match(sql, /\(r\.return_date AT TIME ZONE 'UTC'\)::date AS sale_date/);
  assert.match(sql, /-abs\(COALESCE\(rd\.quantity, 0\)::float8\) AS qty/);
  assert.match(sql, /-\(CASE/);
  assert.match(sql, /r\.return_date >= \(\(\(now\(\) AT TIME ZONE 'Asia\/Ho_Chi_Minh'\)::date - \$2::int\)::timestamp AT TIME ZONE 'UTC'\)/,
    'loc ngay tra so sanh thang cot goc (dung index idx_returns_return_date)');
});

test('tong hop tinh ::numeric de so sanh dung kieu voi cot dich', () => {
  assert.match(__sql__.PRODUCT_SALES_AGG_SQL, /SUM\(s\.qty\), 0\)::numeric AS qty/);
  assert.match(__sql__.PRODUCT_SALES_AGG_SQL, /SUM\(s\.amount\), 0\)::numeric AS revenue/);
  assert.match(__sql__.INVOICE_AGG_SQL, /::numeric AS revenue/);
});

function fakePoolWithClient({ failOn } = {}) {
  const statements = [];
  let released = 0;
  const client = {
    query: async (sql) => {
      statements.push(String(sql).trim().split(/\s+/).slice(0, 3).join(' '));
      if (failOn && String(sql).includes(failOn)) throw new Error('boom');
      return { rowCount: 2 };
    },
    release: () => { released += 1; }
  };
  return { statements, get released() { return released; }, connect: async () => client, query: async () => { throw new Error('phai dung client'); } };
}

test('giao dich rollup chay voi SET LOCAL work_mem roi COMMIT, tra ket noi ve pool', async () => {
  const pool = fakePoolWithClient();
  await refreshDashboardRollups(pool, {
    windowDays: HOT_WINDOW_DAYS, includeFirstPurchase: false, log: () => {},
    getConfiguredBranches: () => [{ branch: 'hanoi' }]
  });
  // 2 cau x (BEGIN, SET LOCAL, cau chinh, COMMIT)
  assert.equal(pool.statements.length, 8);
  assert.deepEqual(pool.statements.slice(0, 4), ['BEGIN', "SET LOCAL work_mem", 'WITH agg AS', 'COMMIT']);
  assert.equal(pool.released, 2, 'moi giao dich phai tra ket noi ve pool');
});

test('giao dich rollup ROLLBACK, tra ket noi va nem lai loi khi cau SQL that bai', async () => {
  const pool = fakePoolWithClient({ failOn: 'daily_invoice_summary' });
  await assert.rejects(
    refreshDashboardRollups(pool, {
      windowDays: HOT_WINDOW_DAYS, includeFirstPurchase: false, log: () => {},
      getConfiguredBranches: () => [{ branch: 'hanoi' }]
    }),
    /boom/
  );
  assert.ok(pool.statements.includes('ROLLBACK'));
  assert.ok(!pool.statements.includes('COMMIT'));
  assert.equal(pool.released, 1);
});

test('product_first_purchase: lan dau moi co so chay ban DAY DU, sau do ban "gan day" cho toi khi het han', async () => {
  const pool = fakePool();
  const fullRunAt = new Map();
  let clock = 1_000_000;
  const opts = {
    log: () => {}, getConfiguredBranches: () => [{ branch: 'hanoi' }],
    firstPurchaseFullRunAt: fullRunAt, now: () => clock, firstPurchaseFullIntervalMs: 60_000
  };
  const firstPurchaseCall = (i) => pool.calls.filter((c) => /INTO product_first_purchase/.test(c.sql))[i];

  await refreshDashboardRollups(pool, opts);
  assert.deepEqual(firstPurchaseCall(0).params, ['hanoi'], 'lan dau: ban day du, chi truyen branch');
  assert.doesNotMatch(firstPurchaseCall(0).sql, /pu\.purchase_date >=/);

  clock += 30_000;
  await refreshDashboardRollups(pool, opts);
  assert.deepEqual(firstPurchaseCall(1).params, ['hanoi', DEFAULT_WINDOW_DAYS], 'chua het han: ban gan day co cua so ngay');
  assert.match(firstPurchaseCall(1).sql, /pu\.purchase_date >=/);

  clock += 30_000;
  await refreshDashboardRollups(pool, opts);
  assert.deepEqual(firstPurchaseCall(2).params, ['hanoi'], 'het han: quay lai ban day du');
});

test('product_first_purchase: ban day du that bai thi KHONG ghi nhan de lan sau thu lai ban day du', async () => {
  const fullRunAt = new Map();
  const failing = { query: async () => { throw new Error('db down'); } };
  await assert.rejects(refreshDashboardRollups(failing, {
    log: () => {}, getConfiguredBranches: () => [{ branch: 'hanoi' }], firstPurchaseFullRunAt: fullRunAt
  }));
  assert.equal(fullRunAt.has('hanoi'), false);
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
