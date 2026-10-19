'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb, createPool } = require('./precomputeFixture');
const { createMarketingRepository, PAGE_IDS } = require('./marketingRepository');
const { createPancakeSync } = require('./pancakeSync');
const { createDatabaseMarketingReportService } = require('./marketingDatabaseReportService');
const { aggregateIndependentPhones, phonesFromSummary } = require('./marketingAggregation');
const { refreshPhoneSummary } = require('./marketingSummaryRefresh');

const [P0, P1] = PAGE_IDS;
const silent = { info() {}, error() {} };
const NOW = Date.parse('2026-10-12T05:00:00Z');
const actor = { userId: '1', username: 'u', name: 'U' };

const msg = (sourceKey, phone, employeeRaw, sourceCreatedAt) => ({
  sourceKey, messageId: sourceKey, conversationId: `c-${sourceKey}`, type: 'INBOX', phone, phoneKey: phone, employeeRaw, sourceCreatedAt, raw: { message: { id: sourceKey } }
});
// Moi luot dong bo = 1 ngay (slotDate) voi cac tin page nhan duoc luc do.
const RUNS = [
  { slot: '2026-10-07', now: '2026-10-07T10:00:00Z', rows: {
    [P0]: [msg('m1', '0911000001', 'Alias A', '2026-10-01T03:00:00.000Z'), msg('m2', '0911000002', 'Unmapped X', '2026-10-02T03:00:00.000Z'),
      msg('m3', '0911000003', '', '2026-10-03T03:00:00.000Z'), msg('m4', '0911000004', 'Alias A', '2026-09-29T03:00:00.000Z'),
      msg('m5a', '0911000005', 'Alias A', '2026-10-02T04:00:00.000Z'), msg('m5b', '0911000005', 'B raw', '2026-10-04T04:00:00.000Z')],
    [P1]: [msg('m1', '0911000001', 'Alias A', '2026-09-28T03:00:00.000Z'), msg('m6', '0911000006', 'Alias A, B raw', '2026-10-06T03:00:00.000Z')] } },
  { slot: '2026-10-08', now: '2026-10-08T10:00:00Z', rows: {
    [P0]: [msg('m1', '0911000001', 'B raw', '2026-10-01T03:00:00.000Z'), msg('m2', '0911000002', 'Unmapped X', '2026-10-02T03:00:00.000Z'),
      msg('m3', '0911000003', 'C raw', '2026-10-03T03:00:00.000Z'), msg('m4', '0911000004', 'B raw', '2026-09-29T03:00:00.000Z'),
      msg('m5a', '0911000005', 'Alias A', '2026-10-02T04:00:00.000Z'), msg('m5b', '0911000005', 'B raw', '2026-10-04T04:00:00.000Z')],
    [P1]: [msg('m1', '0911000001', 'Alias A', '2026-09-28T03:00:00.000Z'), msg('m6', '0911000006', 'Alias A, B raw', '2026-10-06T03:00:00.000Z')] } },
  { slot: '2026-10-09', now: '2026-10-08T12:00:00Z', rows: {
    [P0]: [msg('m1', '0911000001', 'B raw', '2026-10-01T03:00:00.000Z'), msg('m4', '0911000004', 'Alias A', '2026-09-29T03:00:00.000Z')] } }
];

function fakeClient(state) {
  return {
    fetchPage: async (pageId, options) => {
      const rows = [...(state.run.rows[pageId] || [])];
      Object.defineProperty(rows, 'coverage', { value: { complete: true, since: 0, until: options.until, paginationExhausted: true } });
      return rows;
    }
  };
}

async function build(t, { runs = RUNS, precompute = true } = {}) {
  const db = await createDb({ precompute });
  t.after(() => db.close());
  const pool = createPool(db);
  const repository = createMarketingRepository({ pool, logger: silent });
  let busy = false;
  const lock = { async acquire() { if (busy) return null; busy = true; return { listRunningRunIds: async () => [], release: async () => { busy = false; } }; } };
  const state = { run: null };
  let current = new Date(NOW);
  const sync = createPancakeSync({ repository, lock, client: fakeClient(state), independent: true, now: () => current });
  const runOne = async run => { state.run = run; current = new Date(run.now); const result = await sync.run({ slotDate: run.slot }); assert.equal(result.status, 'success'); };
  for (const run of runs) await runOne(run);
  await repository.upsertAlias({ rawName: 'Alias A', reportEmployee: 'Sale1' }, actor);
  await repository.upsertAlias({ rawName: 'B raw', reportEmployee: 'Sale2' }, actor);
  await repository.upsertAlias({ rawName: 'C raw', reportEmployee: 'Sale2' }, actor);
  await repository.createMonthlyRow({ reportYear: 2026, reportMonth: 10, sale: 'Sale1', customer: 'KH1', customerDirectoryId: 'hanoi:KH1', phone: '0911', pageId: P0, page: 'Hữu Nghị', status: 'Chốt', dataSource: 'Mới', closedAt: '2026-10-04', newCustomer: '', note: '' }, actor);
  await repository.createMonthlyRow({ reportYear: 2026, reportMonth: 10, sale: 'Sale2', customer: 'KH2', customerDirectoryId: 'hanoi:KH2', phone: '0912', pageId: P1, page: 'Tân Thanh', status: 'Chốt', dataSource: 'Mới', closedAt: '2026-10-05', newCustomer: '', note: '' }, actor);
  return { db, pool, repository, sync, runOne, state };
}

// Service doc qua bang gop (khong duoc doc quan sat); service doc duong cu (an readIndependentSummary) de doi chieu.
function services(repository, revenue = async () => ({ available: true, revenueOf: name => (name === 'KH1' ? 1000 : null) })) {
  const calls = { snapshot: 0, summary: 0 };
  const counted = {
    ...repository,
    readIndependentSnapshot: async (...args) => { calls.snapshot++; return repository.readIndependentSnapshot(...args); },
    readIndependentSummary: async (...args) => { calls.summary++; return repository.readIndependentSummary(...args); }
  };
  const legacyPath = { ...repository, readIndependentSummary: undefined, readIndependentLite: undefined };
  const make = repo => createDatabaseMarketingReportService({ independent: true, repository: repo, legacy: {}, revenue, now: () => NOW });
  return { fast: make(counted), old: make(legacyPath), calls };
}
const strip = value => JSON.parse(JSON.stringify(value, (key, v) => (key === 'snapshotId' ? undefined : v)));

test('sau luot dong bo bang gop duoc dung va co 1 dong / (page, SDT)', async t => {
  const { db, repository } = await build(t);
  const state = (await db.query('SELECT * FROM marketing_phone_summary_state')).rows[0];
  assert.equal(state.phone_count, 7); // P0: A1..A5, P1: A1 (rieng page) + A6
  const count = (await db.query('SELECT count(*)::int AS n FROM marketing_phone_summary')).rows[0].n;
  assert.equal(count, state.phone_count);
  const max = (await db.query('SELECT max(source_order)::text AS m FROM marketing_pancake_independent_observations')).rows[0].m;
  assert.equal(String(state.max_source_order), String(max));
  assert.ok(state.periods.includes('2026-10'));
  assert.ok(state.employee_raws.includes('Unmapped X'));
  assert.ok(await repository.readIndependentSummary({ scope: 'none' }));
});

test('phonesFromSummary == aggregateIndependentPhones (moi truong, co alias va khong alias)', async t => {
  const { repository } = await build(t);
  const snap = await repository.readIndependentSnapshot({ includeRaw: false });
  const summary = await repository.readIndependentSummary({ scope: 'all' });
  const drop = ({ firstRow, lastRow, ...rest }) => rest;
  for (const aliases of [[], snap.aliases]) {
    const expected = aggregateIndependentPhones(snap.rawRows, aliases).map(drop);
    const actual = phonesFromSummary(summary.summary.rows, aliases).map(drop);
    assert.deepEqual(actual, expected);
  }
});

test('bao cao tu bang gop == duong gop JS cu: monthly, receipt-check, phones (moi bo loc), khong doc quan sat', async t => {
  const { repository } = await build(t);
  const { fast, old, calls } = services(repository);
  const cases = [['monthly', { year: 2026, month: 10 }], ['monthly', { year: 2026, month: 9 }], ['receipt-check', { year: 2026, month: 10 }],
    ['receipt-check', { year: 2026, month: 9 }], ['receipt-check', { year: 2026, month: 11 }], ['receipt-check', { year: 2026, month: 10, page: 'Hữu Nghị' }],
    ['receipt-check', { year: 2026, month: 10, employee: 'Sale2' }], ['phones', {}], ['phones', { page: 'Hữu Nghị' }], ['phones', { employee: 'Sale1' }]];
  for (const [kind, query] of cases) {
    assert.deepEqual(strip(await fast.report(kind, query)), strip(await old.report(kind, query)), `${kind} ${JSON.stringify(query)}`);
  }
  assert.equal(calls.snapshot, 0, 'khong duoc keo toan bo quan sat khi bang gop dung duoc');
  const check = await fast.report('receipt-check', { year: 2026, month: 10 });
  assert.ok(check.rows.some(r => r.repeat > 0) && check.rows.some(r => r.first > 0) && check.rows.some(r => r.closed > 0), 'fixture phai co ca lan dau, chao lai va khach chot');
  assert.ok(calls.summary >= cases.length);
  assert.deepEqual(strip(await fast.metadata()), strip(await old.metadata()));
  assert.deepEqual(await fast.aliases(), await old.aliases());
  assert.deepEqual(strip(await fast.syncStatus()), strip(await old.syncStatus()));
  assert.equal(calls.snapshot, 0);
});

test('chi tiet (hop SDT / Check ty le) tu bang gop == duong cu, ke ca lich su quan sat theo source_order', async t => {
  const { repository } = await build(t);
  const { fast, old, calls } = services(repository);
  for (const [kind, query] of [['receipt-check', { year: 2026, month: 10 }], ['phones', {}]]) {
    const a = await fast.report(kind, query);
    const b = await old.report(kind, query);
    const keysOf = r => [...r.summaryRows, ...r.rows].map(x => x.key);
    assert.deepEqual(keysOf(a), keysOf(b));
    for (const key of keysOf(a)) {
      const detailFast = await fast.detail({ kind, key, snapshotId: a.snapshotId });
      const detailOld = await old.detail({ kind, key, snapshotId: b.snapshotId });
      assert.deepEqual(strip(detailFast), strip(detailOld), `${kind} ${key}`);
    }
  }
  // Co it nhat mot hop chi tiet that su co dong "Lich su nhan vien va ngay nguon".
  const phones = await fast.report('phones', {});
  const detail = await fast.detail({ kind: 'phones', key: phones.rows[0].key, snapshotId: phones.snapshotId });
  assert.ok(detail.groups.find(g => g.kind === 'phone-source').rows.length >= 1);
  assert.equal(calls.snapshot, 0);
});

test('canh bao "thieu nhan vien / ngay / anh xa" khop duong cu (SQL EXISTS == phones.some(unresolved))', async t => {
  const { repository } = await build(t);
  const { fast, old } = services(repository);
  const warns = r => r.warnings.filter(w => w.includes('thiếu nhân viên'));
  assert.equal(warns(await fast.report('monthly', { year: 2026, month: 10 })).length, 1);
  assert.deepEqual(warns(await fast.report('monthly', { year: 2026, month: 10 })), warns(await old.report('monthly', { year: 2026, month: 10 })));
  // Anh xa het moi ten => het canh bao o ca hai duong.
  for (const name of ['Unmapped X', 'Alias A, B raw']) await repository.upsertAlias({ rawName: name, reportEmployee: 'Sale1' }, actor);
  assert.equal(warns(await fast.report('monthly', { year: 2026, month: 10 })).length, 1, 'SDT A3 co nhan vien lan dau de trong nen canh bao con');
  const direct = await repository.readIndependentSummary({ scope: 'all' });
  const expected = phonesFromSummary(direct.summary.rows, direct.aliases).some(r => Object.values(r.unresolved).some(Boolean));
  assert.equal(direct.summary.unresolvedAny, expected);
});

test('job gop ghi KHAC BIET: chay lai khong doi gi => 0 dong ghi; them 1 quan sat => ghi dung 1 dong', async t => {
  const { db, repository, runOne } = await build(t);
  const version1 = Number((await db.query('SELECT version FROM marketing_phone_summary_state')).rows[0].version);
  const again = await repository.refreshIndependentSummary();
  assert.equal(again.status, 'unchanged');
  assert.equal(again.written, 0);
  assert.equal(again.deleted, 0);
  assert.equal(Number((await db.query('SELECT version FROM marketing_phone_summary_state')).rows[0].version), version1);
  // Tin moi o page P0 => dung 1 SDT moi
  const extra = { slot: '2026-10-10', now: '2026-10-10T10:00:00Z', rows: { [P0]: [msg('m9', '0911000009', 'Alias A', '2026-10-09T03:00:00.000Z')] } };
  await runOne(extra);
  assert.equal(Number((await db.query('SELECT version FROM marketing_phone_summary_state')).rows[0].version), version1 + 1);
  const rows = (await db.query('SELECT count(*)::int AS n FROM marketing_phone_summary')).rows[0].n;
  assert.equal(rows, 7 + 1);
});

test('ban gop cu hon quan sat => bao cao tu lui ve gop JS (van dung), roi dung bang khi dung lai', async t => {
  const { db, repository } = await build(t);
  const { fast, old, calls } = services(repository);
  // Them quan sat truc tiep, chua gop.
  const fact = (await db.query(`SELECT f.id FROM marketing_pancake_independent_facts f LIMIT 1`)).rows[0].id;
  const run = (await db.query(`INSERT INTO marketing_sync_runs(run_key) VALUES ('pancake-independent:2026-10-11') RETURNING id`)).rows[0].id;
  const input = (await db.query('SELECT input FROM marketing_pancake_independent_facts f JOIN marketing_pancake_independent_observations o ON o.fact_id = f.id WHERE f.id = $1 LIMIT 1', [fact])).rows[0].input;
  await db.query(`INSERT INTO marketing_pancake_independent_observations(fact_id, run_id, observed_at, credited_date, input) VALUES ($1, $2, '2026-10-11T03:00:00Z', '2026-10-11', $3::jsonb)`,
    [fact, run, JSON.stringify({ ...input, employeeRaw: 'Late Person' })]);
  assert.equal(await repository.readIndependentSummary({ scope: 'none' }), null);
  const viaFallback = await fast.report('phones', {});
  assert.ok(calls.snapshot > 0);
  assert.deepEqual(strip(viaFallback), strip(await old.report('phones', {})));
  calls.snapshot = 0;
  await repository.refreshIndependentSummary();
  const viaTable = await fast.report('phones', {});
  assert.equal(calls.snapshot, 0);
  assert.deepEqual(strip(viaTable), strip(await old.report('phones', {})));
});

test('thieu bang / chua migrate 0069 => readIndependentSummary = null va bao cao van chay', async t => {
  const { repository } = await build(t, { precompute: false });
  assert.equal(await repository.readIndependentSummary({ scope: 'all' }), null);
  assert.equal((await repository.refreshIndependentSummary()).status, 'unavailable');
  const { fast, old } = services(repository);
  assert.deepEqual(strip(await fast.report('receipt-check', { year: 2026, month: 10 })), strip(await old.report('receipt-check', { year: 2026, month: 10 })));
  assert.deepEqual(strip(await fast.report('phones', {})), strip(await old.report('phones', {})));
});

test('dong bo Pancake goi gop bang o cuoi luot, loi gop khong lam hong luot dong bo', async () => {
  let refreshed = 0;
  const repository = {
    startSyncRun: async () => ({ id: '1', status: 'running' }), getSyncRun: async () => ({ id: '1', status: 'success', pages: [] }),
    finishSyncRun: async () => ({ id: '1', status: 'success', pages: [] }), getLatestSlotRun: async () => null,
    commitIndependentPageSync: async () => ({}), failIndependentPageSync: async () => ({}),
    refreshIndependentSummary: async () => { refreshed++; throw new Error('summary db down'); }
  };
  const client = { fetchPage: async () => Object.defineProperty([], 'coverage', { value: { complete: true, since: 0, until: 1 } }) };
  const lock = { acquire: async () => ({ listRunningRunIds: async () => [], release: async () => {} }) };
  const sync = createPancakeSync({ repository, client, lock, independent: true, now: () => new Date('2026-10-01T10:00:00Z') });
  const result = await sync.run({ slotDate: '2026-10-01' });
  assert.equal(result.status, 'success');
  assert.equal(refreshed, 1);
  // Che do khong doc lap (Sheets-hon-hop) khong dung bang gop nay.
  const mixed = createPancakeSync({ repository: { ...repository, readSnapshot: async () => ({ rawRows: [], facts: [] }), commitPageSync: async () => ({}), failPageSync: async () => ({}) }, client, lock, now: () => new Date('2026-10-01T10:00:00Z') });
  await mixed.run({ slotDate: '2026-10-02' });
  assert.equal(refreshed, 1);
});

test('refreshPhoneSummary: dang co ban gop ma doc ra 0 quan sat thi giu nguyen (khong xoa)', async t => {
  const { db, pool } = await build(t);
  const before = (await db.query('SELECT count(*)::int AS n FROM marketing_phone_summary')).rows[0].n;
  assert.ok(before > 0);
  const result = await refreshPhoneSummary({ pool, readObservations: async () => [], logger: silent });
  assert.equal(result.status, 'held');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM marketing_phone_summary')).rows[0].n, before);
});
