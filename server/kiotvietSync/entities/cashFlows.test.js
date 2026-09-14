'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const entity = require('./cashFlows');
test('cash flows have a dedicated date-window shape and preserve receipt direction', async () => {
  const item = { Id: 14, Code: 'PT14', IsReceipt: false, Amount: 20, Method: 'Bank', CustomerId: 1, SupplierId: 2, UserId: 3, Description: 'x', TransDate: 't', CreatedDate: 'c' };
  const calls=[];
  await entity.upsertPage({query:async(...args)=>calls.push(args)},'hanoi',[item]);
  const cash=calls.find((call)=>call[0].includes('INSERT INTO cash_flows'));
  assert.deepEqual(cash[1], ['hanoi',14,'PT14',false,20,'Bank',1,2,3,'x','t','c',item]);
});
test('cash flows infer staff from UserId in the same transaction client', async () => {
  const calls=[];
  await entity.upsertPage({query:async(...args)=>calls.push(args)},'saigon',[{Id:1,IsReceipt:true,UserId:77,UserName:'Thu'}]);
  const staff=calls.find((call)=>call[0].includes('INSERT INTO staff'));
  assert.deepEqual(staff[1],['saigon',77,'Thu']);
});
