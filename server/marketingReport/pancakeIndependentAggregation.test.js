'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {aggregateIndependentPhones}=require('./marketingAggregation');
const row=(employeeRaw,observedAt,extra={})=>({pageId:'1',phone:'012',phoneKey:'012',sourceKey:'m1',sourceOrder:'1',sourceCreatedAt:'2026-09-30T17:01:00Z',observedAt,employeeRaw,...extra});
const calc=rows=>aggregateIndependentPhones(rows,[{rawName:'A',reportEmployee:'Sale'},{rawName:'B',reportEmployee:'Sale'}]);
test('independent first day is message creation in Vietnam; page identity stays separate',()=>{
 const phones=calc([row('A','2026-10-16T00:00:00Z'),row('A','2026-10-16T00:00:00Z',{pageId:'2'})]);
 assert.equal(phones.length,2);assert.equal(phones[0].firstAt,'2026-10-01');assert.equal(phones[0].repeatAt,null);
});
test('observed cross-day change repeats; aliases applied after source comparison; replay stable',()=>{
 const rows=[row('A','2026-10-16T16:59:00Z'),row('B','2026-10-16T17:01:00Z',{sourceOrder:'2'})];
 const p=calc(rows)[0];assert.equal(p.repeatAt,'2026-10-17');assert.equal(p.repeatEmployee,'B');assert.equal(p.mappedRepeatEmployee,'Sale');
 assert.deepEqual(calc(rows),calc([...rows].reverse()));
});
test('same-day switch, same employee, missing employee, A to B to A do not repeat',()=>{
 for(const rows of [
 [row('A','2026-10-16T01:00:00Z'),row('B','2026-10-16T02:00:00Z',{sourceOrder:'2'})],
 [row('A','2026-10-16T01:00:00Z'),row('A','2026-10-17T02:00:00Z',{sourceOrder:'2'})],
 [row('','2026-10-16T01:00:00Z'),row('B','2026-10-17T02:00:00Z',{sourceOrder:'2'})],
 [row('A','2026-10-16T01:00:00Z'),row('B','2026-10-17T02:00:00Z',{sourceOrder:'2'}),row('A','2026-10-18T02:00:00Z',{sourceOrder:'3'})]
 ]) assert.equal(calc(rows)[0].repeatAt,null);
});
test('different messages in first snapshot cannot fabricate historical assignment changes',()=>{
 const p=calc([row('A','2026-10-16T01:00:00Z'),row('B','2026-10-16T01:00:00Z',{sourceKey:'m2',sourceOrder:'2',sourceCreatedAt:'2026-10-02T01:00:00Z'})])[0];
 assert.equal(p.repeatAt,null);
});
