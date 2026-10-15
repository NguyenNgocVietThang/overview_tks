'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { createDebtRewardService } = require('./debtRewardService');
const { createDebtScheduleRepository } = require('./debtScheduleRepository');
const { takeDebtCycleSnapshot } = require('./debtCycleSnapshot');
const { finalizePendingPenaltyCycles } = require('./debtPenaltyLedger');
const businessSql = require('../businessReport/businessMonthlySql');


async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE customers(branch text,id bigint,code text,name text,debt numeric,raw jsonb,PRIMARY KEY(branch,id));
    CREATE TABLE invoices(branch text,id bigint,code text,customer_id bigint,purchase_date timestamptz,total numeric,status int,raw jsonb);
    CREATE TABLE returns(branch text,id bigint,code text,customer_id bigint,return_date timestamptz,total numeric,raw jsonb);`);
  for (const file of ['0036_business_monthly_sales.sql','0047_debt_schedule_report.sql','0048_debt_penalty.sql',
    '0050_debt_cycle_manual_refresh.sql','0051_debt_penalty_ledger.sql','0052_debt_reward_months.sql']) {
    await db.exec(fs.readFileSync(path.join(__dirname,'../db/migrations',file),'utf8'));
  }
  const pool = {query:(s,p)=>db.query(s,p),connect:async()=>({query:(s,p)=>db.query(s,p),release(){}})};
  let instant = new Date('2026-10-14T09:00:00Z');
  const now=()=>instant;
  const repository=createDebtScheduleRepository({pool});
  const service=createDebtRewardService({pool,repository,now});
  for (const [branch,sale] of [['hanoi','An'],['saigon','Bình']]) for(let n=1;n<=6;n++) {
    await db.query('INSERT INTO customers VALUES ($1,$2,$3,$4,0,$5)',[branch,n,`KH${n}`,`${sale} khách ${n}`,JSON.stringify({groups:sale})]);
    for(let i=1;i<=5;i++) await db.query(`INSERT INTO invoices VALUES ($1,$2,$3,$4,'2026-10-10 12:00:00Z',6000000,1,$5)`,
      [branch,n*10+i,`HD${n}-${i}`,n,JSON.stringify({customerCode:`KH${n}`,statusValue:'Hoàn thành'})]);
  }
  const snapshot=async date=>takeDebtCycleSnapshot(pool,date,{log(){},takenAt:new Date(`${date}T08:00:00Z`),loadAverages:async()=>({branches:[],codes:[],values:[]})});
  await snapshot('2026-10-14');
  return {db,pool,repository,service,snapshot,setNow:value=>{instant=new Date(value);}};
}

test('real monthly SQL counts completed invoices, net returns and debt-free customers from both branches',async()=>{
  const f=await setup();try {
    await f.db.query(`INSERT INTO returns VALUES ('saigon',1,'TH1',1,'2026-10-12Z',1000000,'{"customerCode":"KH1","statusValue":"Đã trả"}')`);
    await f.db.query(`INSERT INTO invoices VALUES ('hanoi',999,'CANCEL',1,'2026-10-10Z',9000000000,2,'{"customerCode":"KH1","statusValue":"Đã hủy"}')`);
    const b=await f.service.readBoard();
    assert.equal(b.rows.find(r=>r.sale==='An').points,30);
    assert.equal(b.rows.find(r=>r.sale==='Bình').points,29);
    assert.equal(b.rows.find(r=>r.sale==='An').scoreCustomers[0].invoiceCount,5);
    assert.equal(b.summary.recipientCount,0);assert.equal(b.rows.find(r=>r.sale==='An').reward,null);
    assert.equal(b.summary.pool,null);assert.equal(b.summary.allocatedReward,null);
    assert.equal(b.coverage.complete,false);assert.ok(b.coverage.missingDays.includes('2026-10-01'));
  } finally {await f.db.close();}
});

test('monthly board sums sealed days only and branch filtering preserves global ranking',async()=>{
  const f=await setup();try {
    await f.repository.savePenalty({branch:'hanoi',customerId:'1',amount:90000,user:{hoTen:'QL'}});
    assert.equal((await f.service.readBoard()).rows.find(r=>r.sale==='An').grossPenalty,0);
    await f.snapshot('2026-10-15');f.repository.bumpVersion();
    await finalizePendingPenaltyCycles(f.pool,{repository:f.repository,log(){}});
    const all=await f.service.readBoard();const one=await f.service.readBoard({branches:['hanoi']});
    assert.equal(one.rows.length,1);assert.equal(one.rows[0].rank,2);assert.deepEqual(one.summary,all.summary);
    await f.repository.savePenalty({branch:'hanoi',customerId:'1',amount:120000,user:{hoTen:'QL'}});
    const board=await f.service.readBoard();
    assert.equal(board.rows.find(r=>r.sale==='An').grossPenalty,90000);
    assert.equal(board.lastPenaltyDate,'2026-10-14');
  } finally {await f.db.close();}
});

test('month closes after next-month snapshot, final ledger and frozen sales; remains immutable after edits',async()=>{
  const f=await setup();try {
    await f.repository.savePenalty({branch:'hanoi',customerId:'1',amount:90000,user:{hoTen:'QL'}});
    await f.snapshot('2026-10-15'); f.repository.bumpVersion();
    await finalizePendingPenaltyCycles(f.pool,{repository:f.repository,log(){}});
    await f.snapshot('2026-10-31'); f.repository.bumpVersion();
    f.setNow('2026-11-01T07:59:00Z');
    assert.deepEqual(await f.service.finalizePendingMonths(),[]);
    await f.snapshot('2026-11-01');f.repository.bumpVersion();f.setNow('2026-11-01T08:01:00Z');
    await assert.rejects(f.service.finalizePendingMonths(),/phạt|penalty/i);
    await finalizePendingPenaltyCycles(f.pool,{repository:f.repository,log(){}});
    await assert.rejects(f.service.finalizePendingMonths(),/doanh số|sales/i);
    await f.pool.query(businessSql.FREEZE_CUSTOMER_SQL,[['hanoi','saigon'],'2026-10-01','2026-11-01']);
    await f.db.exec("INSERT INTO business_monthly_state(month) VALUES ('2026-10-01')");
    assert.deepEqual(await f.service.finalizePendingMonths(),['2026-10']);
    const closed=await f.service.readBoard({month:'2026-10'});
    assert.equal(closed.status,'finalized');assert.equal(closed.rows.find(r=>r.sale==='An').grossPenalty,90000);
    assert.equal(closed.rows.find(r=>r.sale==='An').points,30);
    assert.equal(closed.rows.reduce((sum,r)=>sum+r.reward,0),3000000);
    await f.db.exec("UPDATE customers SET raw='{}'; DELETE FROM business_monthly_customer_sales; DELETE FROM debt_cycle_runs;");
    const unchanged=await f.service.readBoard({month:'2026-10'});
    assert.deepEqual(unchanged.rows,closed.rows);assert.deepEqual(unchanged.summary,closed.summary);
    assert.deepEqual(await f.service.finalizePendingMonths(),[]);
  } finally {await f.db.close();}
});

test('invalid, future and unavailable history months fail clearly instead of fabricating rewards',async()=>{
  const f=await setup();try {
    await assert.rejects(f.service.readBoard({month:'2026-13'}),e=>e.statusCode===400);
    await assert.rejects(f.service.readBoard({month:'2026-11'}),e=>e.statusCode===400);
    await assert.rejects(f.service.readBoard({month:'2026-09'}),e=>e.statusCode===404);
  } finally {await f.db.close();}
});

test('customer reassignment refreshes points without adding live penalties to monthly totals',async()=>{
  const f=await setup();try {
    await f.repository.savePenalty({branch:'hanoi',customerId:'1',amount:90000,user:{hoTen:'QL'}});
    assert.equal((await f.service.readBoard()).rows.find(r=>r.sale==='An').grossPenalty,0);
    await f.db.exec(`UPDATE customers SET raw='{"groups":"Chi"}' WHERE branch='hanoi'`);
    f.setNow('2026-10-14T09:01:01Z');
    const board=await f.service.readBoard();
    assert.equal(board.rows.find(r=>r.sale==='Chi').points,30);
    assert.equal(board.rows.find(r=>r.sale==='Chi').grossPenalty,0);
    assert.equal(board.rows.some(r=>r.sale==='An'),false);
  } finally {await f.db.close();}
});

test('a serialization conflict during monthly insert retries with a fresh transaction',async()=>{
  const f=await setup();try {
    await f.snapshot('2026-10-31'); f.repository.bumpVersion();
    await finalizePendingPenaltyCycles(f.pool,{repository:f.repository,log(){}});
    await f.snapshot('2026-11-01'); f.repository.bumpVersion(); f.setNow('2026-11-01T08:01:00Z');
    await finalizePendingPenaltyCycles(f.pool,{repository:f.repository,log(){}});
    await f.pool.query(businessSql.FREEZE_CUSTOMER_SQL,[['hanoi','saigon'],'2026-10-01','2026-11-01']);
    await f.db.exec("INSERT INTO business_monthly_state(month) VALUES ('2026-10-01')");
    const connect=f.pool.connect;let conflicts=0;
    f.pool.connect=async()=>{const client=await connect();return {...client,query:async(s,p)=>{
      if(s.includes('INSERT INTO debt_reward_months')&&!conflicts++)throw Object.assign(Error('concurrent close'),{code:'40001'});
      return client.query(s,p);
    }};};
    let notices=0;
    assert.deepEqual(await f.service.finalizePendingMonths({onClosed:()=>notices++}),['2026-10']);
    assert.equal(notices,1);
    assert.deepEqual(await f.service.finalizePendingMonths(),[]);
    assert.equal((await f.db.query('SELECT COUNT(*)::int AS count FROM debt_reward_months')).rows[0].count,1);
  } finally {await f.db.close();}
});
