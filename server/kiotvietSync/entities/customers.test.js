'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertSimpleEntity } = require('./entityTestUtils');
const entity = require('./customers');
test('customers maps identifiers, debt and revenue without interpolating values', async () => {
  const item = { Id: 2, Code: "KH'2", Name: 'Lan', ContactNumber: '090', GroupId: 8, Debt: 9, TotalRevenue: 10, CreatedDate: 'c', ModifiedDate: 'm', isActive: true };
  await assertSimpleEntity(entity, item, [2, "KH'2", 'Lan', '090', 8, 9, 10, 'c', 'm']);
});

test('customer payloads always store canonical boolean active status without mutating API data', async () => {
  for (const [flag, expected] of [[{}, true], [{ isActive: false }, false], [{ IsActive: false }, false], [{ isActive: 'false' }, false], [{ IsActive: true }, true]]) {
    const source = Object.freeze({ id: 2, name: 'Lan', ...flag });
    let raw;
    await entity.upsertPage({ query: async (_sql, params) => { raw = params.at(-1); } }, 'hanoi', [source]);
    assert.equal(raw.isActive, expected);
    assert.equal(raw.name, 'Lan');
  }
});

test('customer removals and complete reconciliation retain records and other branch history', async t => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(require('node:fs').readFileSync(require('node:path').join(__dirname, '../../db/migrations/0001_core_master_data.sql'), 'utf8'));
  await entity.upsertPage(db, 'hanoi', [{ id: 1, name: 'Keep' }, { id: 2, name: 'Removed' }, { id: 3, name: 'Absent' }]);
  await entity.upsertPage(db, 'saigon', [{ id: 3, name: 'Other branch' }]);
  await entity.applyPageMetadata(db, 'hanoi', { removedIds: [2] });
  assert.equal((await db.query("SELECT raw->>'isActive' AS active FROM customers WHERE branch='hanoi' AND id=2")).rows[0].active, 'false');
  await db.query("UPDATE customers SET synced_at='2026-01-01' WHERE branch='hanoi'");
  await entity.markMissing(db, 'hanoi', ['1', '2'], '2026-10-15T00:00:00Z');
  assert.deepEqual((await db.query("SELECT id,raw->>'isActive' AS active FROM customers WHERE branch='hanoi' ORDER BY id")).rows, [{ id: 1, active: 'true' }, { id: 2, active: 'false' }, { id: 3, active: 'false' }]);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM customers')).rows[0].n, 4);
  assert.equal((await db.query("SELECT raw->>'isActive' AS active FROM customers WHERE branch='saigon'")).rows[0].active, 'true');
  await entity.upsertPage(db, 'hanoi', [{ id: 3, name: 'Reactivated' }]);
  assert.equal((await db.query("SELECT raw->>'isActive' AS active FROM customers WHERE branch='hanoi' AND id=3")).rows[0].active, 'true');
  await entity.markMissing(db, 'hanoi', ['1'], '2026-01-02T00:00:00Z');
  assert.equal((await db.query("SELECT raw->>'isActive' AS active FROM customers WHERE branch='hanoi' AND id=3")).rows[0].active, 'true', 'A concurrent newer upsert is protected from an older scan');
  await entity.upsertPage(db, 'saigon', Array.from({ length: 101 }, (_, index) => ({ id: 100 + index, name: `Customer ${index}` })));
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM customers WHERE branch='saigon'")).rows[0].n, 102);
});

test('customer reconciliation batches 101 customer writes into two parameterized queries', async () => {
  const calls = [];
  await entity.upsertPage({ query: async (...args) => calls.push(args) }, 'saigon', Array.from({ length: 101 }, (_, index) => ({ id: 100 + index, name: "O'Name", isActive: true })));
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].length, 1100);
  assert.equal(calls[1][1].length, 11);
  assert.doesNotMatch(calls[0][0], /O'Name/);
  assert.equal(calls[1][1][1], 200);
});

test('customer absence flags and completion checkpoint roll back together before retry', async t => {
  const { PGlite } = require('@electric-sql/pglite');
  const { createSyncDriver } = require('../syncDriver');
  const { createCheckpointRepository } = require('../checkpointRepository');
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(require('node:fs').readFileSync(require('node:path').join(__dirname, '../../db/migrations/0001_core_master_data.sql'), 'utf8'));
  await entity.upsertPage(db, 'hanoi', [{ id: 1, name: 'Present' }, { id: 2, name: 'Absent' }]);
  await db.query("UPDATE customers SET synced_at='2020-01-01'");
  const pool = { query: (...args) => db.query(...args), connect: async () => ({ query: (...args) => db.query(...args), release() {} }) };
  const checkpoints = createCheckpointRepository({ pool });
  let fail = true, emitted = 0;
  const driver = createSyncDriver({ pool, events: { emit: () => emitted++ }, checkpointRepository: { ...checkpoints,
    advanceCheckpoint: async (...args) => { await checkpoints.advanceCheckpoint(...args); if (fail) throw new Error('checkpoint failed'); }
  }});
  const api = { fetchAllPages: async (_e, _q, cb) => cb([{ id: 1, name: 'Present' }], { total: 1, removedIds: [] }) };
  await assert.rejects(driver.pollEntityOnce(api, 'hanoi', entity), /checkpoint failed/);
  assert.equal((await db.query("SELECT raw->>'isActive' AS active FROM customers WHERE id=2")).rows[0].active, 'true');
  assert.equal(await checkpoints.getCheckpoint('hanoi', 'customers'), null);
  assert.equal(emitted, 0);
  fail = false;
  await driver.pollEntityOnce(api, 'hanoi', entity);
  assert.equal((await db.query("SELECT raw->>'isActive' AS active FROM customers WHERE id=2")).rows[0].active, 'false');
  assert.ok(JSON.parse((await checkpoints.getCheckpoint('hanoi', 'customers')).note).activeCustomersReconciledAt);
  assert.equal(emitted, 1);
});
