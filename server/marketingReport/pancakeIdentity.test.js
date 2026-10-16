'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { createMarketingRepository, PAGE_IDS } = require('./marketingRepository');
const { createPancakeSync } = require('./pancakeSync');
const { prepareIdentityImport, applyIdentityImport } = require('./marketingIdentityImport');
const P = PAGE_IDS[0];
const BOOK = '1cAOmY4WC2tIE0-OMwvy43PTR9dNK72k2d4DUDrB2swk';
const actor = { userId: 'system:pancake-identity-import', username: 'system', name: 'Identity' };

async function setup(t) {
  const db = new PGlite(); t.after(() => db.close());
  for (const name of ['0044_pancake_marketing.sql', '0045_pancake_current_input.sql', '0046_pancake_history_identity.sql']) await db.exec(fs.readFileSync(path.join(__dirname, '../db/migrations', name), 'utf8'));
  const pool = { query: (...args) => db.query(...args), connect: async () => ({ query: (...args) => db.query(...args), release() {} }) };
  const repository = createMarketingRepository({ pool });
  const lock = { async acquire() { return { listRunningRunIds: async () => [], release: async () => {} }; } };
  return { db, repository, lock };
}
const histRow = (rowNumber, extra = {}) => ({ pageId: P, tab: 'HN THÔ', rowNumber, phone: '0900000001', phoneKey: '0900000001', employeeRaw: 'A', sourceCreatedAt: '2026-09-27T03:00:00.000Z', sourceCreatedText: '', creditedDate: '2026-09-28', raw: [], ...extra });
const apiRow = (id, extra = {}) => ({ sourceKey: id, messageId: id, conversationId: 'c', type: 'INBOX', phone: '0900000001', phoneKey: '0900000001', employeeRaw: 'A', sourceCreatedAt: '2026-09-27T03:00:00.000Z', raw: { message: { id } }, ...extra });
const link = (rowNumber, messageId, extra = {}) => ({ tab: 'HN THÔ', rowNumber, pageId: P, messageId, conversationId: 'c', createdAt: '2026-09-27T03:00:00.000Z', resolution: 'unique', groupKey: null, evidence: { exportRow: 2 }, ...extra });
const baseline = (messageId, createdAt) => ({ pageId: P, messageId, conversationId: 'c', createdAt, evidence: {} });
const run = (repository, lock, rows, day = '2026-10-12') => createPancakeSync({ repository, lock, client: { fetchPage: async id => (id === P ? rows : []) }, now: () => new Date(`${day}T10:00:00Z`) }).run({ slotDate: day });

test('many history rows with different dates and phone keys link to one message without losing any row', async t => {
  const { repository, lock, db } = await setup(t);
  await repository.importHistory({ batchKey: 'h', workbookId: BOOK, rawRows: [histRow(2, { employeeRaw: 'A', creditedDate: '2026-09-28' }), histRow(3, { employeeRaw: 'B', creditedDate: '2026-10-05', phone: '900000001', phoneKey: '900000001' })] }, actor);
  await repository.importIdentities({ batchKey: 'i', workbookId: BOOK, links: [link(2, 'm1'), link(3, 'm1', { resolution: 'verified-notation' })], baselineMessages: [] }, actor);
  assert.equal(Number((await db.query('SELECT count(*) FROM marketing_history_rows')).rows[0].count), 2);
  // The API agrees with the latest linked row (B), so nothing new is counted.
  const result = await run(repository, lock, [apiRow('m1', { employeeRaw: 'B' })]);
  assert.equal(result.status, 'success');
  const snap = await repository.readSnapshot();
  assert.equal(snap.facts.length, 1);
  assert.equal(snap.rawRows.filter(r => r.origin === 'pancake').length, 0, 'unchanged assignment adds no observation');
  assert.equal(snap.rawRows.filter(r => r.origin === 'sheet').length, 2);
  const replay = await run(repository, lock, [apiRow('m1', { employeeRaw: 'B' })], '2026-10-13');
  assert.equal(replay.status, 'success');
  assert.equal((await repository.readSnapshot()).rawRows.length, 2, 'replay never increases numbers');
});

test('a changed assignee on an identified message appends one observation dated the sync day and keeps history', async t => {
  const { repository, lock } = await setup(t);
  await repository.importHistory({ batchKey: 'h', workbookId: BOOK, rawRows: [histRow(2)] }, actor);
  await repository.importIdentities({ batchKey: 'i', workbookId: BOOK, links: [link(2, 'm1')], baselineMessages: [] }, actor);
  await run(repository, lock, [apiRow('m1', { employeeRaw: 'Z' })]);
  const snap = await repository.readSnapshot();
  const added = snap.rawRows.filter(r => r.origin === 'pancake');
  assert.equal(added.length, 1);
  assert.equal(added[0].creditedDate, '2026-10-12');
  assert.equal(added[0].phoneKey, '0900000001');
  assert.equal(snap.rawRows.find(r => r.origin === 'sheet').creditedDate, '2026-09-28');
  await run(repository, lock, [apiRow('m1', { employeeRaw: 'Z' })], '2026-10-13');
  assert.equal((await repository.readSnapshot()).rawRows.filter(r => r.origin === 'pancake').length, 1);
});

test('equivalent messages share one anchor row and each stays known without double counting', async t => {
  const { repository, lock } = await setup(t);
  await repository.importHistory({ batchKey: 'h', workbookId: BOOK, rawRows: [histRow(2)] }, actor);
  await repository.importIdentities({ batchKey: 'i', workbookId: BOOK, links: [link(2, 'm1', { resolution: 'equivalent', groupKey: 'g' }), link(2, 'm2', { resolution: 'equivalent', groupKey: 'g' })], baselineMessages: [] }, actor);
  const result = await run(repository, lock, [apiRow('m1'), apiRow('m2')]);
  assert.equal(result.status, 'success');
  const snap = await repository.readSnapshot();
  assert.equal(snap.facts.length, 2);
  assert.equal(snap.facts.every(f => f.historicalRowId === snap.rawRows.find(r => r.origin === 'sheet').id), true);
  assert.equal(snap.rawRows.filter(r => r.origin === 'pancake').length, 0);
});

test('skip counters and new post-horizon messages when the page is fully accounted for', async t => {
  const { repository, lock } = await setup(t);
  await repository.importHistory({ batchKey: 'h', workbookId: BOOK, rawRows: [histRow(2)] }, actor);
  await repository.importIdentities({ batchKey: 'i', workbookId: BOOK, links: [link(2, 'm1')], baselineMessages: [baseline('known-extra', '2026-09-27T03:00:00.000Z')] }, actor);
  const rows = [apiRow('m1'), apiRow('known-extra', { phone: '0911111111', phoneKey: '0911111111' }), apiRow('old', { sourceCreatedAt: '2026-08-01T03:00:00.000Z' }), apiRow('fresh', { sourceCreatedAt: '2026-10-10T03:00:00.000Z', phone: '0922222222', phoneKey: '0922222222' })];
  const result = await run(repository, lock, rows);
  assert.equal(result.status, 'success');
  assert.deepEqual(result.baselineSkipped, [{ pageId: P, baselineExcluded: 1, preWindow: 1 }]);
  const added = (await repository.readSnapshot()).rawRows.filter(r => r.origin === 'pancake');
  assert.equal(added.length, 1);
  assert.equal(added[0].phone, '0922222222');
  assert.equal(added[0].creditedDate, '2026-10-12');
  const unknown = await run(repository, lock, [apiRow('m1'), apiRow('mystery', { sourceCreatedAt: '2026-09-27T03:00:00.000Z', phone: '0933333333', phoneKey: '0933333333' })], '2026-10-13');
  assert.equal(unknown.status, 'error');
  assert.equal(unknown.unresolved[0].reason, 'unknown-in-window');
  assert.deepEqual(unknown.unresolved[0].messageIds, ['mystery']);
});

test('identity links are verified against the stored row and are immutable and idempotent', async t => {
  const { repository, db } = await setup(t);
  await repository.importHistory({ batchKey: 'h', workbookId: BOOK, rawRows: [histRow(2)] }, actor);
  await assert.rejects(repository.importIdentities({ batchKey: 'bad-time', workbookId: BOOK, links: [link(2, 'm1', { createdAt: '2026-09-27T03:00:01.000Z' })], baselineMessages: [] }, actor), { code: 'MARKETING_IMPORT_CONFLICT' });
  await assert.rejects(repository.importIdentities({ batchKey: 'bad-row', workbookId: BOOK, links: [link(99, 'm1')], baselineMessages: [] }, actor), { code: 'MARKETING_IMPORT_CONFLICT' });
  assert.equal(Number((await db.query('SELECT count(*) FROM marketing_history_identities')).rows[0].count), 0, 'failed import leaves no partial rows');
  const input = { batchKey: 'ok', workbookId: BOOK, links: [link(2, 'm1')], baselineMessages: [baseline('x', '2026-09-28T03:00:00.000Z')] };
  assert.equal((await repository.importIdentities(input, actor)).replayed, false);
  assert.equal((await repository.importIdentities(input, actor)).replayed, true);
  await assert.rejects(repository.importIdentities({ ...input, links: [link(2, 'other')] }, actor), { code: 'MARKETING_IMPORT_CONFLICT' });
  await assert.rejects(db.query("UPDATE marketing_history_identities SET message_id='x'"), /immutable/);
  await assert.rejects(db.query('DELETE FROM marketing_baseline_messages'), /immutable/);
});

test('recovery file validation rejects duplicate links and rows linked to several messages outside an equivalence group', () => {
  const base = { capturedDate: '2026-10-12', unresolved: [{ ref: 'HN THÔ!1', pageId: P, reason: 'embedded-header-not-an-observation' }], baselineMessages: [] };
  const ok = prepareIdentityImport({ ...base, links: [link(2, 'a'), link(3, 'b', { resolution: 'equivalent', groupKey: 'g' }), link(3, 'c', { resolution: 'equivalent', groupKey: 'g' })] });
  assert.equal(ok.summary.historyRowsLinked, 2);
  assert.equal(ok.summary.resolutions.equivalent, 2);
  assert.throws(() => prepareIdentityImport({ ...base, links: [link(2, 'a'), link(2, 'a')] }), { code: 'INVALID_MARKETING_IMPORT' });
  assert.throws(() => prepareIdentityImport({ ...base, links: [link(2, 'a'), link(2, 'b')] }), { code: 'INVALID_MARKETING_IMPORT' });
  assert.throws(() => prepareIdentityImport({ ...base, links: [link(2, 'a')], baselineMessages: [baseline('a', '2026-09-27T03:00:00.000Z')] }), { code: 'INVALID_MARKETING_IMPORT' });
  assert.equal(typeof applyIdentityImport, 'function');
});
