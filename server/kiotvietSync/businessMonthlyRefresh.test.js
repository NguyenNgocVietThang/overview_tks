'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const job = require('./businessMonthlyRefresh');

function fakePool(frozenMonths = []) {
  const calls = [];
  const client = {
    query: async (text, params) => {
      calls.push({ text: String(text), params });
      if (/SELECT group_hash FROM business_monthly_state/.test(text)) return { rows: frozenMonths.map(month => ({ month, group_hash: null })) };
      if (text === require('../businessReport/businessMonthlySql').GROUP_HASH_SQL) return { rows: [{ group_hash: 'test-hash' }] };
      if (/SELECT COUNT\(\*\)::int AS customer_rows/.test(text)) return { rows: [{ customer_rows: 3, customer_product_rows: 5, net_revenue: '1000' }] };
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  return {
    calls,
    connect: async () => client,
    query: async (text, params) => {
      calls.push({ text: String(text), params });
      if (/FROM business_monthly_state/.test(text)) return { rows: frozenMonths.map(month => ({ month })) };
      if (/AS upserted/.test(text)) return { rows: [{ upserted: 0, deleted: 0 }] };
      return { rows: [] };
    }
  };
}

test('freezeMonth: 1 giao dich, xoa thang cu roi nap lai 3 bang + ghi state', async () => {
  const pool = fakePool();
  const r = await job.freezeMonth(pool, '2026-09-01', { log: () => {} });
  const texts = pool.calls.map(c => c.text.replace(/\s+/g, ' ').trim());
  assert.equal(texts[0], 'BEGIN');
  assert.ok(texts.some(t => /^SET LOCAL work_mem/.test(t)));
  for (const table of ['business_monthly_customer_sales', 'business_monthly_customer_product_sales', 'business_monthly_product_sales']) {
    assert.ok(texts.some(t => t.startsWith(`DELETE FROM ${table} WHERE month = $1`)), table);
  }
  assert.ok(texts.some(t => /INSERT INTO business_monthly_state/.test(t)));
  assert.equal(texts.at(-1), 'COMMIT');
  const fill = pool.calls.find(c => /INSERT INTO business_monthly_customer_sales/.test(c.text));
  assert.deepEqual(fill.params, [['hanoi', 'saigon'], '2026-09-01', '2026-10-01']);
  assert.deepEqual(r, { month: '2026-09-01', customerRows: 3, customerProductRows: 5, netRevenue: 1000 });
});

test('IfDue: truoc 00:10 ngay 1 khong chot thang vua qua; sau do backfill moi thang thieu tu 2026-03', async () => {
  const early = fakePool(['2026-03-01']);
  const r1 = await job.refreshBusinessMonthlyIfDue(early, { log: () => {}, now: () => new Date('2026-09-30T17:05:00Z') }); // 00:05 VN 01/10
  assert.deepEqual(r1.frozen, ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01']);
  const late = fakePool(['2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01']);
  const r2 = await job.refreshBusinessMonthlyIfDue(late, { log: () => {}, now: () => new Date('2026-09-30T17:15:00Z') }); // 00:15 VN
  assert.deepEqual(r2.frozen, ['2026-09-01']);
});

test('IfDue dung lai sale khi state chua co hash', async () => {
  const months = ['2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'];
  const pool = fakePool(months);
  const r = await job.refreshBusinessMonthlyIfDue(pool, { log: () => {}, now: () => new Date('2026-10-07T03:00:00Z') });
  assert.deepEqual(r.frozen, []);
  assert.ok(pool.calls.some(c => /AS upserted/.test(c.text)));
});

test('main: thang chay tay sai (dinh dang / truoc T3-2026 / chua ket thuc) => bao loi, ma 2, khong mo pool', async () => {
  const now = () => new Date('2026-10-07T03:00:00Z');
  for (const arg of ['2026-10', '2026-11', '2026-02', '2026-9', 'abc', '2026-09-15']) {
    const errors = [];
    let opened = 0;
    const code = await job.main([arg], { now, getPoolFn: () => { opened += 1; return fakePool(); }, log: () => {}, logError: m => errors.push(m) });
    assert.equal(code, 2, arg);
    assert.equal(opened, 0, `${arg}: khong duoc mo ket noi DB`);
    assert.match(errors[0], /\[businessMonthlyRefresh\].*Không ghi gì/, arg);
  }
});

test('main: thang da ket thuc => chot dung thang do roi dong pool; khong tham so => IfDue', async () => {
  const now = () => new Date('2026-10-07T03:00:00Z');
  const pool = fakePool(['2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']);
  let ended = 0;
  pool.end = async () => { ended += 1; };
  assert.equal(await job.main(['2026-09'], { now, getPoolFn: () => pool, log: () => {}, logError: () => {} }), 0);
  const fill = pool.calls.find(c => /INSERT INTO business_monthly_customer_sales/.test(c.text));
  assert.deepEqual(fill.params, [['hanoi', 'saigon'], '2026-09-01', '2026-10-01']);
  assert.equal(ended, 1);
  pool.calls.length = 0;
  assert.equal(await job.main([], { now, getPoolFn: () => pool, log: () => {}, logError: () => {} }), 0);
  assert.ok(!pool.calls.some(c => /INSERT INTO business_monthly_customer_sales/.test(c.text)), 'du thang => khong chot gi');
  assert.equal(ended, 2);
});

test('schedule chay ngay 1 luot va fail-soft', async () => {
  const logs = [];
  let immediate; let interval;
  const handle = job.startBusinessMonthlySchedule({ query: async () => { throw new Error('db down'); } }, {
    intervalMs: 99, setIntervalFn: (fn, ms) => { interval = { fn, ms }; return 'h'; },
    scheduleImmediate: fn => { immediate = fn; }, log: m => logs.push(m)
  });
  assert.equal(handle, 'h');
  assert.equal(interval.ms, 99);
  immediate();
  await new Promise(r => setImmediate(r));
  assert.match(logs[0], /\[businessMonthlyRefresh\] Loi/);
});
