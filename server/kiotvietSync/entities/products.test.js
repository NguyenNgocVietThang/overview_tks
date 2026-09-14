'use strict';
const test = require('node:test');
const { assertSimpleEntity } = require('./entityTestUtils');
const entity = require('./products');
test('products maps verified fields and preserves raw JSON', async () => {
  const item = { Id: 1, Code: 'SP1', Name: 'Tea', CategoryId: 2, BasePrice: 12000, Unit: 'box', IsActive: true, CreatedDate: 'c', ModifiedDate: 'm' };
  await assertSimpleEntity(entity, item, [1, 'SP1', 'Tea', 2, 12000, 'box', true, 'c', 'm']);
});
