'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertChildReplacement } = require('./entityTestUtils');
const entity = require('./purchases');
test('purchases uses purchaseorders and replaces all detail rows', async () => {
  assert.equal(entity.endpoint, 'purchaseorders');
  await assertChildReplacement(entity, { Id: 13, Code: 'PN13', PurchaseOrderDetails: [{ ProductId: 3 }] }, 'purchase_details', 1);
});
test('purchases uses PurchaseOrderId consistently for parent and child replacement', async () => {
  const calls=[];
  await entity.upsertPage({query:async(...args)=>calls.push(args)},'hanoi',[{PurchaseOrderId:91,PurchaseOrderCode:'PN91',PurchaseOrderDetails:[]}]);
  const deletion=calls.find((call)=>call[0].includes('DELETE FROM purchase_details'));
  assert.deepEqual(deletion[1],['hanoi',91]);
});
