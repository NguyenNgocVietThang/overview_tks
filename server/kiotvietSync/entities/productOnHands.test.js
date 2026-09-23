'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeClient } = require('./entityTestUtils');
const productOnHands = require('./productOnHands');

test('entity dung checkpoint rieng, khong dung "products"', () => {
  assert.equal(productOnHands.entity, 'product_on_hands');
  assert.equal(productOnHands.endpoint, 'productOnHands');
  assert.equal(productOnHands.incrementalParam, 'lastModifiedFrom');
});

test('UPDATE chi ghi de raw->inventories cua dong products khop (branch, id), khong INSERT dong moi', async () => {
  const client = fakeClient();
  const items = [
    { Id: 1, Code: '010GDYE', ModifiedDate: '2026-09-23T08:38:28', Inventories: [{ BranchId: 1, OnHand: 0, Reserved: 0 }] },
    { id: 2, code: 'SP002', modifiedDate: '2026-09-23T09:00:00', inventories: [{ branchId: 1, onHand: 15, reserved: 2 }] }
  ];
  await productOnHands.upsertPage(client, 'hanoi', items);

  assert.equal(client.calls.length, 2);
  for (const call of client.calls) {
    assert.match(call[0], /^\s*UPDATE products SET raw = jsonb_set\(raw, '\{inventories\}', \$3::jsonb\)/);
    assert.doesNotMatch(call[0], /INSERT INTO/);
  }
  assert.deepEqual(client.calls[0][1], ['hanoi', 1, JSON.stringify(items[0].Inventories)]);
  assert.deepEqual(client.calls[1][1], ['hanoi', 2, JSON.stringify(items[1].inventories)]);
});

test('item khong co Inventories/inventories -> ghi mang rong, khong throw', async () => {
  const client = fakeClient();
  await productOnHands.upsertPage(client, 'saigon', [{ Id: 9 }]);
  assert.equal(client.calls.length, 1);
  assert.deepEqual(client.calls[0][1], ['saigon', 9, '[]']);
});
