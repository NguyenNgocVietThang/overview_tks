'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('invoices, purchases va cashFlows co backfillRangeParam dung nhu API_ENDPOINTS.md', () => {
  assert.deepEqual(require('./invoices').backfillRangeParam, { from: 'fromPurchaseDate', to: 'toPurchaseDate' });
  assert.deepEqual(require('./purchases').backfillRangeParam, { from: 'fromPurchaseDate', to: 'toPurchaseDate' });
  assert.deepEqual(require('./cashFlows').backfillRangeParam, { from: 'startDate', to: 'endDate' });
});

test('du lieu nen (categories/products/customers/suppliers) khong co backfillRangeParam', () => {
  for (const name of ['categories', 'products', 'customers', 'suppliers']) {
    assert.equal(require(`./${name}`).backfillRangeParam, undefined, `${name} khong duoc co backfillRangeParam`);
  }
});

test('orders/returns (khong co tham so chan tren) khong co backfillRangeParam', () => {
  for (const name of ['orders', 'returns']) {
    assert.equal(require(`./${name}`).backfillRangeParam, undefined, `${name} khong duoc co backfillRangeParam`);
    assert.equal(require(`./${name}`).hasUpperBound, false);
  }
});
