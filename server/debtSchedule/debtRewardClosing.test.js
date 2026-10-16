'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { settleDebtRewards } = require('./debtRewardClosing');

test('settlement awaits final penalties before freezing rewards and publishing an update',async()=>{
  const calls=[];
  const months=await settleDebtRewards({}, { finalizePenalties:async()=>{calls.push('penalties');},
    rewardService:{finalizePendingMonths:async()=>{calls.push('rewards');return ['2026-10'];}},
    notify:()=>calls.push('notify') });
  assert.deepEqual(calls,['penalties','rewards','notify']);assert.deepEqual(months,['2026-10']);
});
test('failed ledger settlement never closes or announces rewards',async()=>{
  let ran=false;
  await assert.rejects(settleDebtRewards({}, {finalizePenalties:async()=>{throw Error('ledger');},
    rewardService:{finalizePendingMonths:async()=>{ran=true;}},notify:()=>{ran=true;}}),/ledger/);
  assert.equal(ran,false);
});
