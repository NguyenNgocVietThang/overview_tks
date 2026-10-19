'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb, createPool } = require('./precomputeFixture');
const { refreshAdsCosts, readAdsCosts, createAdsStore, toDbRows, __test__ } = require('./marketingAdsSync');
const parsers = require('./marketingParsers');
const { createMarketingReportService } = require('./marketingReportService');

const COST_HEADERS = ['', 'Chi phí', 'Chi phí + Phí Thuê', 'SL mess', 'Chi phí /mess', 'SL SĐT', 'Chi phí /SĐT'];
// Tab Hữu Nghị + Quảng Châu: 2 khối cạnh nhau, dòng tổng tháng + dòng ngày; tab Bắc Lãm: chỉ dòng ngày có ô lỗi.
function workbook(overrides = {}) {
  return {
    'Chi Phí Hữu Nghị+Quảng Châu': [COST_HEADERS.concat(['', '', ...COST_HEADERS]),
      ['Tháng 10/26', 10, 99, 2, 49.5, 1, 99, '', '', 'Tháng 10/26', 4, 8, 1, 8, 1, 8],
      ['01/10', 10, 11, 2, 5.5, 1, 11, '', '', '01/10', 4, 8, 1, 8, 1, 8],
      ['02/10', 20.5, 23, 4, 5.75, 2, 11.5, '', '', '02/10', 5, 9, 2, 4.5, 1, 9],
      ['Tháng 9/26', 7, 70, 3, 23.3, 1, 70, '', '', 'Tháng 9/26', 1, 2, 1, 2, 1, 2]],
    'Chi phí Bắc Lãm': [['Ngày', 'Chi phí', 'Chi phí +VAT', 'SL mess', 'Chi phí /mess', 'SL SĐT', 'Chi phí /SĐT'],
      ['01/10', 10, 12, 2, 6, 1, 12], ['02/10', '#N/A', '#N/A', 3, '#N/A', 2, '#N/A']],
    'Tab khác': [['bỏ qua']],
    ...overrides
  };
}
function fakeSheets(data, counters = { titles: 0, values: 0 }) {
  return {
    counters,
    client: {
      listSheetTitles: async () => { counters.titles++; return Object.keys(data); },
      getValues: async title => { counters.values++; return data[title]; }
    }
  };
}
const silent = { info() {}, error() {} };
const NOW = Date.UTC(2026, 9, 8, 3);

async function setup(t, data = workbook()) {
  const db = await createDb();
  t.after(() => db.close());
  const pool = createPool(db);
  const sheets = fakeSheets(data);
  const refresh = (options = {}) => refreshAdsCosts({ pool, client: sheets.client, now: () => new Date(NOW), logger: silent, intervalMs: 1800000, ...options });
  return { db, pool, sheets, refresh };
}
const strip = ({ snapshotId, ...rest }) => rest;

test('migration 0069 tao bang ADS va tks_name_key chay duoc', async t => {
  const { db } = await setup(t);
  const { rows } = await db.query(`SELECT to_regclass('marketing_ads_costs') AS a, to_regclass('marketing_phone_summary') AS p,
    to_regclass('v_marketing_customer_revenue') AS v, tks_name_key('  A  b ') AS k`);
  assert.deepEqual(rows[0], { a: 'marketing_ads_costs', p: 'marketing_phone_summary', v: 'v_marketing_customer_revenue', k: 'a b' });
});

test('job ghi dung so dong, lan 2 khong doi gi thi 0 dong ghi va version giu nguyen', async t => {
  const { db, refresh, sheets } = await setup(t);
  const first = await refresh();
  assert.equal(first.status, 'updated');
  const expected = toDbRows([parsers.parseCosts(workbook()['Chi Phí Hữu Nghị+Quảng Châu'], 'Chi Phí Hữu Nghị+Quảng Châu'),
    parsers.parseCosts(workbook()['Chi phí Bắc Lãm'], 'Chi phí Bắc Lãm')]).length;
  assert.equal(first.rowCount, expected);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM marketing_ads_costs')).rows[0].n, expected);
  const v1 = (await db.query('SELECT version::int AS v, row_count FROM marketing_ads_sync_state')).rows[0];
  const second = await refresh({ force: true });
  assert.equal(second.status, 'unchanged');
  assert.equal(second.written, 0);
  assert.equal(second.deleted, 0);
  assert.equal((await db.query('SELECT version::int AS v FROM marketing_ads_sync_state')).rows[0].v, v1.v);
  assert.ok(sheets.counters.values >= 4);
});

test('cong chua den han: lan doc ke tiep trong chu ky khong goi Sheets', async t => {
  const { sheets, refresh } = await setup(t);
  await refresh();
  const reads = sheets.counters.values;
  const again = await refresh();
  assert.equal(again.status, 'not-due');
  assert.equal(sheets.counters.values, reads);
});

test('o doi thi chi dong do duoc ghi; dong bien mat bi xoa', async t => {
  const data = workbook();
  const { db, refresh, sheets } = await setup(t, data);
  await refresh();
  data['Chi phí Bắc Lãm'][1][1] = 11; // 01/10 adCost 10 -> 11
  const changed = await refresh({ force: true });
  assert.equal(changed.status, 'updated');
  assert.equal(changed.written, 1);
  assert.equal((await db.query(`SELECT ad_cost::float8 AS v FROM marketing_ads_costs WHERE sheet = 'Chi phí Bắc Lãm' AND date_text = '01/10'`)).rows[0].v, 11);
  data['Chi phí Bắc Lãm'].pop(); // mat 1/5 dong => khong tut qua guard 70%
  const removed = await refresh({ force: true });
  assert.equal(removed.deleted, 1);
  assert.ok(sheets.counters.titles > 0);
});

test('so dong tut manh bi giu mot luot roi moi chap nhan', async t => {
  const data = workbook();
  const { db, refresh } = await setup(t, data);
  await refresh();
  const before = (await db.query('SELECT count(*)::int AS n FROM marketing_ads_costs')).rows[0].n;
  data['Chi Phí Hữu Nghị+Quảng Châu'] = [COST_HEADERS.concat(['', '', ...COST_HEADERS])];
  data['Chi phí Bắc Lãm'] = [data['Chi phí Bắc Lãm'][0]];
  const held = await refresh({ force: true });
  assert.equal(held.status, 'held');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM marketing_ads_costs')).rows[0].n, before);
  assert.match((await db.query('SELECT last_error FROM marketing_ads_sync_state')).rows[0].last_error, /giảm mạnh/);
  const accepted = await refresh({ force: true });
  assert.equal(accepted.status, 'updated');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM marketing_ads_costs')).rows[0].n, 0);
  __test__.pendingShrink.fingerprint = null;
});

test('loi Google/migration khong nem ra ngoai va giu ban thanh cong gan nhat', async t => {
  const { db, refresh } = await setup(t);
  await refresh();
  const broken = { listSheetTitles: async () => { throw new Error('secret upstream credential'); }, getValues: async () => [] };
  const errors = [];
  const result = await refreshAdsCosts({ pool: createPool(db), client: broken, now: () => new Date(NOW + 3600000), logger: { info() {}, error: (...a) => errors.push(JSON.stringify(a)) }, intervalMs: 1800000 });
  assert.equal(result.status, 'failed');
  assert.ok(!errors.join().includes('secret'));
  assert.ok((await db.query('SELECT count(*)::int AS n FROM marketing_ads_costs')).rows[0].n > 0);
  assert.ok(!(await db.query('SELECT last_error FROM marketing_ads_sync_state')).rows[0].last_error.includes('secret'));
  // Thieu bang hoan toan (chua migrate): cung khong nem.
  const bare = await createDb({ precompute: false });
  t.after(() => bare.close());
  const missing = await refreshAdsCosts({ pool: createPool(bare), client: fakeSheets(workbook()).client, now: () => new Date(NOW), logger: silent });
  assert.equal(missing.status, 'failed');
});

test('bao cao chi phi tu bang == bao cao doc Sheets, va dung 0 lan goi Sheets', async t => {
  const { pool, refresh, sheets: seed } = await setup(t);
  await refresh();
  const direct = fakeSheets(workbook());
  const viaSheets = createMarketingReportService({ source: 'sheets', clients: { ads: direct.client }, now: () => NOW });
  const idle = fakeSheets(workbook());
  const viaTable = createMarketingReportService({ source: 'sheets', clients: { ads: idle.client }, now: () => NOW, adsStore: createAdsStore({ pool, now: () => NOW }) });
  for (const query of [{ month: '10' }, { month: '9' }, { month: '10', page: 'Bắc Lãm' }, { month: '11' }]) {
    const expected = strip(await viaSheets.report('costs', query));
    const actual = strip(await viaTable.report('costs', query));
    assert.deepEqual(actual, expected, JSON.stringify(query));
  }
  assert.equal(idle.counters.titles + idle.counters.values, 0, 'khong duoc doc Sheets khi bang ADS da co du lieu');
  assert.ok(direct.counters.values > 0);
  assert.ok(seed.counters.values > 0);
  // Chi tiet cung khop (reconciliation, nhom dong ngay).
  const a = await viaSheets.report('costs', { month: '10' });
  const b = await viaTable.report('costs', { month: '10' });
  const key = a.summaryRows[0].key;
  assert.deepEqual(strip(await viaTable.detail({ kind: 'costs', key, snapshotId: b.snapshotId })), strip(await viaSheets.detail({ kind: 'costs', key, snapshotId: a.snapshotId })));
  assert.equal(idle.counters.titles + idle.counters.values, 0);
});

test('thieu bang / chua dong bo / qua cu / bang rong => lui ve Sheets', async t => {
  const data = workbook();
  const expected = strip(await createMarketingReportService({ source: 'sheets', clients: { ads: fakeSheets(data).client }, now: () => NOW }).report('costs', { month: '10' }));
  const make = (pool, extra = {}) => {
    const sheets = fakeSheets(data);
    return { sheets, svc: createMarketingReportService({ source: 'sheets', clients: { ads: sheets.client }, now: () => NOW, adsStore: createAdsStore({ pool, now: () => NOW, ...extra }) }) };
  };
  // 1. chua migrate
  const bare = await createDb({ precompute: false });
  t.after(() => bare.close());
  let { sheets, svc } = make(createPool(bare));
  assert.deepEqual(strip(await svc.report('costs', { month: '10' })), expected);
  assert.ok(sheets.counters.values > 0);
  // 2. co bang nhung chua dong bo
  const { db, pool, refresh } = await setup(t, data);
  ({ sheets, svc } = make(pool));
  assert.deepEqual(strip(await svc.report('costs', { month: '10' })), expected);
  assert.ok(sheets.counters.values > 0);
  // 3. da dong bo => dung bang; sau do qua cu (maxAge) => lai Sheets
  await refresh();
  assert.ok(await readAdsCosts({ pool, month: 10, now: () => NOW }));
  assert.equal(await readAdsCosts({ pool, month: 10, now: () => NOW + 4 * 3600000 }), null);
  // 4. dong bo thanh cong nhung workbook khong co dong nao => bang rong => Sheets
  await db.query('DELETE FROM marketing_ads_costs');
  await db.query('UPDATE marketing_ads_sync_state SET row_count = 0');
  assert.equal(await readAdsCosts({ pool, month: 10, now: () => NOW }), null);
});

test('lich ADS: chay ngay, hen lai theo nextAttemptAt, dung duoc, tat khi khong co spreadsheet', async () => {
  const { startAdsSchedule } = require('./marketingAdsSync');
  const timers = [];
  let calls = 0;
  const schedule = startAdsSchedule({
    refresh: async () => { calls++; return { status: 'unchanged', nextAttemptAt: 5000 + 1800000 }; },
    enabled: () => true, now: () => 5000, logger: silent,
    setTimeoutFn: (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; }, clearTimeoutFn() {}
  });
  await schedule.ready;
  assert.equal(calls, 1);
  assert.equal(timers.at(-1).ms, 1800000);
  schedule.stop();
  const off = startAdsSchedule({ refresh: async () => { calls++; return {}; }, enabled: () => false, logger: silent });
  await off.ready;
  assert.equal(calls, 1);
  off.stop();
});

test('lich Pancake mac dinh tu them job ADS khi chay that, nhung khong khi test inject sync', async () => {
  const { createPancakeScheduler } = require('./pancakeScheduler');
  const events = [];
  const withAds = createPancakeScheduler({
    enabled: true, sync: { run: async () => {} }, ads: { start: () => events.push('ads-start'), stop: () => events.push('ads-stop') },
    setTimeoutFn: () => ({ unref() {} }), clearTimeoutFn() {}, logger: silent
  });
  await withAds.start();
  withAds.stop();
  assert.deepEqual(events, ['ads-start', 'ads-stop']);
});
