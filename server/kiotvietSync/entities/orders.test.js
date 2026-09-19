'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertChildReplacement } = require('./entityTestUtils');
const entity = require('./orders');
test('orders replaces all detail rows and declares no upper bound', async () => {
  assert.equal(entity.hasUpperBound, false);
  assert.equal(entity.listQuery.pageSize, '20');
  await assertChildReplacement(entity, { Id: 11, Code: 'DH11', OrderDetails: [{ ProductId: 1 }] }, 'order_details', 1);
});
