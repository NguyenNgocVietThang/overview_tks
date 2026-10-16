'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { customerPoints, buildRewardBoard, allocateMoney } = require('./debtRewardRules');

test('points use each threshold inclusively, negative net revenue and completed invoice counts', () => {
  for (const [count, want] of [[0,0],[1,1],[2,2],[4,2],[5,3],[9,3],[10,4],[19,4],[20,5],[39,5],[40,6],[100,6]]) {
    assert.equal(customerPoints(count, 0).invoicePoints, want);
  }
  for (const [amount, want] of [[-1,-1],[0,0],[4999999,0],[5000000,1],[29999999,1],[30000000,2],
    [99999999,2],[100000000,3],[299999999,3],[300000000,4],[999999999,4],[1000000000,5],
    [2999999999,5],[3000000000,6],[5999999999,6],[6000000000,7],[8999999999,7],[9000000000,8]]) {
    assert.equal(customerPoints(0, amount).revenuePoints, want);
  }
  assert.deepEqual(customerPoints(5, 30000000), { invoicePoints:3, revenuePoints:2, points:5 });
});

test('global ranking before any display filter, eligibility 30 and top 20 exemptions', () => {
  const sales = Array.from({length:22}, (_,i) => ({sale:`Sale ${String(i+1).padStart(2,'0')}`,points:30,branches:[i%2?'hanoi':'saigon']}));
  sales.push({sale:'Low',points:29}, {sale:'Zero',points:0}, {sale:'Chưa phân nhóm',points:100});
  const penalties = sales.map((s,i)=>({sale:s.sale,cycleDate:'2026-10-13',amount:(i+1)*10000,customers:1}));
  const board=buildRewardBoard({sales,penalties,lastDate:'2026-10-13'});
  const get = sale => board.rows.find(r=>r.sale===sale);
  assert.equal(get('Sale 10').rank,10); assert.ok(get('Sale 10').reward>0);
  assert.equal(get('Sale 11').rank,11); assert.equal(get('Sale 11').reward,0); assert.equal(get('Sale 11').payablePenalty,0);
  assert.equal(get('Sale 20').payablePenalty,0); assert.equal(get('Sale 21').payablePenalty,210000);
  assert.equal(get('Low').rank,null); assert.equal(get('Low').payablePenalty,230000);
  assert.equal(get('Zero').ratio,null); assert.equal(get('Chưa phân nhóm').rank,null);
  assert.equal(board.summary.payablePenalty,1150000);
  assert.equal(board.summary.pool,3000000); assert.equal(board.summary.companyTopUp,2080000);
  assert.equal(board.rows.reduce((s,r)=>s+r.reward,0),3000000);
});

test('equal ratio and points share competition rank and combined slot reward; name only orders display', () => {
  const board=buildRewardBoard({sales:[{sale:'An',points:30},{sale:'Bình',points:60},{sale:'Chi',points:60}],penalties:[]});
  assert.deepEqual(board.rows.map(r=>r.sale),['Bình','Chi','An']);
  assert.deepEqual(board.rows.map(r=>r.rank),[1,1,3]);
  assert.equal(board.rows[0].rankReward,529412);
  assert.equal(board.rows[1].rankReward,529412);
  assert.equal(board.rows[2].rankReward,441176);
  assert.equal(board.rows.reduce((s,r)=>s+r.rankReward,0),1500000);
  assert.equal(board.rows.reduce((s,r)=>s+r.pointsReward,0),1500000);
  assert.equal(board.rows[0].pointsReward,600000);
});

test('tied rank 10 includes both recipients and divides the last slot without expanding the pool',()=>{
 const sales=Array.from({length:12},(_,i)=>({sale:`Sale ${i+1}`,points:100-i}));
 sales[10].points=91;
 const b=buildRewardBoard({sales});
 const at=s=>b.rows.find(r=>r.sale===s);
 assert.equal(at('Sale 10').rank,10);assert.equal(at('Sale 11').rank,10);assert.equal(at('Sale 12').rank,12);
 assert.equal(b.summary.recipientCount,11);
 assert.equal(at('Sale 10').rankReward,7500);assert.equal(at('Sale 11').rankReward,7500);
 assert.equal(at('Sale 12').reward,0);
 assert.equal(b.rows.reduce((sum,r)=>sum+r.reward,0),3000000);
});

test('tied rank 20 exempts the whole group, while next competitor is rank22 and pays',()=>{
 const sales=Array.from({length:22},(_,i)=>({sale:`Sale ${i+1}`,points:100}));
 const penalties=sales.map((s,i)=>({sale:s.sale,cycleDate:'2026-10-14',amount:(i===20?20:i+1)*10000,customers:1}));
 const b=buildRewardBoard({sales,penalties});
 const at=s=>b.rows.find(r=>r.sale===s);
 assert.equal(at('Sale 20').rank,20);assert.equal(at('Sale 21').rank,20);
 assert.equal(at('Sale 20').payablePenalty,0);assert.equal(at('Sale 21').payablePenalty,0);
 assert.equal(at('Sale 22').rank,22);assert.equal(at('Sale 22').payablePenalty,220000);
});

test('more than ten equal first places all receive equal shares to within currency rounding',()=>{
 const b=buildRewardBoard({sales:Array.from({length:12},(_,i)=>({sale:`Sale ${i}`,points:30}))});
 assert.deepEqual(b.rows.map(r=>r.rank),Array(12).fill(1));
 assert.equal(b.summary.recipientCount,12);
 assert.equal(b.rows.reduce((sum,r)=>sum+r.reward,0),3000000);
 assert.equal(Math.max(...b.rows.map(r=>r.reward))-Math.min(...b.rows.map(r=>r.reward)),0);
});

test('large pool is 80% of payable penalties; no recipients leaves pool unallocated', () => {
  const board=buildRewardBoard({sales:[{sale:'Low',points:29}],penalties:[{sale:'Low',amount:10000000,cycleDate:'2026-10-01',customers:2}]});
  assert.equal(board.summary.pool,8000000); assert.equal(board.summary.companyTopUp,0);
  assert.equal(board.summary.allocatedReward,0);
});

test('largest remainder respects rank ties and conserves odd currency totals', () => {
  assert.deepEqual(allocateMoney(7,[1,1,1]),[3,2,2]);
  assert.deepEqual(allocateMoney(100,[19,17]),[53,47]);
});
