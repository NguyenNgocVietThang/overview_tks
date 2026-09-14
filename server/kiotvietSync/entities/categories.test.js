'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const categories = require('./categories');

test('categories upserts every item with raw data and null for a missing rank', async () => {
  const calls = [];
  const client = { query: async (...args) => calls.push(args) };
  const items = [
    { Id: 1, ParentId: 0, Name: 'Root', Rank: 1, ModifiedDate: '2026-09-14T00:00:00Z' },
    { id: 2, parentId: 1, name: 'Child', modifiedDate: '2026-09-14T01:00:00Z' },
    { Id: 3, Name: 'Other', Rank: 5 }
  ];
  await categories.upsertPage(client, 'hanoi', items);
  assert.equal(calls.length, 3);
  assert.match(calls[0][0], /ON CONFLICT \(branch, id\) DO UPDATE/);
  assert.deepEqual(calls[1][1], ['hanoi', 2, 1, 'Child', null, '2026-09-14T01:00:00Z', items[1]]);
});
