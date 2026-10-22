'use strict';

// Scheduler 23:00 VN cua "Kiem tra gia ban": dong ho gia, runDaily gia (va 1 test tich hop PGlite).

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPriceAuditScheduler } = require('./priceAuditScheduler');
const { HN_NOTE, newDb, product, customer, invoice, pgliteAsPool } = require('./priceAuditFixtures');

const MIN = 60_000;
const quiet = { error() {}, info() {}, warn() {}, log() {} };

function harness({ start, results = {}, enabled = true, runDaily } = {}) {
  let clock = +new Date(start);
  const calls = [];
  const timers = [];
  let cleared = 0;
  const scheduler = createPriceAuditScheduler({
    enabled,
    pool: { tag: 'pool' },
    now: () => new Date(clock),
    logger: quiet,
    runDaily: runDaily || (async ({ day, pool, now }) => {
      calls.push({ day, now: now.toISOString(), pool: pool.tag });
      const queue = results[day];
      const next = Array.isArray(queue) && queue.length ? queue.shift() : 'completed';
      if (next instanceof Error) throw next;
      return { status: next, day };
    }),
    setIntervalFn(fn, ms) {
      const t = { fn, ms, unrefCalled: false, unref() { this.unrefCalled = true; return this; } };
      timers.push(t);
      return t;
    },
    clearIntervalFn() { cleared += 1; }
  });
  return {
    scheduler, calls, timers,
    get cleared() { return cleared; },
    advance(ms) { clock += ms; },
    // Mo phong 1 nhip interval (tick tra Promise).
    tick() { return scheduler.tick(); }
  };
}
const days = h => h.calls.map(c => c.day);

test('22:59 VN chay slot hom qua (da xong), 23:00 VN chay slot hom nay; slot da xong khong goi lai moi phut', async () => {
  const h = harness({ start: '2026-10-20T15:59:00Z', results: { '2026-10-19': ['already-completed'] } });
  await h.scheduler.start();
  assert.deepEqual(days(h), ['2026-10-19']);
  h.advance(MIN); await h.tick();               // 23:00 VN
  assert.deepEqual(days(h), ['2026-10-19', '2026-10-20']);
  assert.equal(h.calls[1].now, '2026-10-20T16:00:00.000Z');
  assert.equal(h.calls[1].pool, 'pool');
  for (let i = 0; i < 30; i++) { h.advance(MIN); await h.tick(); }
  assert.deepEqual(days(h), ['2026-10-19', '2026-10-20']);
  // Qua nua dem VN van la slot 20/10 cho toi 23:00 ngay 21.
  h.advance(3 * 3600 * 1000); await h.tick();
  assert.equal(days(h).length, 2);
  h.advance(21 * 3600 * 1000); await h.tick();  // 23:30 VN ngay 21
  assert.deepEqual(days(h), ['2026-10-19', '2026-10-20', '2026-10-21']);
});

test('Loi: cho 5 phut roi thu lai CUNG slot; thanh cong thi dung; nem loi cung tinh la loi', async () => {
  const h = harness({ start: '2026-10-20T16:00:00Z', results: { '2026-10-20': ['failed', new Error('boom'), 'completed'] } });
  await h.scheduler.start();
  assert.equal(h.calls.length, 1);
  for (let i = 0; i < 4; i++) { h.advance(MIN); await h.tick(); }
  assert.equal(h.calls.length, 1);              // 23:04 VN chua thu lai
  h.advance(MIN); await h.tick();               // 23:05
  assert.equal(h.calls.length, 2);
  for (let i = 0; i < 4; i++) { h.advance(MIN); await h.tick(); }
  assert.equal(h.calls.length, 2);
  h.advance(MIN); await h.tick();               // 23:10
  assert.equal(h.calls.length, 3);
  for (let i = 0; i < 10; i++) { h.advance(MIN); await h.tick(); }
  assert.deepEqual(days(h), ['2026-10-20', '2026-10-20', '2026-10-20']);
});

test('Loi keo qua nua dem: van thu lai slot 20/10 (khong bo qua, khong dung lai ngay cu hon)', async () => {
  const h = harness({ start: '2026-10-20T16:58:00Z', results: { '2026-10-20': ['failed', 'completed'] } });
  await h.scheduler.start();
  h.advance(5 * MIN); await h.tick();            // 00:03 VN ngay 21
  assert.deepEqual(days(h), ['2026-10-20', '2026-10-20']);
});

test('Busy (instance khac dang chay): thu lai o phut ke tiep, khong cho 5 phut', async () => {
  const h = harness({ start: '2026-10-20T16:00:00Z', results: { '2026-10-20': ['busy', 'already-completed'] } });
  await h.scheduler.start();
  h.advance(MIN); await h.tick();
  assert.equal(h.calls.length, 2);
  h.advance(MIN); await h.tick();
  assert.equal(h.calls.length, 2);
});

test('Bat kip sau restart: khoi dong 08:00 VN 21/10 chay 20/10 dung 1 lan, khong dung cac ngay cu', async () => {
  const h = harness({ start: '2026-10-21T01:00:00Z' });
  await h.scheduler.start();
  for (let i = 0; i < 60; i++) { h.advance(MIN); await h.tick(); }
  assert.deepEqual(days(h), ['2026-10-20']);
});

test('Khong chay chong trong 1 tien trinh: tick khi lan truoc chua xong thi bo qua', async () => {
  let finish;
  const calls = [];
  const h = harness({ start: '2026-10-20T16:00:00Z', runDaily: ({ day }) => {
    calls.push(day);
    return new Promise(resolve => { finish = () => resolve({ status: 'completed' }); });
  } });
  const first = h.scheduler.start();
  await h.tick();
  await h.tick();
  assert.equal(calls.length, 1);
  finish();
  await first;
  await h.tick();
  assert.equal(calls.length, 1);
});

test('enabled=false: start khong tao timer, khong chay; stop/unref', async () => {
  const off = harness({ start: '2026-10-20T16:00:00Z', enabled: false });
  await off.scheduler.start();
  assert.equal(off.timers.length, 0);
  assert.equal(off.calls.length, 0);
  off.scheduler.stop();

  const on = harness({ start: '2026-10-20T16:00:00Z' });
  await on.scheduler.start();
  await on.scheduler.start(); // goi lai khong tao timer thu 2
  assert.equal(on.timers.length, 1);
  assert.equal(on.timers[0].ms, MIN);
  assert.equal(on.timers[0].unrefCalled, true);
  on.scheduler.stop();
  assert.equal(on.cleared, 1);
  on.advance(24 * 3600 * 1000);
  await on.tick();
  assert.equal(on.calls.length, 1); // da stop: tick khong chay nua
});

test('Tich hop PGlite: restart 08:00 VN 21/10 khi 20/10 chua cong bo -> cong bo 20/10 dung 1 lan, restart lan 2 khong chay lai', async () => {
  const db = await newDb();
  try {
    await product(db, 'hanoi', 1, 'T100', 'Ly', HN_NOTE);
    await customer(db, 'hanoi', 1, 'K', {});
    for (const [i, d] of ['2026-10-19', '2026-10-20'].entries()) {
      await invoice(db, { id: i + 1, purchaseDate: `${d} 10:00:00+00`, customerId: 1,
        lines: [{ productId: 1, code: 'T100', name: 'Ly', qty: 1, price: 1 }] });
    }
    const pool = pgliteAsPool(db);
    const make = () => createPriceAuditScheduler({ enabled: true, pool, logger: quiet,
      now: () => new Date('2026-10-21T01:00:00Z'), setIntervalFn: () => ({ unref() {} }), clearIntervalFn() {} });
    const first = make();
    await first.start();
    await first.tick();
    first.stop();
    const second = make();
    await second.start();
    second.stop();
    const { rows } = await db.query(`SELECT published_day::text AS d, version FROM invoice_price_audit_state`);
    assert.deepEqual(rows, [{ d: '2026-10-20', version: 1 }]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM invoice_price_audit_lines')).rows[0].n, 2);
  } finally { await db.close(); }
});
