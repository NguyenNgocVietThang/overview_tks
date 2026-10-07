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
  const pool = { query: (q,p) => db.query(q,p) };
  let snap = await createRepository({pool,now}).snapshot();
  assert.equal(snap.notReady, true);
  await db.exec(`INSERT INTO business_monthly_state(month) SELECT generate_series('2026-03-01'::date,'2026-09-01'::date,'1 month'::interval)`);
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
  const snap = await createRepository({pool:{query:(q,p)=>db.query(q,p)},now}).snapshot();
  assert.equal(snap.customers.find(r=>r.month==='2026-10-01'&&r.customerCode==='KH1').netRevenue,520);
 }finally{await db.close();}
});
test('unrelated missing relations, permission and connection errors propagate',async()=>{
 for(const error of [Object.assign(new Error('relation "invoices" does not exist'),{code:'42P01'}),Object.assign(new Error('relation "business_monthly_state" does not exist'),{code:'42501'}),Object.assign(new Error('connection lost'),{code:'08006'})]) {
  const repo=createRepository({pool:{query:async()=>{throw error;}},now});
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
  const repo=createRepository({pool:{query:(q,p)=>db.query(q,p)},now});
  const snap=await repo.snapshot();
  assert.equal(snap.notReady,true); assert.deepEqual(snap.frozenMonths,[]);
  assert.equal((await repo.customerProducts({branch:'hanoi',customerCode:'KH1',months:['2026-09-01','2026-10-01']}))[0].revenue,950);
 }finally{await db.close();}
});
