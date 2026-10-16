'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  refreshCustomerInvoiceLines, refreshCustomerInvoiceLinesIfDue, refreshCustomerInvoiceLinesIncremental,
  startCustomerInvoiceLinesSchedule, __sql__, __test__
} = require('./customerInvoiceLinesRefresh');

const NOW = new Date('2026-09-27T18:00:00Z'); // 01:00 sang 28/09 theo lich VN

function fakeClient({ deleted = 4, inserted = 9, rowCount = 65914, failOn = null } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (failOn && sql === failOn) throw new Error('boom');
      if (sql === __sql__.DELETE_STALE_SQL) return { rowCount: deleted };
      if (sql === __sql__.INSERT_MISSING_SQL) return { rowCount: inserted };
      if (sql === __sql__.UPSERT_STATE_SQL) return { rows: [{ row_count: rowCount }], rowCount: 1 };
      return { rowCount: 0 };
    },
    release: () => {}
  };
}

test('refreshCustomerInvoiceLines chay dung trinh tu trong 1 giao dich va bao so dong da doi', async () => {
  const client = fakeClient();
  const logs = [];
  const result = await refreshCustomerInvoiceLines({ connect: async () => client }, { now: () => NOW, log: m => logs.push(m) });

  assert.deepEqual(client.calls.map(c => c.sql), [
    'BEGIN',
    "SET LOCAL work_mem = '32MB'",
    'SET LOCAL enable_mergejoin = off',
    __sql__.CREATE_STAGING_SQL,
    __sql__.FILL_STAGING_SQL,
    __sql__.FILL_STAGING_RETURNS_SQL,
    __sql__.DELETE_STALE_SQL,
    __sql__.INSERT_MISSING_SQL,
    __sql__.UPSERT_STATE_SQL,
    'COMMIT'
  ]);
  assert.deepEqual(client.calls[4].params, [['hanoi', 'saigon'], '2026-06-30', '2026-09-27']);
  assert.deepEqual(client.calls[5].params, [['hanoi', 'saigon'], '2026-06-30', '2026-09-27']);
  assert.deepEqual(client.calls[8].params, ['2026-06-30', '2026-09-27']);
  assert.deepEqual(result, { window: { start: '2026-06-30', end: '2026-09-27' }, rowCount: 65914, inserted: 9, deleted: 4 });
  assert.match(logs[0], /65914/);
});

test('refreshCustomerInvoiceLines ROLLBACK, giu nguyen bang cu va nem loi neu 1 buoc that bai', async () => {
  const client = fakeClient({ failOn: __sql__.INSERT_MISSING_SQL });
  await assert.rejects(
    () => refreshCustomerInvoiceLines({ connect: async () => client }, { now: () => NOW, log: () => {} }),
    /boom/
  );
  const sqls = client.calls.map(c => c.sql);
  assert.ok(sqls.includes('ROLLBACK'));
  assert.ok(!sqls.includes('COMMIT'));
  assert.ok(!sqls.includes(__sql__.UPSERT_STATE_SQL), 'khong ghi state khi nap chua xong');
});

test('cau nap dong hang doi chieu ten khach nhu luong sheet cu va chi lay hoa don Hoan thanh', () => {
  const sql = __sql__.FILL_STAGING_SQL;
  assert.match(sql, /raw->>'statusValue'/);
  assert.match(sql, /= 'Hoàn thành'/);
  // Loc ngay so sanh thang cot goc voi TIMESTAMPTZ de dung duoc index purchase_date (0021).
  assert.match(sql, /i\.purchase_date >= \(\$2::date::timestamp AT TIME ZONE 'UTC'\)/);
  assert.match(sql, /i\.purchase_date <  \(\(\$3::date \+ 1\)::timestamp AT TIME ZONE 'UTC'\)/);
  // Ma khach tren hoa don, khong co thi ma tim theo ten chuan hoa (ten trung => ma lon nhat).
  assert.match(sql, /COALESCE\(NULLIF\(btrim\(i\.raw->>'customerCode'\), ''\), cbn\.code\)/);
  assert.match(sql, /ORDER BY branch, name_key, raw_code DESC/);
  assert.match(sql, /normalize\(/);
});

test('cau nap phieu tra: dong AM theo ngay tra, chi phieu Đã trả, id am de khong trung hoa don', () => {
  const sql = __sql__.FILL_STAGING_RETURNS_SQL;
  assert.match(sql, /r\.raw->>'statusValue' = 'Đã trả'/);
  assert.match(sql, /^\s*WITH customer_by_name AS/);
  assert.match(sql, /\n\s+-r\.id,/);
  assert.match(sql, /-abs\(COALESCE\(rd\.quantity, 0\)\)::numeric/);
  assert.match(sql, /\(r\.return_date AT TIME ZONE 'UTC'\)::date/);
  assert.match(sql, /r\.return_date >= \(\$2::date::timestamp AT TIME ZONE 'UTC'\)/);
  assert.match(sql, /-\(CASE/);
});

test('buoc xoa/chen chi dong vao dong da mat, da doi hoac moi (khong TRUNCATE + nap lai ca bang)', () => {
  assert.match(__sql__.DELETE_STALE_SQL, /^\s*DELETE FROM customer_invoice_lines_90d l\s+WHERE NOT EXISTS/);
  assert.match(__sql__.DELETE_STALE_SQL, /ROW\(n\.invoice_code/);
  assert.match(__sql__.INSERT_MISSING_SQL, /WHERE NOT EXISTS \(SELECT 1 FROM customer_invoice_lines_90d l/);
  assert.doesNotMatch(__sql__.DELETE_STALE_SQL + __sql__.INSERT_MISSING_SQL, /TRUNCATE/i);
});

test('computeWindow: 90 ngay ket thuc HOM QUA theo lich VN, khong phai ngay UTC', () => {
  // 2026-09-27T18:00Z = 01:00 ngay 28/09 VN => hom qua la 27/09.
  assert.deepEqual(__test__.computeWindow(new Date('2026-09-27T18:00:00Z')), { start: '2026-06-30', end: '2026-09-27' });
  // 2026-09-28T10:00Z = 17:00 ngay 28/09 VN => van hom qua la 27/09.
  assert.deepEqual(__test__.computeWindow(new Date('2026-09-28T10:00:00Z')), { start: '2026-06-30', end: '2026-09-27' });
  // Vuot ranh gioi nam: hom qua la 31/12.
  assert.deepEqual(__test__.computeWindow(new Date('2026-12-31T18:00:00Z')), { start: '2026-10-03', end: '2026-12-31' });
});

test('vnDateKey/vnMinutesOfDay tra ve lich va gio VN (UTC+7)', () => {
  assert.equal(__test__.vnDateKey(new Date('2026-09-27T17:30:00Z')), '2026-09-28');
  assert.equal(__test__.vnDateKey(new Date('2026-09-27T16:30:00Z')), '2026-09-27');
  assert.equal(__test__.vnMinutesOfDay(new Date('2026-09-27T17:05:00Z')), 5); // 00:05 VN
  assert.equal(__test__.vnMinutesOfDay(new Date('2026-09-28T08:30:00Z')), 15 * 60 + 30);
});

test('isRefreshDue: chua tung dung thi dung ngay, da dung hom nay thi bo qua', () => {
  assert.equal(__test__.isRefreshDue(null, new Date('2026-09-28T03:00:00Z')), true);
  // Da dung luc 00:30 VN hom nay.
  assert.equal(__test__.isRefreshDue(new Date('2026-09-27T17:30:00Z'), new Date('2026-09-28T03:00:00Z')), false);
});

test('isRefreshDue: bang cua hom qua duoc dung lai sau 10 phut dau ngay VN, khong som hon', () => {
  const lastNight = new Date('2026-09-27T17:10:00Z'); // 00:10 VN ngay 28/09
  // 00:05 VN ngay 29/09: da sang ngay moi nhung chua du thoi gian cho hoa don cuoi ngay dong bo.
  assert.equal(__test__.isRefreshDue(lastNight, new Date('2026-09-28T17:05:00Z')), false);
  // 00:10 VN ngay 29/09.
  assert.equal(__test__.isRefreshDue(lastNight, new Date('2026-09-28T17:10:00Z')), true);
  // Khoi dong lai 15:00 VN ma bang moi cu tu ngay truoc: dung bu ngay.
  assert.equal(__test__.isRefreshDue(lastNight, new Date('2026-09-29T08:00:00Z')), true);
});

test('refreshCustomerInvoiceLinesIfDue bo qua (khong mo ket noi) neu da dung hom nay', async () => {
  let connected = false;
  const pool = {
    query: async sql => {
      assert.equal(sql, __sql__.LAST_COMPUTED_SQL);
      return { rows: [{ computed_at: new Date('2026-09-27T17:30:00Z') }] };
    },
    connect: async () => { connected = true; }
  };
  const result = await refreshCustomerInvoiceLinesIfDue(pool, { now: () => new Date('2026-09-28T03:00:00Z'), log: () => {} });
  assert.deepEqual(result, { skipped: true });
  assert.equal(connected, false);
});

test('refreshCustomerInvoiceLinesIfDue dung lai khi bang chua co dong state (lan dau)', async () => {
  const client = fakeClient({ rowCount: 12 });
  const pool = { query: async () => ({ rows: [] }), connect: async () => client };
  const result = await refreshCustomerInvoiceLinesIfDue(pool, { now: () => NOW, log: () => {} });
  assert.equal(result.skipped, false);
  assert.equal(result.rowCount, 12);
});

test('startCustomerInvoiceLinesSchedule dang ky interval va kiem tra ngay 1 lan luc boot', async () => {
  let scheduledMs;
  let immediateFn;
  const client = fakeClient();
  const pool = { query: async () => ({ rows: [] }), connect: async () => client };

  const handle = startCustomerInvoiceLinesSchedule(pool, {
    intervalMs: 5000,
    setIntervalFn: (fn, ms) => { scheduledMs = ms; return 'handle-invoice-lines'; },
    scheduleImmediate: fn => { immediateFn = fn; },
    log: () => {}
  });

  assert.equal(handle, 'handle-invoice-lines');
  assert.equal(scheduledMs, 5000);
  await immediateFn();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(client.calls.some(c => c.sql === 'BEGIN'), 'phai dung ngay 1 lan luc boot khi bang chua co');
});

test('loi khi kiem tra/dung lai duoc ghi log, khong nem ra ngoai lam sap tien trinh', async () => {
  const logs = [];
  let tick;
  const pool = { query: async () => { throw new Error('db down'); } };
  startCustomerInvoiceLinesSchedule(pool, {
    setIntervalFn: fn => { tick = fn; return 'h'; },
    scheduleImmediate: () => {},
    log: m => logs.push(m)
  });
  tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(logs[0], /db down/);
});

// ===== Che do TANG DAN (REPORTS_INCREMENTAL_ENABLED) =====
const NOW_INCR = new Date('2026-10-16T05:00:00Z'); // 12:00 ngay 16/10 theo lich VN

function incrClient({ failOn = null } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (failOn && sql === failOn) throw new Error('boom');
      if (sql === __sql__.FILL_CHANGED_SQL) return { rowCount: 7 };
      if (sql === __sql__.DELETE_STALE_INCR_SQL) return { rowCount: 2 };
      if (sql === __sql__.DELETE_OUT_OF_WINDOW_SQL) return { rowCount: 5 };
      if (sql === __sql__.INSERT_MISSING_SQL) return { rowCount: 3 };
      if (sql === __sql__.UPDATE_STATE_INCR_SQL) return { rows: [{ row_count: 66000 }], rowCount: 1 };
      if (sql === __sql__.UPSERT_STATE_FULL_SQL) return { rows: [{ row_count: 66100 }], rowCount: 1 };
      return { rowCount: 0 };
    },
    release: () => {}
  };
}
function incrPool(client, state) {
  return {
    query: async sql => { assert.equal(sql, __sql__.READ_STATE_SQL); return { rows: state ? [state] : [] }; },
    connect: async () => client
  };
}

test('tang dan: tat co => khong dong vao DB', async () => {
  const pool = { query: async () => { throw new Error('khong duoc doc DB'); } };
  assert.deepEqual(await refreshCustomerInvoiceLinesIncremental(pool, { enabled: false }), { skipped: 'disabled' });
});

test('tang dan: chua chay migration 0054 (thieu cot/bang) => bo qua, giu luong chot dem', async () => {
  for (const code of ['42703', '42P01']) {
    const pool = { query: async () => { throw Object.assign(new Error('x'), { code }); } };
    assert.deepEqual(await refreshCustomerInvoiceLinesIncremental(pool, { enabled: true, now: () => NOW_INCR }), { skipped: 'migration-missing' });
  }
  const pool = { query: async () => { throw new Error('db down'); } };
  await assert.rejects(() => refreshCustomerInvoiceLinesIncremental(pool, { enabled: true, now: () => NOW_INCR }), /db down/);
});

test('tang dan: chua co last_full_at hoac bang cu hon 7 ngay => dung lai DAY DU (cua so den hom nay, danh dau last_full_at)', async () => {
  for (const state of [null, { computed_at: new Date('2026-10-15T17:10:00Z'), last_full_at: null },
    { computed_at: new Date('2026-10-01T00:00:00Z'), last_full_at: new Date('2026-10-01T00:00:00Z') }]) {
    const client = incrClient();
    const result = await refreshCustomerInvoiceLinesIncremental(incrPool(client, state), { enabled: true, now: () => NOW_INCR, log: () => {} });
    assert.equal(result.mode, 'full');
    assert.deepEqual(result.window, { start: '2026-07-19', end: '2026-10-16' });
    const sqls = client.calls.map(c => c.sql);
    assert.ok(sqls.includes(__sql__.ADVISORY_LOCK_SQL), 'tuan tu voi luot tang dan');
    assert.ok(sqls.includes(__sql__.UPSERT_STATE_FULL_SQL));
    assert.ok(!sqls.includes(__sql__.UPSERT_STATE_SQL));
  }
});

test('tang dan: chay dung trinh tu trong 1 giao dich, loc theo synced_at, cua so gom hom nay', async () => {
  const client = incrClient();
  const state = { computed_at: new Date('2026-10-16T04:50:00Z'), last_full_at: new Date('2026-10-15T17:10:00Z') };
  const logs = [];
  const result = await refreshCustomerInvoiceLinesIncremental(incrPool(client, state), { enabled: true, now: () => NOW_INCR, log: m => logs.push(m) });

  assert.deepEqual(client.calls.map(c => c.sql), [
    'BEGIN',
    __sql__.ADVISORY_LOCK_SQL,
    "SET LOCAL work_mem = '32MB'",
    'SET LOCAL enable_mergejoin = off',
    "SET LOCAL statement_timeout = '30s'",
    __sql__.CREATE_STAGING_SQL,
    __sql__.CREATE_CHANGED_SQL,
    __sql__.FILL_CHANGED_SQL,
    __sql__.FILL_STAGING_INCR_SQL,
    __sql__.FILL_STAGING_RETURNS_INCR_SQL,
    __sql__.DELETE_STALE_INCR_SQL,
    __sql__.DELETE_OUT_OF_WINDOW_SQL,
    __sql__.INSERT_MISSING_SQL,
    __sql__.UPDATE_STATE_INCR_SQL,
    'COMMIT'
  ]);
  const since = '2026-10-16T02:50:00.000Z'; // computed_at - 2 gio
  assert.deepEqual(client.calls[7].params, [['hanoi', 'saigon'], since]);
  assert.deepEqual(client.calls[8].params, [['hanoi', 'saigon'], '2026-07-19', '2026-10-16', since]);
  assert.deepEqual(client.calls[9].params, [['hanoi', 'saigon'], '2026-07-19', '2026-10-16', since]);
  assert.deepEqual(client.calls[11].params, ['2026-07-19']);
  assert.deepEqual(client.calls[13].params, ['2026-07-19', '2026-10-16']);
  assert.deepEqual(result, {
    skipped: false, mode: 'incremental', window: { start: '2026-07-19', end: '2026-10-16' }, since,
    changedDocs: 7, rowCount: 66000, inserted: 3, deleted: 2, slid: 5
  });
  assert.match(logs[0], /Tang dan/);
});

test('tang dan: loi giua chung => ROLLBACK, khong ghi state, nem loi', async () => {
  const client = incrClient({ failOn: __sql__.INSERT_MISSING_SQL });
  const state = { computed_at: new Date('2026-10-16T04:50:00Z'), last_full_at: new Date('2026-10-15T17:10:00Z') };
  await assert.rejects(
    () => refreshCustomerInvoiceLinesIncremental(incrPool(client, state), { enabled: true, now: () => NOW_INCR, log: () => {} }),
    /boom/
  );
  const sqls = client.calls.map(c => c.sql);
  assert.ok(sqls.includes('ROLLBACK'));
  assert.ok(!sqls.includes('COMMIT'));
  assert.ok(!sqls.includes(__sql__.UPDATE_STATE_INCR_SQL));
});

test('cau tang dan: loc theo synced_at (modified_date NULL o 91% hoa don), xoa gioi han trong tap chung tu doi, khong TRUNCATE', () => {
  const all = Object.values(__sql__).join('\n');
  assert.match(__sql__.FILL_STAGING_INCR_SQL, /i\.synced_at >= \$4::timestamptz/);
  assert.match(__sql__.FILL_STAGING_RETURNS_INCR_SQL, /r\.synced_at >= \$4::timestamptz/);
  assert.match(__sql__.FILL_CHANGED_SQL, /FROM invoices[\s\S]*synced_at >= \$2[\s\S]*UNION ALL[\s\S]*SELECT branch, -id FROM returns/);
  assert.doesNotMatch(all, /modified_date/);
  assert.match(__sql__.DELETE_STALE_INCR_SQL, /USING customer_invoice_changed c/);
  assert.match(__sql__.DELETE_STALE_INCR_SQL, /l\.invoice_id = c\.invoice_id/);
  assert.doesNotMatch(all, /TRUNCATE/i);
  // Ban tang dan giu nguyen moi dieu kien cua ban day du, chi them dieu kien synced_at.
  assert.equal(__sql__.FILL_STAGING_INCR_SQL.replace('AND i.synced_at >= $4::timestamptz\n    ', ''), __sql__.FILL_STAGING_SQL);
  assert.equal(__sql__.FILL_STAGING_RETURNS_INCR_SQL.replace('AND r.synced_at >= $4::timestamptz\n    ', ''), __sql__.FILL_STAGING_RETURNS_SQL);
});

test('computeWindow includeToday: 90 ngay ket thuc HOM NAY theo lich VN', () => {
  assert.deepEqual(__test__.computeWindow(new Date('2026-10-16T05:00:00Z'), { includeToday: true }), { start: '2026-07-19', end: '2026-10-16' });
  // 23:30 UTC = 06:30 ngay hom sau theo VN.
  assert.deepEqual(__test__.computeWindow(new Date('2026-10-15T23:30:00Z'), { includeToday: true }), { start: '2026-07-19', end: '2026-10-16' });
});

test('IfDue che do tang dan: chot doi soat dua vao last_full_at (computed_at bi cap nhat moi luot)', async () => {
  let connected = 0;
  const makePool = state => ({
    query: async sql => { assert.equal(sql, __sql__.READ_STATE_SQL); return { rows: state ? [state] : [] }; },
    connect: async () => { connected++; return incrClient(); }
  });
  // Da doi soat luc 00:30 VN hom nay => bo qua du computed_at moi.
  let result = await refreshCustomerInvoiceLinesIfDue(makePool({ computed_at: NOW_INCR, last_full_at: new Date('2026-10-15T17:30:00Z') }), { incremental: true, now: () => NOW_INCR, log: () => {} });
  assert.deepEqual(result, { skipped: true });
  // Doi soat gan nhat la hom qua => dung lai day du.
  result = await refreshCustomerInvoiceLinesIfDue(makePool({ computed_at: NOW_INCR, last_full_at: new Date('2026-10-14T17:30:00Z') }), { incremental: true, now: () => NOW_INCR, log: () => {} });
  assert.equal(result.skipped, false);
  // Chua co last_full_at => dung lai day du.
  result = await refreshCustomerInvoiceLinesIfDue(makePool({ computed_at: NOW_INCR, last_full_at: null }), { incremental: true, now: () => NOW_INCR, log: () => {} });
  assert.equal(result.skipped, false);
  assert.equal(connected, 2);
});

test('IfDue che do tang dan: thieu cot last_full_at (chua migrate) => quay ve luong chot dem cu', async () => {
  const pool = {
    query: async sql => {
      if (sql === __sql__.READ_STATE_SQL) throw Object.assign(new Error('no column'), { code: '42703' });
      assert.equal(sql, __sql__.LAST_COMPUTED_SQL);
      return { rows: [{ computed_at: new Date('2026-10-15T17:30:00Z') }] };
    }
  };
  assert.deepEqual(await refreshCustomerInvoiceLinesIfDue(pool, { incremental: true, now: () => NOW_INCR, log: () => {} }), { skipped: true });
});
