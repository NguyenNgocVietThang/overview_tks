'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {suggest,validate,quantity}=require('./rules');
const row=(id,available,location=id)=>({id,available,location,code:'P1'});
test('a sufficient location is selected without using any location priority',()=>{
  assert.deepEqual(suggest(30,[row('near',20),row('far',35)]).picks,[{id:'far',quantity:30}]);
});
test('choose the smallest sufficient quantity, including an exact match; ignore location priority',()=>{
  assert.equal(suggest(30,[row('A',100),row('B',35)],{A:1,B:2}).picks[0].id,'B');
  assert.equal(suggest(30,[row('A',100),row('B',35)]).picks[0].id,'B');
  assert.equal(suggest(100,[row('k1',20),row('k2',100),row('k3',500),row('k4',200)]).picks[0].id,'k2');
  assert.equal(suggest(100,[row('k1',20),row('k3',500),row('k4',200)]).picks[0].id,'k4');
  assert.deepEqual(suggest(45,[row('A',30),row('B',25),row('C',15)]).picks,[{id:'A',quantity:30},{id:'C',quantity:15}]);
});
test('split allocations use residual need and report shortage instead of inventing stock',()=>{
  assert.deepEqual(suggest(45,[row('A',25),row('B',30)]),{picks:[{id:'B',quantity:30},{id:'A',quantity:15}],shortage:0});
  assert.equal(suggest(100,[row('A',20),row('B',null)]).shortage,80);
});
test('unknown, negative and formatted sheet values are not assumed available',()=>{
  for(const value of ['',null,'1.000','1,5','1.000,5',-2,NaN])assert.equal(quantity(value),null);
  assert.equal(quantity(1000),1000);assert.equal(quantity('12.5'),12.5);
});
test('validation blocks under/over allocation, mismatched code and shared stock overuse',()=>{
  const lines=[{productCode:'P1',quantity:6},{productCode:'P1',quantity:6}],locations=[row('A',10)];
  assert.ok(validate(lines,locations,{0:[{id:'A',quantity:6}],1:[{id:'A',quantity:6}]}).some(e=>e.includes('vượt')));
  assert.ok(validate([lines[0]],locations,{0:[{id:'A',quantity:5}]}).length);
  assert.ok(validate([lines[0]],[{...locations[0],code:'P2'}],{0:[{id:'A',quantity:6}]}).length);
});
test('nhặt tròn thùng được vượt SL cần nhưng ít hơn một thùng; vị trí không có quy cách thì vẫn phải đúng SL',()=>{
  const lines=[{productCode:'P1',quantity:100}];
  const cartons=[{...row('A',50),perCarton:50},{...row('B',60),perCarton:60}];
  assert.deepEqual(validate(lines,cartons,{0:[{id:'A',quantity:50},{id:'B',quantity:60}]}),[],'110 cho đơn 100 là 2 thùng nguyên');
  assert.ok(validate(lines,cartons,{0:[{id:'A',quantity:50},{id:'B',quantity:60},{id:'A',quantity:1}]}).length,'thừa từ một thùng trở lên bị chặn');
  const loose=[{...row('A',50),perCarton:null},{...row('B',60),perCarton:null}];
  assert.ok(validate(lines,loose,{0:[{id:'A',quantity:50},{id:'B',quantity:60}]}).some(e=>e.includes('đã chỉ định')),'không có quy cách thì không được thừa');
  assert.ok(validate(lines,cartons,{0:[{id:'A',quantity:50},{id:'B',quantity:30}]}).length,'thiếu vẫn bị chặn');
});
