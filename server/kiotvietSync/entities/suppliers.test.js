'use strict';
const test = require('node:test');
const { assertSimpleEntity } = require('./entityTestUtils');
const entity = require('./suppliers');
test('suppliers maps optional fields to null', async () => {
  const item = { Id: 3, SupplierCode: 'NCC3', SupplierName: 'NCC' };
  await assertSimpleEntity(entity, item, [3, 'NCC3', 'NCC', null, null, null, null, null]);
});
