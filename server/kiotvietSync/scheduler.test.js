'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPollingScheduler } = require('./scheduler');

test('disabled scheduler creates no timers and touches no configuration, API, database, or rollup dependency', () => {
  let touched = 0;
  const scheduler = createPollingScheduler({
    enabled:false, cashbookEnabled:false, getConfiguredBranches:()=>{touched++;}, setIntervalFn:()=>{touched++;},
    getPool:()=>{touched++;}, startDashboardRollupSchedule:()=>{touched++;}
  });
  assert.deepEqual(scheduler.startPollingScheduler(), []);
  assert.equal(touched, 0);
});

test('scheduler creates independent fast and slow timers at configured intervals, plus a dashboard-rollup, customer-debt-report, product-report, customer-invoice-lines, inventory-value-snapshot and business-monthly schedule', () => {
  const timers = [];
  const immediate = [];
  const rollupCalls = [];
  const debtReportCalls = [];
  const productReportCalls = [];
  const invoiceLinesCalls = [];
  const inventorySnapshotCalls = [];
  const businessMonthlyCalls = [];
  const scheduler = createPollingScheduler({
    enabled:true, fastIntervalMs:7, slowIntervalMs:20, dashboardRollupIntervalMs:300000, customerDebtReportIntervalMs:300000, productReportIntervalMs:300000, customerInvoiceLinesIntervalMs:300000, inventoryValueSnapshotIntervalMs:60000, businessMonthlyIntervalMs:300000,
    getConfiguredBranches:()=>[], setIntervalFn:(fn,ms)=>(timers.push({fn,ms}),ms),
    scheduleImmediate:(fn)=>immediate.push(fn),
    getPool:()=>'fake-pool',
    startDashboardRollupSchedule:(pool,opts)=>{rollupCalls.push({pool,...opts}); return 'rollup-handle';},
    startCustomerDebtReportRefreshSchedule:(pool,opts)=>{debtReportCalls.push({pool,...opts}); return 'debt-report-handle';},
    startProductReportSchedule:(pool,opts)=>{productReportCalls.push({pool,...opts}); return 'product-report-handle';},
    startCustomerInvoiceLinesSchedule:(pool,opts)=>{invoiceLinesCalls.push({pool,...opts}); return 'invoice-lines-handle';},
    startInventoryValueSnapshotSchedule:(pool,opts)=>{inventorySnapshotCalls.push({pool,...opts}); return 'inventory-snapshot-handle';},
    startBusinessMonthlySchedule:(pool,opts)=>{businessMonthlyCalls.push({pool,...opts}); return 'business-monthly-handle';}
  });
  assert.deepEqual(scheduler.startPollingScheduler(), [7,20,86400000,60000,'rollup-handle','debt-report-handle','product-report-handle','invoice-lines-handle','inventory-snapshot-handle','business-monthly-handle']);
  assert.deepEqual(timers.map((x)=>x.ms), [7,20,86400000,60000]);
  assert.equal(immediate.length, 1);
  assert.equal(rollupCalls.length, 1);
  assert.equal(rollupCalls[0].pool, 'fake-pool');
  assert.equal(rollupCalls[0].intervalMs, 300000);
  // Ca 5 lich con deu phai nhan scheduleImmediate de con chay ngay luc khoi dong.
  assert.equal(typeof rollupCalls[0].scheduleImmediate, 'function');
  assert.equal(typeof debtReportCalls[0].scheduleImmediate, 'function');
  assert.equal(typeof productReportCalls[0].scheduleImmediate, 'function');
  assert.equal(typeof invoiceLinesCalls[0].scheduleImmediate, 'function');
  assert.equal(typeof inventorySnapshotCalls[0].scheduleImmediate, 'function');
  assert.equal(typeof businessMonthlyCalls[0].scheduleImmediate, 'function');
  assert.equal(debtReportCalls.length, 1);
  assert.equal(debtReportCalls[0].pool, 'fake-pool');
  assert.equal(debtReportCalls[0].intervalMs, 300000);
  assert.equal(productReportCalls.length, 1);
  assert.equal(productReportCalls[0].pool, 'fake-pool');
  assert.equal(productReportCalls[0].intervalMs, 300000);
  assert.equal(invoiceLinesCalls.length, 1);
  assert.equal(invoiceLinesCalls[0].pool, 'fake-pool');
  assert.equal(invoiceLinesCalls[0].intervalMs, 300000);
  assert.equal(inventorySnapshotCalls.length, 1);
  assert.equal(inventorySnapshotCalls[0].pool, 'fake-pool');
  assert.equal(inventorySnapshotCalls[0].intervalMs, 60000);
  assert.equal(businessMonthlyCalls.length, 1);
  assert.equal(businessMonthlyCalls[0].pool, 'fake-pool');
  assert.equal(businessMonthlyCalls[0].intervalMs, 300000);
});

test('cashbook-only sync runs both branches on its own timer while other jobs remain disabled', async () => {
  const timers = [], immediate = [], calls = [];
  const scheduler = createPollingScheduler({
    enabled: false, cashbookEnabled: true, cashbookIntervalMs: 60000,
    getConfiguredBranches: () => [{ branch: 'hanoi' }, { branch: 'saigon' }],
    createKiotVietClient: () => ({}), pollEntityOnce: async (_api, branch, entity) => calls.push(`${branch}:${entity.entity}`),
    setIntervalFn: (fn, ms) => (timers.push({ fn, ms }), ms), scheduleImmediate: fn => immediate.push(fn),
    getPool: () => ({ query: async () => ({ rows: [{ id: 1 }] }) }),
    startDashboardRollupSchedule: () => { throw Error('unrelated rollup'); }
  });
  scheduler.startPollingScheduler();
  immediate[0]();
  await new Promise(r => setImmediate(r));
  assert.deepEqual(calls.sort(), ['hanoi:cash_flows', 'saigon:cash_flows']);
  calls.length = 0;
  await timers.find(t => t.ms === 60000).fn();
  assert.deepEqual(calls.sort(), ['hanoi:cash_flows', 'saigon:cash_flows']);
  assert.deepEqual(timers.map(t => t.ms).sort((a,b) => a-b), [60000, 86400000]);
});

test('cash flow synchronization is excluded from the slow group and overlapping cashbook ticks are skipped', async () => {
  const timers = [], calls = [];
  let finish, hold = false;
  const scheduler = createPollingScheduler({
    enabled: true, cashbookIntervalMs: 60000,
    getConfiguredBranches: () => [{ branch: 'hanoi' }], createKiotVietClient: () => ({}),
    pollEntityOnce: async (_api, _branch, entity) => {
      calls.push(entity.entity);
      if (hold && entity.entity === 'cash_flows') await new Promise(r => { finish = r; });
    },
    setIntervalFn: (fn, ms) => (timers.push({ fn, ms }), ms), scheduleImmediate: () => {},
    getPool: () => ({}), startDashboardRollupSchedule: () => {}, startCustomerDebtReportRefreshSchedule: () => {},
    startProductReportSchedule: () => {}, startCustomerInvoiceLinesSchedule: () => {}, startInventoryValueSnapshotSchedule: () => {},
    startBusinessMonthlySchedule: () => {}
  });
  scheduler.startPollingScheduler();
  await timers[1].fn();
  assert.ok(!calls.includes('cash_flows'));
  hold = true;
  const timer = timers.find(t => t.ms === 60000);
  const pending = timer.fn();
  await new Promise(r => setImmediate(r));
  await timer.fn();
  assert.equal(calls.filter(x => x === 'cash_flows').length, 1);
  finish(); await pending;
});

test('scheduler schedules an immediate background catch-up from persisted checkpoints', async () => {
  const immediate = [];
  const calls = [];
  const hotRollups = [];
  const scheduler = createPollingScheduler({
    enabled:true,
    getConfiguredBranches:()=>[{branch:'hanoi',clientId:'1',clientSecret:'2',retailer:'hn'}],
    createKiotVietClient:()=>({}),
    pollEntityOnce:async (_api,branch,entity)=>calls.push(`${branch}:${entity.entity}`),
    setIntervalFn:()=>({}),
    scheduleImmediate:(fn)=>immediate.push(fn),
    getPool:()=>({query:async()=>({rows:[{id:1}]})}),
    refreshDashboardRollupsAndNotify:async (_pool,opts)=>{hotRollups.push(opts);},
    startDashboardRollupSchedule:()=>({}),
    startCustomerDebtReportRefreshSchedule:()=>({}),
    startProductReportSchedule:()=>({}),
    startCustomerInvoiceLinesSchedule:()=>({}),
    startInventoryValueSnapshotSchedule:()=>({}),
    startBusinessMonthlySchedule:()=>({})
  });

  scheduler.startPollingScheduler();
  assert.equal(immediate.length, 1);
  immediate[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(calls.includes('hanoi:invoices'));
  assert.ok(calls.includes('hanoi:cash_flows'));
});

test('moi luot sync fast keo theo mot luot rollup "nong" ngay sau do', async () => {
  const timers = [];
  const order = [];
  const scheduler = createPollingScheduler({
    enabled:true,
    getConfiguredBranches:()=>[{branch:'hanoi',clientId:'1',clientSecret:'2',retailer:'hn'}],
    createKiotVietClient:()=>({}),
    pollEntityOnce:async (_api,branch,entity)=>order.push(`sync:${entity.entity}`),
    setIntervalFn:(fn,ms)=>(timers.push({fn,ms}),ms),
    scheduleImmediate:()=>{},
    getPool:()=>'fake-pool',
    refreshDashboardRollupsAndNotify:async (pool,opts)=>{order.push(`rollup:${pool}:${opts.windowDays}:${opts.includeFirstPurchase}`);},
    startDashboardRollupSchedule:()=>'rollup-handle',
    startCustomerDebtReportRefreshSchedule:()=>'debt-handle',
    startProductReportSchedule:()=>'product-handle',
    startCustomerInvoiceLinesSchedule:()=>'invoice-lines-handle',
    startInventoryValueSnapshotSchedule:()=>'inventory-snapshot-handle',
    startBusinessMonthlySchedule:()=>'business-monthly-handle'
  });

  scheduler.startPollingScheduler();
  await timers[0].fn(); // nhip fast

  assert.ok(order.includes('sync:invoices'));
  // Rollup phai chay SAU khi sync xong, neu khong thi van tong hop du lieu cu.
  assert.equal(order[order.length - 1], 'rollup:fake-pool:7:false');
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
    refreshDashboardRollupsAndNotify:async ()=>{},
    startDashboardRollupSchedule:()=>'rollup-handle'
  });
  scheduler.startPollingScheduler();
  await timers[0].fn();
  assert.ok(calls.includes('saigon:orders'));
  assert.deepEqual(failures, [['hanoi','invoices','down']]);
});

function bankScheduler({empty=true,queryError=false,clientError=false,pollError=false,recordError=false}={}) {
 const timers=[],immediate=[],calls=[],failures=[],errors=[];
 const scheduler=createPollingScheduler({enabled:true,getConfiguredBranches:()=>[{branch:'hanoi'},{branch:'saigon'}],
 createKiotVietClient:b=>{if(clientError&&b.branch==='hanoi')throw Error('client');return {};},
 pollEntityOnce:async(_a,b,e)=>{calls.push(b+':'+e.entity);if(pollError&&b==='hanoi'&&e.entity==='cash_book_accounts')throw Error('poll');},
 recordFailure:async(...args)=>{failures.push(args);if(recordError)throw Error('record');},
 setIntervalFn:(fn,ms)=>(timers.push({fn,ms}),ms),scheduleImmediate:fn=>immediate.push(fn),
 getPool:()=>({query:async()=>{if(queryError)throw Error('database');return {rows:empty?[]:[{id:1}]};}}),
 refreshDashboardRollupsAndNotify:async()=>{},startDashboardRollupSchedule:()=>{},startCustomerDebtReportRefreshSchedule:()=>{},
 startProductReportSchedule:()=>{},startCustomerInvoiceLinesSchedule:()=>{},startInventoryValueSnapshotSchedule:()=>{},startBusinessMonthlySchedule:()=>{},
 logger:{log(){},warn(){},error:(...args)=>errors.push(args)}});
 scheduler.startPollingScheduler();return {timers,immediate,calls,failures,errors};
}
test('empty account catalog syncs both branches on startup; populated catalog waits for daily timer',async()=>{
 for(const empty of [true,false]) {
  const x=bankScheduler({empty});x.immediate[0]();await new Promise(r=>setImmediate(r));
  assert.deepEqual(x.calls.filter(c=>c.endsWith(':cash_book_accounts')),empty?['hanoi:cash_book_accounts','saigon:cash_book_accounts']:[]);
  const timer=x.timers.find(t=>t.ms===86400000);assert.ok(timer);await timer.fn();
  assert.ok(x.calls.includes('hanoi:cash_book_accounts'));assert.ok(x.calls.includes('saigon:cash_book_accounts'));
 }
});
test('bank sync contains startup database errors, client construction and checkpoint recording failures',async()=>{
 const db=bankScheduler({queryError:true});db.immediate[0]();await new Promise(r=>setImmediate(r));assert.ok(db.errors.length);
 for(const opts of [{clientError:true},{pollError:true,recordError:true}]){
  const x=bankScheduler(opts);const timer=x.timers.find(t=>t.ms===86400000);assert.ok(timer);await timer.fn();
  assert.ok(x.calls.includes('saigon:cash_book_accounts'));assert.ok(x.failures.some(f=>f[0]==='hanoi'&&f[1]==='cash_book_accounts'));
  if(opts.recordError)assert.ok(x.errors.length);
 }
});

test('one KiotViet client per branch per run so the cached OAuth token is reused across entities',async()=>{
 const created=[];
 const scheduler=createPollingScheduler({enabled:true,getConfiguredBranches:()=>[{branch:'hanoi'},{branch:'saigon'}],
 createKiotVietClient:b=>{created.push(b.branch);return {};},pollEntityOnce:async()=>{},recordFailure:async()=>{},
 setIntervalFn:(fn,ms)=>ms,scheduleImmediate:()=>{},getPool:()=>({query:async()=>({rows:[{id:1}]})}),
 refreshDashboardRollupsAndNotify:async()=>{},startDashboardRollupSchedule:()=>{},startCustomerDebtReportRefreshSchedule:()=>{},
 startProductReportSchedule:()=>{},startCustomerInvoiceLinesSchedule:()=>{},startInventoryValueSnapshotSchedule:()=>{},startBusinessMonthlySchedule:()=>{},
 logger:{log(){},warn(){},error(){}}});
 await scheduler.runGroup([{entity:'a'},{entity:'b'},{entity:'c'}]);
 assert.deepEqual(created.sort(),['hanoi','saigon']);
});
