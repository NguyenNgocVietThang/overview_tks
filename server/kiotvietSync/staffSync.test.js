'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { upsertStaffFromEntity } = require('./staffSync');
test('staff helper skips absent IDs and parameterizes the inferred staff record', async () => {
  const calls = [];
  const client = { query: async (...args) => calls.push(args) };
  await upsertStaffFromEntity(client, 'hanoi', null, 'Nobody');
  await upsertStaffFromEntity(client, 'hanoi', 7, "O'Neil");
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /ON CONFLICT \(branch, id\)/);
  assert.deepEqual(calls[0][1], ['hanoi', 7, "O'Neil"]);
});
