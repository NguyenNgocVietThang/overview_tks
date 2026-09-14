'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createKiotVietSyncStatusRouter } = require('./kiotvietSyncStatusRoutes');

function handlerFor(router) { return router.stack.find((x) => x.route).route.stack.at(-1).handle; }
function fakeRes() { const r = { statusCode: null, body: null }; r.status = (x) => (r.statusCode = x, r); r.json = (x) => (r.body = x, r); return r; }

function routedPool(routes) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      for (const { pattern, handle } of routes) {
        if (pattern.test(sql)) return handle(sql, params);
      }
      throw new Error(`Fake pool: khong co route cho SQL: ${sql}`);
    }
  };
}

const CHECKPOINTS_PATTERN = /^SELECT branch, entity, last_synced_at/;
const COUNTS_PATTERN = /^SELECT branch, COUNT\(\*\)::int AS count FROM (\w+) GROUP BY branch/;
const SAMPLES_PATTERN = /^SELECT \* FROM (\w+) WHERE branch = \$1 ORDER BY/;
const BACKFILL_PROGRESS_PATTERN = /^SELECT branch, entity, status, COUNT/;

test('status returns 503 without SUPABASE_DB_URL and never queries the pool', async () => {
  let queried = false;
  const router = createKiotVietSyncStatusRouter({ databaseUrl: null, pool: { query: async () => { queried = true; } } });
  const res = fakeRes();
  await handlerFor(router)({}, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'SUPABASE_DB_NOT_CONFIGURED');
  assert.equal(queried, false);
});

test('status returns checkpoints ordered by branch and entity using a fixed query', async () => {
  const rows = [{ branch: 'hanoi', entity: 'invoices', last_synced_at: 'a', last_success_at: 'b', note: null }];
  const pool = routedPool([
    { pattern: CHECKPOINTS_PATTERN, handle: () => ({ rows }) },
    { pattern: COUNTS_PATTERN, handle: () => ({ rows: [] }) },
    { pattern: SAMPLES_PATTERN, handle: () => ({ rows: [] }) },
    { pattern: BACKFILL_PROGRESS_PATTERN, handle: () => ({ rows: [] }) }
  ]);
  const router = createKiotVietSyncStatusRouter({ databaseUrl: 'configured', pool });
  const res = fakeRes();
  await handlerFor(router)({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.checkpoints, rows);
  const checkpointsCall = pool.calls.find((c) => CHECKPOINTS_PATTERN.test(c.sql));
  assert.match(checkpointsCall.sql, /ORDER BY branch, entity/);
});

test('status fails soft with 503 when PostgreSQL is unavailable', async () => {
  const router = createKiotVietSyncStatusRouter({ databaseUrl: 'configured', pool: { query: async () => { throw new Error('offline'); } }, logger: { error() {} } });
  const res = fakeRes();
  await handlerFor(router)({}, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'KIOTVIET_SYNC_STATUS_UNAVAILABLE');
});

test('status mo rong tra ve counts theo tung bang, mac dinh 0 cho co so khong co ban ghi', async () => {
  const pool = routedPool([
    { pattern: CHECKPOINTS_PATTERN, handle: () => ({ rows: [] }) },
    {
      pattern: COUNTS_PATTERN,
      handle: (sql) => {
        const table = COUNTS_PATTERN.exec(sql)[1];
        if (table === 'categories') return { rows: [{ branch: 'hanoi', count: 5 }, { branch: 'saigon', count: 3 }] };
        if (table === 'invoices') return { rows: [{ branch: 'hanoi', count: 100 }] };
        return { rows: [] };
      }
    },
    { pattern: SAMPLES_PATTERN, handle: () => ({ rows: [] }) },
    { pattern: BACKFILL_PROGRESS_PATTERN, handle: () => ({ rows: [] }) }
  ]);
  const router = createKiotVietSyncStatusRouter({ databaseUrl: 'configured', pool });
  const res = fakeRes();
  await handlerFor(router)({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.counts.categories, { hanoi: 5, saigon: 3 });
  assert.deepEqual(res.body.counts.invoices, { hanoi: 100, saigon: 0 });
  assert.deepEqual(res.body.counts.products, { hanoi: 0, saigon: 0 });
  assert.ok(Object.keys(res.body.counts).includes('cash_flows'));
  assert.equal(Object.keys(res.body.counts).some((table) => /_details$|_payments$/.test(table)), false, 'khong duoc dem bang con');
});

test('status mo rong tra ve samples da bo cot raw va phone, khong lo du lieu nhay cam', async () => {
  const customerRow = {
    branch: 'hanoi', id: 1, code: 'KH001', name: 'Nguyen Van A', phone: '0900000000',
    modified_date: '2026-09-14T00:00:00Z', raw: { Name: 'Nguyen Van A', ContactNumber: '0900000000' }
  };
  const pool = routedPool([
    { pattern: CHECKPOINTS_PATTERN, handle: () => ({ rows: [] }) },
    { pattern: COUNTS_PATTERN, handle: () => ({ rows: [] }) },
    {
      pattern: SAMPLES_PATTERN,
      handle: (sql, params) => {
        const table = SAMPLES_PATTERN.exec(sql)[1];
        if (table === 'customers' && params[0] === 'hanoi') return { rows: [customerRow] };
        return { rows: [] };
      }
    },
    { pattern: BACKFILL_PROGRESS_PATTERN, handle: () => ({ rows: [] }) }
  ]);
  const router = createKiotVietSyncStatusRouter({ databaseUrl: 'configured', pool });
  const res = fakeRes();
  await handlerFor(router)({}, res);
  assert.equal(res.statusCode, 200);
  const sample = res.body.samples.customers.hanoi[0];
  assert.equal(sample.name, 'Nguyen Van A');
  assert.equal('raw' in sample, false, 'khong duoc tra ve toan bo raw JSONB trong samples');
  assert.equal('phone' in sample, false, 'khong duoc tra ve SDT trong samples');
  assert.deepEqual(res.body.samples.customers.saigon, []);
});

test('status mo rong tra ve backfillProgress nhom theo branch/entity/status', async () => {
  const pool = routedPool([
    { pattern: CHECKPOINTS_PATTERN, handle: () => ({ rows: [] }) },
    { pattern: COUNTS_PATTERN, handle: () => ({ rows: [] }) },
    { pattern: SAMPLES_PATTERN, handle: () => ({ rows: [] }) },
    {
      pattern: BACKFILL_PROGRESS_PATTERN,
      handle: () => ({
        rows: [
          { branch: 'hanoi', entity: 'invoices', status: 'done', count: 8 },
          { branch: 'hanoi', entity: 'invoices', status: 'error', count: 1 },
          { branch: 'saigon', entity: 'products', status: 'running', count: 2 }
        ]
      })
    }
  ]);
  const router = createKiotVietSyncStatusRouter({ databaseUrl: 'configured', pool });
  const res = fakeRes();
  await handlerFor(router)({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.backfillProgress.hanoi.invoices, { pending: 0, running: 0, done: 8, error: 1 });
  assert.deepEqual(res.body.backfillProgress.saigon.products, { pending: 0, running: 2, done: 0, error: 0 });
});

test('status xu ly mem khi backfill_progress chua ton tai (42P01), phan con lai cua response van day du va HTTP 200', async () => {
  const rows = [{ branch: 'hanoi', entity: 'invoices', last_synced_at: 'a', last_success_at: 'b', note: null }];
  const pool = routedPool([
    { pattern: CHECKPOINTS_PATTERN, handle: () => ({ rows }) },
    { pattern: COUNTS_PATTERN, handle: () => ({ rows: [] }) },
    { pattern: SAMPLES_PATTERN, handle: () => ({ rows: [] }) },
    {
      pattern: BACKFILL_PROGRESS_PATTERN,
      handle: () => { const error = new Error('relation "backfill_progress" does not exist'); error.code = '42P01'; throw error; }
    }
  ]);
  const router = createKiotVietSyncStatusRouter({ databaseUrl: 'configured', pool, logger: { error() {} } });
  const res = fakeRes();
  await handlerFor(router)({}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.backfillProgress, null);
  assert.deepEqual(res.body.checkpoints, rows);
  assert.ok(res.body.counts && res.body.samples, 'counts/samples van phai day du du bang backfill_progress chua ton tai');
});

test('status van tra 503 (khong phai loi 42P01) neu loi Postgres khac xay ra o counts/samples', async () => {
  const pool = routedPool([
    { pattern: CHECKPOINTS_PATTERN, handle: () => ({ rows: [] }) },
    { pattern: COUNTS_PATTERN, handle: () => { throw new Error('connection terminated'); } },
    { pattern: SAMPLES_PATTERN, handle: () => ({ rows: [] }) },
    { pattern: BACKFILL_PROGRESS_PATTERN, handle: () => ({ rows: [] }) }
  ]);
  const router = createKiotVietSyncStatusRouter({ databaseUrl: 'configured', pool, logger: { error() {} } });
  const res = fakeRes();
  await handlerFor(router)({}, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'KIOTVIET_SYNC_STATUS_UNAVAILABLE');
});
