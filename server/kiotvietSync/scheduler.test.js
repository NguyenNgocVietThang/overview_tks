'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPollingScheduler } = require('./scheduler');

test('disabled scheduler creates no timers and touches no configuration, API, or database dependency', () => {
  let touched = 0;
  const scheduler = createPollingScheduler({ enabled:false, getConfiguredBranches:()=>{touched++;}, setIntervalFn:()=>{touched++;} });
  assert.deepEqual(scheduler.startPollingScheduler(), []);
  assert.equal(touched, 0);
});

test('scheduler creates independent fast and slow timers at configured intervals', () => {
  const timers = [];
  const scheduler = createPollingScheduler({ enabled:true, fastIntervalMs:7, slowIntervalMs:20, getConfiguredBranches:()=>[], setIntervalFn:(fn,ms)=>(timers.push({fn,ms}),ms) });
  assert.deepEqual(scheduler.startPollingScheduler(), [7,20]);
  assert.deepEqual(timers.map((x)=>x.ms), [7,20]);
});

test('one branch/entity failure is recorded without blocking other work', async () => {
  const timers = [];
  const calls = [];
  const failures = [];
  const scheduler = createPollingScheduler({
    enabled:true, getConfiguredBranches:()=>[
      {branch:'hanoi',clientId:'1',clientSecret:'2',retailer:'hn'},
      {branch:'saigon',clientId:'3',clientSecret:'4',retailer:'sg'}
    ],
    createKiotVietClient:(config)=>({branch:config.retailer}),
    pollEntityOnce:async (_api,branch,entity)=>{ calls.push(`${branch}:${entity.entity}`); if(branch==='hanoi'&&entity.entity==='invoices') throw new Error('down'); },
    recordFailure:async (...args)=>failures.push(args),
    setIntervalFn:(fn,ms)=>(timers.push({fn,ms}),ms)
  });
  scheduler.startPollingScheduler();
  await timers[0].fn();
  assert.ok(calls.includes('saigon:orders'));
  assert.deepEqual(failures, [['hanoi','invoices','down']]);
});
