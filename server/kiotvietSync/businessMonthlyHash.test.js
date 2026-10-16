'use strict';
process.env.NODE_ENV = 'production';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{}';
process.env.JWT_SECRET = 'test-only';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { seed } = require('../businessReport/testFixtures');
const sql = require('../businessReport/businessMonthlySql');
const job = require('./businessMonthlyRefresh');

test('canonical customer id: trimmed code, branch, name fallback and missing', async () => {
  const db = new PGlite();
  try {
    await seed(db);
    await db.exec(`INSERT INTO customers VALUES ('hanoi',99,' KH1 ','New','{}');
      INSERT INTO invoices VALUES ('saigon',119,'HD19','2026-09-12+00',10,1,'{"statusValue":"Hoàn thành","customerCode":"KH1"}'),
        ('hanoi',120,'HD20','2026-09-12+00',10,1,'{"statusValue":"Hoàn thành","customerCode":"MISSING"}'),
        ('saigon',121,'HD21','2026-09-12+00',10,1,'{"statusValue":"Hoàn thành"}');`);
    await db.query(sql.FREEZE_CUSTOMER_SQL, [sql.BRANCH_CODES,'2026-09-01','2026-10-01']);
    const { rows } = await db.query('SELECT branch,customer_code,customer_id FROM business_monthly_customer_sales ORDER BY 1,2');
    assert.deepEqual(rows.map(r => [r.branch,r.customer_code,r.customer_id]), [
      ['hanoi','KH1',99], ['hanoi','KH2',3], ['hanoi','MISSING',null], ['saigon','',null], ['saigon','KH1',2]
    ]);
  } finally { await db.close(); }
});

test('persistent hash: no states, restart skip, effective canonical groups, rollback and refreeze', async () => {
  const db = new PGlite(); const calls = []; let fail = false; let failHash = false;
  const client = { query: async (text,params) => {
    calls.push(text);
    if (fail && text === sql.REBUILD_SALE_SQL) throw new Error('rebuild failed');
    if (failHash && text.startsWith('UPDATE business_monthly_state SET group_hash')) throw new Error('hash update failed');
    return db.query(text,params);
  }, release() {} };
  const pool = { connect: async () => client, query: client.query };
  const count = () => calls.filter(t => t === sql.REBUILD_SALE_SQL).length;
  const hash = async () => (await db.query('SELECT group_hash FROM business_monthly_state')).rows[0].group_hash;
  try {
    await seed(db);
    await job.rebuildSaleTable(pool);
    assert.equal(count(),0);
    await job.freezeMonth(pool,'2026-09-01',{log() {}});
    await job.rebuildSaleTable(pool);
    const firstHash = await hash(); assert.ok(firstHash);
    const firstCount = count();
    await job.rebuildSaleTable(pool);
    assert.equal(count(),firstCount);
    await db.exec(`INSERT INTO customers VALUES ('hanoi',0,' KH1 ','Old','{"groups":"Ignored"}');
      UPDATE customers SET raw='{"groups":" Khang ","comments":"Other"}' WHERE id=1;
      UPDATE customers SET raw='{"groups":"   "}' WHERE id=3;`);
    await job.rebuildSaleTable(pool);
    assert.equal(count(),firstCount);
    await db.exec(`UPDATE customers SET raw='{"groups":"New"}' WHERE id=1`);
    fail = true;
    await assert.rejects(job.rebuildSaleTable(pool),/rebuild failed/);
    assert.equal(await hash(),firstHash);
    assert.equal((await db.query("SELECT net_revenue::float8 v FROM business_monthly_sale_sales WHERE sale_name='Khang'")).rows[0].v,810);
    fail = false;
    failHash = true;
    await assert.rejects(job.rebuildSaleTable(pool),/hash update failed/);
    assert.equal(await hash(),firstHash);
    assert.equal((await db.query("SELECT net_revenue::float8 v FROM business_monthly_sale_sales WHERE sale_name='Khang'")).rows[0].v,810);
    failHash = false;
    await job.rebuildSaleTable(pool);
    assert.notEqual(await hash(),firstHash);
    assert.equal((await db.query("SELECT net_revenue::float8 v FROM business_monthly_sale_sales WHERE sale_name='New'")).rows[0].v,810);
    const afterChange = count();
    await job.freezeMonth(pool,'2026-09-01',{log() {}});
    await job.rebuildSaleTable(pool);
    assert.equal(count(),afterChange+1);
  } finally { await db.close(); }
});

test('freeze publication rolls back sale/hash failures and retries coherently', async () => {
 const db = new PGlite(); let failAt = sql.REBUILD_SALE_SQL; const calls=[];
 const client={query:async(q,p)=>{calls.push(q); if ([sql.FREEZE_CUSTOMER_SQL,sql.FREEZE_CUSTOMER_PRODUCT_SQL,sql.GROUP_HASH_SQL,sql.REBUILD_SALE_SQL].includes(q)) assert.equal((await db.query('SHOW transaction_isolation')).rows[0].transaction_isolation, 'repeatable read'); if(q===failAt || (failAt==='hash' && q.startsWith('UPDATE business_monthly_state SET group_hash'))) throw new Error('publication failed'); return db.query(q,p);},release(){}};
 const pool={connect:async()=>client,query:client.query};
 try {
  await seed(db);
  for (const failure of [sql.REBUILD_SALE_SQL,'hash']) {
   failAt=failure;
   await assert.rejects(job.freezeMonth(pool,'2026-09-01',{log(){}}),/publication failed/);
   for(const table of ['state','customer_sales','customer_product_sales','product_sales','sale_sales']) assert.equal((await db.query(`SELECT count(*)::int n FROM business_monthly_${table}`)).rows[0].n,0);
  }
  failAt=null;
  await job.freezeMonth(pool,'2026-09-01',{log(){}});
  assert.equal(calls[0],'BEGIN ISOLATION LEVEL REPEATABLE READ');
  assert.ok(!calls.some(q=>/^LOCK TABLE customers/.test(q)));
  const state=(await db.query('SELECT group_hash,net_revenue FROM business_monthly_state')).rows[0];
  assert.equal(state.group_hash,(await db.query(sql.GROUP_HASH_SQL)).rows[0].group_hash);
  for(const table of ['customer_sales','product_sales','sale_sales']) assert.equal(Number((await db.query(`SELECT sum(net_revenue) n FROM business_monthly_${table}`)).rows[0].n),Number(state.net_revenue));
  calls.length=0; await job.rebuildSaleTable(pool);
  assert.equal(calls[0],'BEGIN ISOLATION LEVEL REPEATABLE READ');
  assert.ok(!calls.includes(sql.REBUILD_SALE_SQL));
 }finally{await db.close();}
});
