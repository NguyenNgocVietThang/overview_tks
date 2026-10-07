'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const entity = require('./cashFlows');
test('cash flows have a dedicated date-window shape and preserve receipt direction', async () => {
  const item = { Id: 14, Code: 'PT14', IsReceipt: false, Amount: 20, Method: 'Bank', CustomerId: 1, SupplierId: 2, UserId: 3, Description: 'x', TransDate: 't', CreatedDate: 'c' };
  const calls=[];
  await entity.upsertPage({query:async(...args)=>calls.push(args)},'hanoi',[item]);
  const cash=calls.find((call)=>call[0].includes('INSERT INTO cash_flows'));
  assert.deepEqual(cash[1], ['hanoi',14,'PT14',false,20,'Bank',1,2,3,'x','t','c',null,null,item]);
});
test('cash flows infer staff from UserId in the same transaction client', async () => {
  const calls=[];
  await entity.upsertPage({query:async(...args)=>calls.push(args)},'saigon',[{Id:1,IsReceipt:true,UserId:77,UserName:'Thu'}]);
  const staff=calls.find((call)=>call[0].includes('INSERT INTO staff'));
  assert.deepEqual(staff[1],['saigon',77,'Thu']);
});

test('cash flows preserve signed payments, historical account IDs and zero paid status', async () => {
  for (const item of [{id:2,amount:-25.5,accountId:-1,status:0},{Id:3,Amount:40,AccountId:123,Status:1}]) {
    const calls=[];
    await entity.upsertPage({query:async(...args)=>calls.push(args)},'hanoi',[item]);
    const [sql,params]=calls[0];
    assert.match(sql,/account_id=EXCLUDED.account_id/);
    assert.match(sql,/status=EXCLUDED.status/);
    assert.deepEqual(params.slice(-3,-1),item.id?[-1,0]:[123,1]);
    assert.equal(params[4],item.amount??item.Amount);
  }
});

test('cash flow timestamps without zone are Vietnamese local time; explicit zones stay intact', async()=>{
  for(const [input,want] of [['2026-10-06T16:52:56.3600000','2026-10-06T16:52:56.3600000+07:00'],['2026-10-06T09:52:56.360Z','2026-10-06T09:52:56.360Z']]){
    const calls=[];
    await entity.upsertPage({query:async(...args)=>calls.push(args)},'hanoi',[{id:22,IsReceipt:false,amount:-60,transDate:input}]);
    assert.equal(calls[0][1][10],want);
  }
});

test('reconciliation repairs stale account/status/time projections and skips identical rows',async()=>{
  const {PGlite}=require('@electric-sql/pglite');const db=new PGlite();
  try {
    await db.exec(`CREATE TABLE cash_flows(branch text,id bigint,code text,is_receipt boolean,amount numeric,method text,customer_id bigint,supplier_id bigint,user_id bigint,description text,trans_date timestamptz,created_date timestamptz,account_id bigint,status int,raw jsonb,synced_at timestamptz DEFAULT now(),PRIMARY KEY(branch,id));`);
    await db.exec(require('node:fs').readFileSync(require('node:path').join(__dirname,'../../db/migrations/0035_cash_flows_source_presence.sql'),'utf8'));
    const item={id:1,code:'TT1',IsReceipt:true,amount:20,method:'Transfer',accountId:7,status:1,transDate:'2026-10-06T23:50:00.0000000'};
    await db.query("INSERT INTO cash_flows(branch,id,raw,trans_date) VALUES('hanoi',1,$1,'2026-10-06T23:50:00Z')",[item]);
    const client={query:(sql,params)=>db.query(sql,params)};
    await entity.reconcilePage(client,'hanoi',[item]);
    const row=(await db.query('SELECT * FROM cash_flows')).rows[0];
    assert.equal(row.account_id,7);assert.equal(row.status,1);
    assert.equal(new Date(row.trans_date).toISOString(),'2026-10-06T16:50:00.000Z');
    await db.query("UPDATE cash_flows SET synced_at='2000-01-01T00:00:00Z'");
    await entity.reconcilePage(client,'hanoi',[item]);
    assert.equal(new Date((await db.query('SELECT synced_at FROM cash_flows')).rows[0].synced_at).toISOString(),'2000-01-01T00:00:00.000Z');
    await entity.reconcilePage(client,'hanoi',[{...item,amount:30,status:0,accountId:8}]);
    const changed=(await db.query('SELECT account_id,status,amount FROM cash_flows')).rows[0];
    assert.deepEqual(changed,{account_id:8,status:0,amount:'30'});
    const batch=Array.from({length:101},(_,i)=>({...item,id:100+i,code:'TT'+(100+i),amount:i+1}));
    await entity.upsertPage(client,'saigon',batch);
    const total=(await db.query("SELECT COUNT(*)::int n,SUM(amount)::text total FROM cash_flows WHERE branch='saigon'")).rows[0];
    assert.deepEqual(total,{n:101,total:'5151'});
    await db.query("INSERT INTO cash_flows(branch,id,trans_date,raw) VALUES('hanoi',998,'2026-10-08T00:00:00Z','{}'),('hanoi',999,'2026-10-01T00:00:00Z','{}')");
    await entity.markMissing(client,'hanoi',['1'],'2026-10-07T00:00:00Z');
    assert.deepEqual((await db.query("SELECT id FROM cash_flows WHERE branch='hanoi' AND source_missing_at IS NULL ORDER BY id")).rows.map(x=>x.id),[1,998]);
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM cash_flows WHERE branch='hanoi'")).rows[0].n,3);
    await entity.upsertPage(client,'hanoi',[{...item,id:999}]);
    assert.equal((await db.query("SELECT source_missing_at FROM cash_flows WHERE branch='hanoi' AND id=999")).rows[0].source_missing_at,null);
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM cash_flows WHERE branch='saigon'")).rows[0].n,101);
  } finally {await db.close();}
});
