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

test('purchase reconciliation writes new or changed receipts, skips unchanged raw regardless of key order', async () => {
  const same = { id: 1, code: 'PN1', status: 3, purchaseOrderDetails: [{ productId: 3, quantity: 5 }] };
  const changed = { id: 2, code: 'PN2', status: 4, purchaseOrderDetails: [] };
  const added = { id: 3, code: 'PN3', status: 3, purchaseOrderDetails: [{ productId: 3, quantity: 4500 }] };
  const calls = [];
  const pg = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT')) return { rows: [
      { id: '1', raw: { status: 3, code: 'PN1', id: 1, purchaseOrderDetails: [{ quantity: 5, productId: 3 }] } },
      { id: '2', raw: { ...changed, status: 3 } }
    ] };
    return { rows: [] };
  }};
  await entity.reconcilePage(pg, 'hanoi', [same, changed, added]);
  assert.deepEqual(calls.filter(x => x.sql.startsWith('INSERT INTO purchases')).map(x => x.params[1]), [2, 3]);
  assert.deepEqual(calls.filter(x => x.sql.startsWith('DELETE FROM purchase_details')).map(x => x.params), [['hanoi', 2], ['hanoi', 3]]);
  assert.deepEqual(calls[0].params, ['hanoi', [1, 2, 3]]);
});

test('purchase reconciliation batches large receipt details without losing line order or raw data', async () => {
  const details = Array.from({ length: 501 }, (_, i) => ({ productId: i + 10, quantity: i + 1, price: 7 }));
  const writes = [];
  await entity.upsertPage({ query: async (sql, params) => writes.push({ sql, params }) }, 'hanoi', [{ id: 99, code: 'PN99', purchaseOrderDetails: details }]);
  const inserts = writes.filter(x => x.sql.startsWith('INSERT INTO purchase_details'));
  assert.equal(inserts.length, 2);
  const rows = inserts.flatMap(x => Array.from({ length: x.params.length / 7 }, (_, i) => x.params.slice(i * 7, i * 7 + 7)));
  assert.equal(rows.length, 501);
  assert.deepEqual(rows[0], ['hanoi', 99, 0, 10, 1, 7, details[0]]);
  assert.deepEqual(rows[500], ['hanoi', 99, 500, 510, 501, 7, details[500]]);
  assert.match(inserts[0].sql, /\$3500/);
  assert.doesNotMatch(inserts[1].sql, /\$8\b/);
});
