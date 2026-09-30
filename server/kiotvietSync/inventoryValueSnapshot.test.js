'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  takeInventoryValueSnapshot, takeInventoryValueSnapshotIfDue, startInventoryValueSnapshotSchedule, __sql__, __test__
} = require('./inventoryValueSnapshot');

const { snapshotDateDue } = __test__;

// Gio VN = UTC + 7.
const AT_2358 = new Date('2026-09-30T16:58:00Z'); // 23:58 ngay 30/09
const AT_2359 = new Date('2026-09-30T16:59:00Z'); // 23:59 ngay 30/09
const AT_0005 = new Date('2026-09-30T17:05:00Z'); // 00:05 ngay 01/10
const AT_1159 = new Date('2026-10-01T04:59:00Z'); // 11:59 ngay 01/10
const AT_1300 = new Date('2026-10-01T06:00:00Z'); // 13:00 ngay 01/10

test('23:58 chua den han, 23:59 thi chup cho hom nay', () => {
  assert.equal(snapshotDateDue('2026-09-29', AT_2358), null);
  assert.equal(snapshotDateDue('2026-09-29', AT_2359), '2026-09-30');
});

test('da co ban chup hom nay thi khong chup lai', () => {
  assert.equal(snapshotDateDue('2026-09-30', AT_2359), null);
  assert.equal(snapshotDateDue('2026-09-30', AT_0005), null);
});

test('bang rong: chi chup luc 23:59, khong chup bu ngay truoc', () => {
  assert.equal(snapshotDateDue(null, AT_2358), null);
  assert.equal(snapshotDateDue(null, AT_2359), '2026-09-30');
  assert.equal(snapshotDateDue(null, AT_0005), null);
  assert.equal(snapshotDateDue(null, AT_1159), null);
});

test('lo 23:59 (bang da co du lieu): chup bu cho HOM QUA truoc 12:00, sau do de trong', () => {
  assert.equal(snapshotDateDue('2026-09-29', AT_0005), '2026-09-30');
  assert.equal(snapshotDateDue('2026-09-29', AT_1159), '2026-09-30');
  assert.equal(snapshotDateDue('2026-09-29', AT_1300), null);
});

test('da co ban chup hom qua thi khong bu them sang hom sau', () => {
  assert.equal(snapshotDateDue('2026-09-30', AT_0005), null);
});

test('cong thuc SQL khop KPI tab Hang hoa: clamp ton/gia von >= 0, bo hang ngung KD va ma VAT, ON CONFLICT DO NOTHING', () => {
  const sql = __sql__.SNAPSHOT_SQL;
  assert.match(sql, /GREATEST\(p\.on_hand, 0\) \* GREATEST\(COALESCE\(p\.cost, 0\), 0\)/);
  assert.match(sql, /jsonb_array_elements\(COALESCE\(raw->'inventories'/);
  assert.match(sql, /is_active IS NOT FALSE/);
  assert.match(sql, /upper\(btrim\(code\)\) NOT LIKE 'VAT%'/);
  assert.match(sql, /branch = ANY\(\$2::text\[\]\)/);
  assert.match(sql, /GROUP BY p\.branch/);
  assert.match(sql, /ON CONFLICT \(snapshot_date, branch\) DO NOTHING/);
});

function fakePool({ lastDate = null, rowCount = 2 } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql === __sql__.LAST_SNAPSHOT_SQL) return { rows: [{ last_date: lastDate }] };
      return { rowCount };
    }
  };
}

test('takeInventoryValueSnapshot chen cho ngay chi dinh, ca 2 co so, va bao so dong', async () => {
  const pool = fakePool({ rowCount: 2 });
  const logs = [];
  const result = await takeInventoryValueSnapshot(pool, '2026-09-30', { log: m => logs.push(m) });
  assert.deepEqual(result, { snapshotDate: '2026-09-30', inserted: 2 });
  assert.deepEqual(pool.calls[0].params, ['2026-09-30', ['hanoi', 'saigon']]);
  assert.match(logs[0], /2026-09-30/);
});

test('takeInventoryValueSnapshotIfDue bo qua (chi 1 SELECT) khi chua den han', async () => {
  const pool = fakePool({ lastDate: '2026-09-29' });
  const result = await takeInventoryValueSnapshotIfDue(pool, { now: () => AT_2358, log: () => {} });
  assert.deepEqual(result, { skipped: true });
  assert.equal(pool.calls.length, 1);
});

test('takeInventoryValueSnapshotIfDue chup dung ngay khi den han (ke ca chup bu)', async () => {
  const onTime = fakePool({ lastDate: '2026-09-29' });
  const first = await takeInventoryValueSnapshotIfDue(onTime, { now: () => AT_2359, log: () => {} });
  assert.equal(first.skipped, false);
  assert.equal(onTime.calls[1].params[0], '2026-09-30');

  const late = fakePool({ lastDate: '2026-09-29' });
  const second = await takeInventoryValueSnapshotIfDue(late, { now: () => AT_0005, log: () => {} });
  assert.equal(second.snapshotDate, '2026-09-30');
});

test('startInventoryValueSnapshotSchedule chay 1 lan luc khoi dong va dat timer theo intervalMs; loi chi duoc ghi log', async () => {
  const pool = { query: async () => { throw new Error('db down'); } };
  const immediate = [];
  const timers = [];
  const logs = [];
  const handle = startInventoryValueSnapshotSchedule(pool, {
    intervalMs: 60000,
    setIntervalFn: (fn, ms) => (timers.push({ fn, ms }), 'timer'),
    scheduleImmediate: fn => immediate.push(fn),
    log: m => logs.push(m)
  });
  assert.equal(handle, 'timer');
  assert.equal(timers[0].ms, 60000);
  assert.equal(immediate.length, 1);
  immediate[0]();
  timers[0].fn();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(logs.length, 2);
  assert.match(logs[0], /db down/);
});
