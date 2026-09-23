'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  refreshProductReport, refreshProductReportIfDue, startProductReportSchedule, __sql__, __test__
} = require('./productReportRefresh');

function fakeClient(insertRowCount = 7) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql === 'TRUNCATE product_report') return {};
      return { rowCount: insertRowCount };
    },
    release: () => {}
  };
}

function fakePool(client) {
  return { connect: async () => client, query: async () => ({ rows: [] }) };
}

test('refreshProductReport chay dung trinh tu BEGIN/TRUNCATE/INSERT/COMMIT trong 1 transaction', async () => {
  const client = fakeClient(42);
  const pool = fakePool(client);
  const logs = [];
  const result = await refreshProductReport(pool, { log: (m) => logs.push(m) });

  assert.deepEqual(client.calls.map((c) => c.sql.split('\n')[0].trim() || c.sql), [
    'BEGIN', 'TRUNCATE product_report', __sql__.REFRESH_SQL.split('\n')[0].trim() || __sql__.REFRESH_SQL, 'COMMIT'
  ]);
  assert.deepEqual(client.calls[2].params, [['hanoi', 'saigon']]);
  assert.equal(result.rowCount, 42);
  assert.match(logs[0], /42/);
});

test('refreshProductReport ROLLBACK va nem loi neu INSERT that bai', async () => {
  const calls = [];
  const client = {
    calls,
    query: async (sql) => {
      calls.push(sql);
      if (sql === __sql__.REFRESH_SQL) throw new Error('boom');
      return {};
    },
    release: () => {}
  };
  await assert.rejects(() => refreshProductReport(fakePool(client), { log: () => {} }), /boom/);
  assert.ok(calls.includes('ROLLBACK'));
});

test('refreshProductReportIfDue bo qua neu da tinh cho ngay VN hom nay', async () => {
  const now = new Date('2026-09-23T10:00:00Z'); // 17h VN cung ngay
  const pool = {
    query: async () => ({ rows: [{ last_computed_at: new Date('2026-09-23T00:05:00Z') }] })
  };
  const result = await refreshProductReportIfDue(pool, { now: () => now, log: () => {} });
  assert.deepEqual(result, { skipped: true });
});

test('refreshProductReportIfDue tinh lai neu chua tinh cho ngay VN hom nay', async () => {
  const now = new Date('2026-09-23T00:03:00Z'); // dau ngay VN moi (07h VN)
  const client = fakeClient(10);
  const pool = {
    query: async (sql) => {
      if (sql.includes('MAX(computed_at)')) return { rows: [{ last_computed_at: new Date('2026-09-21T20:00:00Z') }] };
      return { rows: [] };
    },
    connect: async () => client
  };
  const result = await refreshProductReportIfDue(pool, { now: () => now, log: () => {} });
  assert.deepEqual(result, { skipped: false, rowCount: 10 });
});

test('refreshProductReportIfDue tinh lai neu bang con trong (chua tung tinh)', async () => {
  const client = fakeClient(3);
  const pool = { query: async () => ({ rows: [{ last_computed_at: null }] }), connect: async () => client };
  const result = await refreshProductReportIfDue(pool, { now: () => new Date(), log: () => {} });
  assert.deepEqual(result, { skipped: false, rowCount: 3 });
});

test('startProductReportSchedule dang ky interval va chay ngay 1 lan luc boot', async () => {
  let scheduledFn;
  let scheduledMs;
  let immediateFn;
  const setIntervalFn = (fn, ms) => { scheduledFn = fn; scheduledMs = ms; return 'handle-product-report'; };
  const scheduleImmediate = (fn) => { immediateFn = fn; };
  const client = fakeClient(5);
  const pool = { query: async () => ({ rows: [{ last_computed_at: null }] }), connect: async () => client };

  const handle = startProductReportSchedule(pool, { intervalMs: 5000, setIntervalFn, scheduleImmediate, log: () => {} });

  assert.equal(handle, 'handle-product-report');
  assert.equal(scheduledMs, 5000);
  assert.equal(typeof immediateFn, 'function');
  assert.equal(typeof scheduledFn, 'function');

  await immediateFn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(client.calls.some((c) => c.sql === 'BEGIN'), 'phai tinh ngay 1 lan luc boot');
});

test('vnDateKey tra ve ngay lich VN (UTC+7), khong phai ngay UTC', () => {
  // 2026-09-22T18:30:00Z = 2026-09-23 01:30 VN -> da sang ngay moi theo lich VN.
  assert.equal(__test__.vnDateKey(new Date('2026-09-22T18:30:00Z')), '2026-09-23');
  assert.equal(__test__.vnDateKey(new Date('2026-09-22T10:00:00Z')), '2026-09-22');
});
