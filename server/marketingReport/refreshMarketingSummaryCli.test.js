'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb, createPool } = require('./precomputeFixture');
const { createMarketingRepository, PAGE_IDS } = require('./marketingRepository');
const { createPancakeSync } = require('./pancakeSync');
const { main } = require('../scripts/refresh-marketing-summary');

const [P0] = PAGE_IDS;
const silent = { info() {}, error() {} };
const msg = (sourceKey, phone, employeeRaw, sourceCreatedAt) => ({
  sourceKey, messageId: sourceKey, conversationId: `c-${sourceKey}`, type: 'INBOX', phone, phoneKey: phone, employeeRaw, sourceCreatedAt, raw: { message: { id: sourceKey } }
});

// Mot luot dong bo that (client Pancake gia) de co quan sat trong DB, roi xoa bang gop de mo phong "vua ap 0069".
async function seeded(t) {
  const db = await createDb({ precompute: true });
  t.after(() => db.close());
  const repository = createMarketingRepository({ pool: createPool(db), logger: silent });
  const rows = [msg('m1', '0911000001', 'A', '2026-10-01T03:00:00.000Z'), msg('m2', '0911000002', 'B', '2026-10-02T03:00:00.000Z')];
  Object.defineProperty(rows, 'coverage', { value: { complete: true, since: 0, until: 1, paginationExhausted: true } });
  const lock = { async acquire() { return { listRunningRunIds: async () => [], release: async () => {} }; } };
  const sync = createPancakeSync({
    repository, lock, independent: true, now: () => new Date('2026-10-07T10:00:00Z'),
    client: { fetchPage: async pageId => (pageId === P0 ? rows : Object.assign([], { coverage: rows.coverage })) }
  });
  assert.equal((await sync.run({ slotDate: '2026-10-07' })).status, 'success');
  await db.query('DELETE FROM marketing_phone_summary');
  await db.query('DELETE FROM marketing_phone_summary_state');
  return { db, repository };
}
const capture = () => {
  const out = [], err = [];
  return { out, err, stdout: s => out.push(s), stderr: s => err.push(s) };
};

test('mac dinh la dry-run: khong cham repository/DB', async () => {
  const io = capture();
  const repository = { refreshIndependentSummary: async () => { throw new Error('khong duoc goi'); } };
  assert.equal(await main([], { repository, ...io }), 0);
  assert.equal(JSON.parse(io.out[0]).mode, 'dry-run');
  assert.equal(await main(['--dry-run'], { repository, ...io }), 0);
});

test('--help in huong dan va khong cham DB', async () => {
  const io = capture();
  assert.equal(await main(['--help'], { repository: {}, ...io }), 0);
  assert.match(io.out[0], /refresh-marketing-summary/);
});

test('tham so la => ma 1 va chi in ma loi an toan', async () => {
  const io = capture();
  assert.equal(await main(['--bogus'], { repository: {}, ...io }), 1);
  assert.equal(io.out.length, 0);
  assert.equal(io.err.length, 1);
});

test('--apply dung lai bang gop tu quan sat da luu; chay lai khong ghi them', async t => {
  const { db, repository } = await seeded(t);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM marketing_phone_summary')).rows[0].n, 0);
  const io = capture();
  assert.equal(await main(['--apply'], { repository, ...io }), 0);
  const first = JSON.parse(io.out[0]);
  assert.equal(first.status, 'updated');
  assert.equal(first.phones, 2);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM marketing_phone_summary')).rows[0].n, 2);
  const state = (await db.query('SELECT phone_count, observation_count FROM marketing_phone_summary_state')).rows[0];
  assert.equal(state.phone_count, 2);
  assert.ok(await repository.readIndependentSummary({ scope: 'none' }), 'bao cao dung duoc bang sau khi dung lai');

  const again = capture();
  assert.equal(await main(['--apply'], { repository, ...again }), 0);
  const second = JSON.parse(again.out[0]);
  assert.equal(second.status, 'unchanged');
  assert.equal(second.written, 0);
  assert.equal(second.deleted, 0);
});

test('--apply khi chua co migration 0069 => ma 2 (unavailable), khong nem loi', async t => {
  const db = await createDb({ precompute: false });
  t.after(() => db.close());
  const repository = createMarketingRepository({ pool: createPool(db), logger: silent });
  const io = capture();
  assert.equal(await main(['--apply'], { repository, ...io }), 2);
  assert.equal(JSON.parse(io.out[0]).status, 'unavailable');
});
