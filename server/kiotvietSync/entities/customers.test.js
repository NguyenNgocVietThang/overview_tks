'use strict';
const test = require('node:test');
const { assertSimpleEntity } = require('./entityTestUtils');
const entity = require('./customers');
test('customers maps identifiers, debt and revenue without interpolating values', async () => {
  const item = { Id: 2, Code: "KH'2", Name: 'Lan', ContactNumber: '090', GroupId: 8, Debt: 9, TotalRevenue: 10, CreatedDate: 'c', ModifiedDate: 'm' };
  await assertSimpleEntity(entity, item, [2, "KH'2", 'Lan', '090', 8, 9, 10, 'c', 'm']);
});
