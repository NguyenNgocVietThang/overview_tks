'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDatabaseMarketingReportService}=require('./marketingDatabaseReportService');
const fixture=()=>({pages:[{pageId:'1',name:'Page',status:'success',lastSuccessAt:'2026-10-17T00:00:00Z',coverage:{complete:true,since:0}}],aliases:[],monthlyRows:[],rawRows:[{pageId:'1',sourceKey:'m',sourceOrder:'1',phone:'012',employeeRaw:'A',sourceCreatedAt:'2026-09-30T17:00:00Z',observedAt:'2026-10-16T00:00:00Z'}]});
const make=s=>createDatabaseMarketingReportService({independent:true,repository:{readSnapshot:async()=>{throw Error('legacy read forbidden');},readIndependentSnapshot:async()=>structuredClone(s)},legacy:{metadata:async()=>{throw Error('Sheets forbidden');}},revenue:async()=>({available:false})});
test('independent report and metadata never read Sheets or mixed history; missing closure remains null',async()=>{
 const svc=make(fixture());const meta=await svc.metadata();assert.equal(meta.dataset,'pancake-independent');assert.equal(meta.sources.phones.available,true);assert.equal(meta.sources.ads.available,null);assert.equal(meta.sources.closures.source,'manual-db');
 const r=await svc.report('receipt-check',{year:2026,month:10});assert.equal(r.rows[0].first,1);assert.equal(r.rows[0].closed,null);assert.equal(r.kpis.at(-1).value,null);
 const d=await svc.detail({kind:r.kind,key:r.rows[0].key,snapshotId:r.snapshotId});assert.equal(d.reconciliation.status,'matched');assert.equal(d.reconciliation.found.closed,null);
});
test('manual BC rows explicitly supply closure and detail matches totals',async()=>{
 const s=fixture();s.monthlyRows=[{id:'1',origin:'manual',reportYear:2026,reportMonth:10,pageId:'1',page:'Page',sale:'A'}];
 const svc=make(s),r=await svc.report('receipt-check',{year:2026,month:10});assert.equal(r.rows[0].closed,1);assert.equal(r.rows[0].rate,1);assert.equal(r.sources.closures,'manual-db');
 const d=await svc.detail({kind:r.kind,key:r.rows[0].key,snapshotId:r.snapshotId});assert.equal(d.reconciliation.status,'matched');
});
test('missing or failed page coverage cannot be presented as complete',async()=>{
 const s=fixture();s.pages.push({pageId:'2',name:'Missing',status:'error'});const r=await make(s).report('phones');assert.equal(r.completeness.complete,false);assert.ok(r.warnings.some(w=>w.includes('chưa đầy đủ')));
});

test('public service selects isolated dataset and provides explicit legacy lookup without Sheets reads',async()=>{
 const s=fixture();const svc=require('./marketingReportService').createMarketingReportService({source:'pancake',clients:{},repository:{readIndependentSnapshot:async()=>structuredClone(s),readSnapshot:async()=>({...structuredClone(s),rawRows:[{pageId:'1',phone:'old',sourceOrder:'1',employeeRaw:'Old',creditedDate:'2026-09-01'}]})},revenue:async()=>({available:false})});
 assert.equal((await svc.report('phones')).rows[0].phone,'012');const old=await svc.report('phones',{dataset:'legacy'});assert.equal(old.rows[0].phone,'old');assert.equal(old.dataset,'legacy-db');const d=await svc.detail({dataset:'legacy',kind:'phones',snapshotId:old.snapshotId,key:old.rows[0].key});assert.equal(d.groups[0].rows[0].phone,'old');
});

test('initial backfill publishes pending state and no misleading zero KPIs',async()=>{
 const s=fixture();s.pages=s.pages.map(p=>({...p,lastSuccessAt:null,status:'pending',coverage:{}}));s.rawRows=[];
 const r=await make(s).report('phones');assert.equal(r.publicationStatus,'pending');assert.ok(r.kpis.every(k=>k.value===null));
});

test('coverage is complete for the five active pages',async()=>{
 const {ACTIVE_PAGE_IDS}=require('./marketingRepository');const s=fixture();s.pages=ACTIVE_PAGE_IDS.map(pageId=>({...s.pages[0],pageId}));
 assert.equal((await make(s).report('phones')).completeness.complete,true);
 s.pages.pop();assert.equal((await make(s).report('phones')).completeness.complete,false);
});
