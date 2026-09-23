'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPollingScheduler } = require('./scheduler');

test('disabled scheduler creates no timers and touches no configuration, API, database, or rollup dependency', () => {
  let touched = 0;
  const scheduler = createPollingScheduler({
    enabled:false, getConfiguredBranches:()=>{touched++;}, setIntervalFn:()=>{touched++;},
    getPool:()=>{touched++;}, startDashboardRollupSchedule:()=>{touched++;}
  });
  assert.deepEqual(scheduler.startPollingScheduler(), []);
  assert.equal(touched, 0);
});

test('scheduler creates independent fast and slow timers at configured intervals, plus a dashboard-rollup, customer-debt-report and product-report schedule', () => {
  const timers = [];
  const immediate = [];
  const rollupCalls = [];
  const debtReportCalls = [];
  const productReportCalls = [];
  const scheduler = createPollingScheduler({
    enabled:true, fastIntervalMs:7, slowIntervalMs:20, dashboardRollupIntervalMs:300000, customerDebtReportIntervalMs:300000, productReportIntervalMs:300000,
    getConfiguredBranches:()=>[], setIntervalFn:(fn,ms)=>(timers.push({fn,ms}),ms),
    scheduleImmediate:(fn)=>immediate.push(fn),
    getPool:()=>'fake-pool',
    startDashboardRollupSchedule:(pool,opts)=>{rollupCalls.push({pool,...opts}); return 'rollup-handle';},
    startCustomerDebtReportRefreshSchedule:(pool,opts)=>{debtReportCalls.push({pool,...opts}); return 'debt-report-handle';},
    startProductReportSchedule:(pool,opts)=>{productReportCalls.push({pool,...opts}); return 'product-report-handle';}
  });
  assert.deepEqual(scheduler.startPollingScheduler(), [7,20,'rollup-handle','debt-report-handle','product-report-handle']);
  assert.deepEqual(timers.map((x)=>x.ms), [7,20]);
  assert.equal(immediate.length, 1);
  assert.equal(rollupCalls.length, 1);
  assert.equal(rollupCalls[0].pool, 'fake-pool');
  assert.equal(rollupCalls[0].intervalMs, 300000);
  assert.equal(debtReportCalls.length, 1);
  assert.equal(debtReportCalls[0].pool, 'fake-pool');
  assert.equal(debtReportCalls[0].intervalMs, 300000);
  assert.equal(productReportCalls.length, 1);
  assert.equal(productReportCalls[0].pool, 'fake-pool');
  assert.equal(productReportCalls[0].intervalMs, 300000);
});

test('scheduler schedules an immediate background catch-up from persisted checkpoints', async () => {
  const immediate = [];
  const calls = [];
  const scheduler = createPollingScheduler({
    enabled:true,
    getConfiguredBranches:()=>[{branch:'hanoi',clientId:'1',clientSecret:'2',retailer:'hn'}],
    createKiotVietClient:()=>({}),
    pollEntityOnce:async (_api,branch,entity)=>calls.push(`${branch}:${entity.entity}`),
    setIntervalFn:()=>({}),
    scheduleImmediate:(fn)=>immediate.push(fn),
    getPool:()=>({}),
    startDashboardRollupSchedule:()=>({}),
    startCustomerDebtReportRefreshSchedule:()=>({}),
    startProductReportSchedule:()=>({})
  });

  scheduler.startPollingScheduler();
  assert.equal(immediate.length, 1);
  immediate[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(calls.includes('hanoi:invoices'));
  assert.ok(calls.includes('hanoi:cash_flows'));
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
    setIntervalFn:(fn,ms)=>(timers.push({fn,ms}),ms),
    scheduleImmediate:()=>{},
    getPool:()=>'fake-pool',
    startDashboardRollupSchedule:()=>'rollup-handle'
  });
  scheduler.startPollingScheduler();
  await timers[0].fn();
  assert.ok(calls.includes('saigon:orders'));
  assert.deepEqual(failures, [['hanoi','invoices','down']]);
});
