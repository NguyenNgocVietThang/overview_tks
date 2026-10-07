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
