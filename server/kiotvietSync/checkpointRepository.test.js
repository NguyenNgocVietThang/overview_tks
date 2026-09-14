'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCheckpointRepository } = require('./checkpointRepository');

test('getCheckpoint returns null for an empty checkpoint table and uses parameters', async () => {
  const calls = [];
  const repo = createCheckpointRepository({ pool: { query: async (...args) => (calls.push(args), { rows: [] }) } });
  assert.equal(await repo.getCheckpoint('hanoi', 'invoices'), null);
  assert.deepEqual(calls[0][1], ['hanoi', 'invoices']);
});

test('advanceCheckpoint writes through the supplied transaction client and can store a window note', async () => {
  const calls = [];
  const repo = createCheckpointRepository({ pool: { query: async () => { throw new Error('pool must not be used'); } } });
  await repo.advanceCheckpoint('saigon', 'cash_flows', '2026-09-14T02:00:00.000Z', {
    client: { query: async (...args) => calls.push(args) }, note: '2026-09-14T02:00:00.000Z'
  });
  assert.match(calls[0][0], /ON CONFLICT \(branch, entity\)/);
  assert.match(calls[0][0], /last_success_at = now\(\)/);
  assert.deepEqual(calls[0][1], ['saigon', 'cash_flows', '2026-09-14T02:00:00.000Z', '2026-09-14T02:00:00.000Z']);
});

test('recordFailure changes note without moving last_synced_at', async () => {
  const calls = [];
  const repo = createCheckpointRepository({ pool: { query: async (...args) => calls.push(args) } });
  await repo.recordFailure('hanoi', 'orders', 'network down');
  assert.doesNotMatch(calls[0][0], /last_synced_at\s*=/);
  assert.deepEqual(calls[0][1], ['hanoi', 'orders', 'network down']);
});
