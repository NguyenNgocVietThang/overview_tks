const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { seed } = require('./testFixtures');
const { createRepository } = require('./businessReportRepository');
const svc = require('./businessReportService');
const now = () => new Date('2026-10-06T03:00:00Z');
test('missing migration preserves live reports, partial and complete history readiness', async () => {
 const db = new PGlite();
 try {
  await seed(db);
  const pool = { query: (q,p) => db.query(q,p), connect:async()=>({query:(q,p)=>db.query(q,p),release(){}}) };
  let snap = await createRepository({pool,now}).snapshot();
  assert.equal(snap.notReady, true);
  await db.exec(`INSERT INTO business_monthly_state(month) SELECT generate_series('2026-03-01'::date,'2026-09-01'::date,'1 month'::interval)`);
  snap = await createRepository({pool,now}).snapshot();
  assert.equal(snap.notReady, true);
  await db.exec("UPDATE business_monthly_state SET group_hash=md5('ready')");
  snap = await createRepository({pool,now}).snapshot();
  assert.equal(snap.notReady, false);
  await db.exec('DROP TABLE business_monthly_state, business_monthly_customer_sales, business_monthly_product_sales, business_monthly_sale_sales, business_monthly_customer_product_sales');
  snap = await createRepository({pool,now}).snapshot();
  for (const build of [svc.buildSaleReport,svc.buildCustomerReport,svc.buildProductReport]) {
   const report = build(snap);
   assert.equal(report.notReady,true);
   assert.equal(report.rows.reduce((sum,r)=>sum+r.current,0),500);
  }
 } finally {await db.close();}
});
test('live cutoff uses VN wall clock instant; future invoices and returns excluded',async()=>{
 const db = new PGlite();
 try {
  await seed(db);
  await db.exec(`INSERT INTO invoices VALUES ('hanoi',901,'NOW','2026-10-06 09:59:59+00',20,1,'{"statusValue":"Hoàn thành","customerCode":"KH1"}'), ('hanoi',902,'FUTURE','2026-10-06 10:00:01+00',900,1,'{"statusValue":"Hoàn thành","customerCode":"KH1"}'); INSERT INTO returns VALUES ('hanoi',903,'FUTURE','2026-10-06 10:00:01+00',100,1,'{"statusValue":"Đã trả","customerCode":"KH1"}')`);
  const snap = await createRepository({pool:{query:(q,p)=>db.query(q,p),connect:async()=>({query:(q,p)=>db.query(q,p),release(){}})},now}).snapshot();
  assert.equal(snap.customers.find(r=>r.month==='2026-10-01'&&r.customerCode==='KH1').netRevenue,520);
 }finally{await db.close();}
});
test('unrelated missing relations, permission and connection errors propagate',async()=>{
 for(const error of [Object.assign(new Error('relation "invoices" does not exist'),{code:'42P01'}),Object.assign(new Error('relation "business_monthly_state" does not exist'),{code:'42501'}),Object.assign(new Error('connection lost'),{code:'08006'})]) {
  const repo=createRepository({pool:{connect:async()=>({query:async q=>{if(q.startsWith('SELECT'))throw error;return {rows:[]};},release(){}})},now});
  await assert.rejects(()=>repo.snapshot(), e=>e===error);
 }
});

test('frontend readiness notice stays visible alongside usable report data and clears when ready',()=>{
 const fs=require('node:fs'); const vm=require('node:vm');
 const html=fs.readFileSync(require('node:path').join(__dirname,'../public/index.html'),'utf8');
 assert.match(html, /id="businessReadiness"[^>]*>Đang dựng dữ liệu tháng cũ…<\/span>/);
 const code=html.match(/      const notice = document.getElementById\('businessReadiness'\);\r?\n      notice.hidden = [^;]+;/)[0];
 const notice={hidden:true};
 const context={document:{getElementById:()=>notice}, BUSINESS_KINDS:['sales','customers','products'],state:{business:{data:{sales:{notReady:true,rows:[{current:500}]},customers:{notReady:true},products:{notReady:true}}}}};
 vm.runInNewContext(code,context); assert.equal(notice.hidden,false);
 for(const data of Object.values(context.state.business.data)) data.notReady=false;
 vm.runInNewContext(code,{...context}); assert.equal(notice.hidden,true);
 assert.equal(context.state.business.data.sales.rows[0].current,500);
});

test('missing detail snapshot table invalidates frozen state coherently', async()=>{
 const db=new PGlite();
 try {
  await seed(db);
  await db.exec("INSERT INTO business_monthly_state(month) VALUES('2026-09-01'); DROP TABLE business_monthly_customer_product_sales");
  const repo=createRepository({pool:{query:(q,p)=>db.query(q,p),connect:async()=>({query:(q,p)=>db.query(q,p),release(){}})},now});
  const snap=await repo.snapshot();
  assert.equal(snap.notReady,true); assert.deepEqual(snap.frozenMonths,[]);
  assert.equal((await repo.customerProducts({branch:'hanoi',customerCode:'KH1',months:['2026-09-01','2026-10-01']}))[0].revenue,950);
 }finally{await db.close();}
});

test('legacy pending hash retains frozen customer revenue and derives Sale defensively',async()=>{
 const db=new PGlite();
 try{
  await seed(db);
  const sql=require('./businessMonthlySql');
  await db.query(sql.FREEZE_CUSTOMER_SQL,[sql.BRANCH_CODES,'2026-09-01','2026-10-01']);
  await db.exec(`INSERT INTO business_monthly_state(month) SELECT generate_series('2026-03-01'::date,'2026-09-01'::date,'1 month'::interval); UPDATE invoices SET total=1900 WHERE id=101`);
  const snap=await createRepository({pool:{query:(q,p)=>db.query(q,p),connect:async()=>({query:(q,p)=>db.query(q,p),release(){}})},now}).snapshot();
  assert.equal(snap.notReady,true);
  assert.equal(snap.customers.filter(r=>r.month==='2026-09-01').reduce((s,r)=>s+r.netRevenue,0),1010);
  assert.equal(snap.sales.filter(r=>r.month==='2026-09-01').reduce((s,r)=>s+r.netRevenue,0),1010);
 }finally{await db.close();}
});

test('read snapshots use a short read-only repeatable-read transaction and recover missing tables',async()=>{
 const db=new PGlite(); const calls=[]; let poolQueries=0;
 const client={query:async(q,p)=>{calls.push(q);return db.query(q,p);},release(){calls.push('RELEASE_CLIENT');}};
 const pool={connect:async()=>client,query:async()=>{poolQueries++;throw new Error('independent snapshot query');}};
 try{
  await seed(db);
  await db.exec('DROP TABLE business_monthly_sale_sales');
  const snap=await createRepository({pool,now}).snapshot();
  assert.equal(snap.notReady,true); assert.equal(poolQueries,0);
  assert.ok(calls.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
  assert.ok(calls.includes('ROLLBACK TO SAVEPOINT business_report_read'));
  assert.ok(calls.includes('ROLLBACK')); assert.equal(calls.at(-1),'RELEASE_CLIENT');
  assert.equal(snap.customers.find(r=>r.month==='2026-09-01'&&r.customerCode==='KH1').netRevenue,810);
 }finally{await db.close();}
});

test('reader pins publication generation and paired live scans to one source snapshot',async()=>{
 const sql=require('./businessMonthlySql'); let generation=1; let pinned=null; let released=0;
 const pool={connect:async()=>({release(){released++;},query:async(q)=>{
  if(q==='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'){pinned=generation;return {rows:[]};}
  if(q==='ROLLBACK'){pinned=null;return {rows:[]};}
  if(/SAVEPOINT/.test(q)) return {rows:[]};
  assert.ok(pinned!==null,'all data reads must use transaction');
  if(/FROM business_monthly_state/.test(q)){generation=2;return {rows:['03','04','05','06','07','08','09'].map(m=>({month:`2026-${m}-01`,group_hash:'a'.repeat(32)}))};}
  if(q===sql.CUSTOMER_MONTH_SELECT_SQL){const rows=[{branch:'hanoi',customer_code:'KH1',net_revenue:pinned*10}];generation=3;return {rows};}
  if(q===sql.CUSTOMER_PRODUCT_MONTH_SELECT_SQL)return {rows:[{product_code:'SP1',net_revenue:pinned*10,net_qty:1}]};
  if(/FROM business_monthly_customer_sales/.test(q))return {rows:[{month:'2026-09-01',branch:'hanoi',customer_code:'KH1',net_revenue:pinned*100}]};
  if(/FROM business_monthly_product_sales/.test(q))return {rows:[{month:'2026-09-01',product_code:'SP1',net_revenue:pinned*100}]};
  if(/FROM business_monthly_sale_sales/.test(q))return {rows:[{month:'2026-09-01',sale_name:'Khang',net_revenue:pinned*100}]};
  return {rows:[]};
 }}),query:async()=>{throw new Error('unscoped read');}};
 const snap=await createRepository({pool,now}).snapshot();
 assert.equal(snap.notReady,false);
 assert.equal(snap.customers.find(r=>r.month==='2026-09-01').netRevenue,100);
 assert.equal(snap.products.find(r=>r.month==='2026-09-01').netRevenue,100);
 assert.equal(snap.sales[0].netRevenue,100);
 assert.equal(snap.customers.find(r=>r.month==='2026-10-01').netRevenue,20);
 assert.equal(snap.products.find(r=>r.month==='2026-10-01').netRevenue,20);
 assert.equal(released,2);
});

test('transaction reader propagates unrelated errors and releases after rollback',async()=>{
 for(const error of [Object.assign(new Error('relation "invoices" does not exist'),{code:'42P01'}),Object.assign(new Error('permission denied'),{code:'42501'}),Object.assign(new Error('connection lost'),{code:'08006'})]){
  const calls=[];const pool={connect:async()=>({release(){calls.push('release');},query:async q=>{calls.push(q);if(q.startsWith('SELECT'))throw error;return {rows:[]};}})};
  await assert.rejects(createRepository({pool,now}).snapshot(),e=>e===error);
  assert.deepEqual(calls.slice(-2),['ROLLBACK','release']);
 }
});

test('failed rollback destroys read connection and preserves original query error',async()=>{
 const original=new Error('source read failed');const cleanup=new Error('rollback failed');let released;
 const pool={connect:async()=>({query:async q=>{if(q==='ROLLBACK')throw cleanup;if(q.startsWith('SELECT'))throw original;return {rows:[]};},release(error){released=error;}})};
 await assert.rejects(createRepository({pool,now}).snapshot(),e=>e===original);
 assert.equal(released,cleanup);
});
