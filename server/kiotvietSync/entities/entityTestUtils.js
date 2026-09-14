'use strict';

const assert = require('node:assert/strict');

function fakeClient() {
  const calls = [];
  return { calls, query: async (...args) => calls.push(args) };
}

async function assertSimpleEntity(module, item, expectedParams) {
  const client = fakeClient();
  await module.upsertPage(client, 'hanoi', [item]);
  assert.equal(client.calls.length, 1);
  assert.match(client.calls[0][0], /ON CONFLICT \(branch, id\) DO UPDATE/);
  assert.deepEqual(client.calls[0][1], ['hanoi', ...expectedParams, item]);
}

async function assertChildReplacement(module, item, childTable, childCount, extraTable) {
  const client = fakeClient();
  await module.upsertPage(client, 'saigon', [item]);
  const sql = client.calls.map((call) => call[0]).join('\n');
  assert.match(sql, new RegExp(`DELETE FROM ${childTable}`));
  assert.equal(client.calls.filter((call) => call[0].includes(`INSERT INTO ${childTable}`)).length, childCount);
  if (extraTable) {
    assert.match(sql, new RegExp(`DELETE FROM ${extraTable}`));
    assert.match(sql, new RegExp(`INSERT INTO ${extraTable}`));
  }
  assert.ok(client.calls.every((call) => Array.isArray(call[1])), 'all API values must be query parameters');
}

module.exports = { fakeClient, assertSimpleEntity, assertChildReplacement };
