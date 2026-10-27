'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {makeAllocationSnapshot,allocationMatches,deductAllocation}=require('./pickAssignmentSnapshot');
const C=require('../public/shared/carton');
const row=(notes='3Tx100',extra={})=>({code:'A',location:'A01',notes,version:1,...extra});
test('snapshot rejects identity and printed carton changes but accepts normal depletion',()=>{
  const snapshot=makeAllocationSnapshot(row(),100);
  assert.equal(allocationMatches(snapshot,row('2Tx100-30')),true);
  assert.equal(allocationMatches(snapshot,row('2tx100c',{location:'a 01',version:5})),true);
  assert.equal(allocationMatches(snapshot,row('3Tx50')),false);
  assert.equal(allocationMatches(snapshot,row('3Tx100',{location:'B02'})),false);
  assert.equal(allocationMatches(snapshot,row('3Tx100',{code:'B'})),false);
  assert.equal(allocationMatches(null,row()),false);
});
test('unrelated carton size can disappear, and deduction follows printed whole cartons',()=>{
  const snapshot=makeAllocationSnapshot(row('3Tx200+1Tx50'),200);
  assert.equal(allocationMatches(snapshot,row('2Tx200')),true);
  const result=deductAllocation(snapshot,row('2Tx200+4Tx50'));
  assert.equal(result.spec.quantity,400);
  assert.deepEqual(result.spec.terms.map(t=>[t.cartons,t.perCarton]),[[1,200],[4,50]]);
});
test('partial carton plan is valid with changed loose quantity only if enough remains',()=>{
  const snapshot=makeAllocationSnapshot(row('3Tx100'),70);
  assert.equal(allocationMatches(snapshot,row('1Tx100-30')),true);
  assert.equal(allocationMatches(snapshot,row('1Tx100-31')),false);
  assert.equal(deductAllocation(snapshot,row('2Tx100-30')).spec.quantity,100);
  assert.equal(C.parseSpec(snapshot.notes).quantity,300);
});
test('partial printed plan does not switch to newly added whole cartons',()=>{
  const snapshot=makeAllocationSnapshot(row('3Tx100'),50);
  const result=deductAllocation(snapshot,row('3Tx100+1Tx50'));
  assert.equal(result.spec.quantity,300);
  assert.equal(result.text,'3T x 100 + 1T x 50 - 50');
  assert.equal(result.taken,0.5);
});
