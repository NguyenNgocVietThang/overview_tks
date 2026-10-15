'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { readContainerSummary, getContainerDetails, getContainerMeta } = require('./repository');
const { resolvePermissions, hasFeature } = require('../auth/featureRegistry');
async function fixture() {
  const db = new PGlite();
  await db.exec(fs.readFileSync(path.join(__dirname,'../db/migrations/0018_product_report.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname,'../db/migrations/0053_product_containers.sql'),'utf8'));
  await db.exec(`CREATE TABLE products(code text,branch text,is_active boolean);
    INSERT INTO products VALUES ('001A','hanoi',true),('STOP','hanoi',false);
    INSERT INTO product_report(product_code,product_name) VALUES ('001A','A'),('STOP','S');`);
  return db;
}
test('summary distinguishes unavailable from empty snapshot, sums only 1/2/3', async () => {
  const db=await fixture();
  try {
    assert.equal((await readContainerSummary(db)).containerSync.available,false);
    await db.exec(`UPDATE product_container_sync SET version='00000000-0000-4000-8000-000000000001', last_success_at=now();
      INSERT INTO product_container_lines(sheet_name,sheet_order,container_row,source_row,product_code,product_key,container_name,status,status_label,quantity)
      VALUES ('YIWU',0,1,2,'001A','001a','CONT A',1,'1.Chưa có lịch',100),
      ('YIWU',0,3,4,'001A','001a','CONT A',2,'2.Chưa bốc',50),
      ('SD',3,1,2,'001A','001a','CONT A',3,'3.Đã bốc',30),
      ('SD',3,4,5,'001A','001a','CONT A',4,'4.Đã về',20),
      ('SD',3,6,7,'001A','001a','CONT A',5,'5.Đã về',10);`);
    const result=await readContainerSummary(db);
    assert.equal(result.containerSync.available,true);
    assert.deepEqual(result.totals['001a'],{unloadedQty:150,loadedQty:30});
    assert.equal(Object.hasOwn(result.containerSync,'warnings'),false);
    await db.exec('DELETE FROM product_container_lines');
    assert.deepEqual((await readContainerSummary(db)).totals,{});
  } finally {await db.close();}
});
test('detail SQL whitelists fields/status and validates eligible active report codes',async()=>{
  const db=await fixture();
  try {
    await assert.rejects(getContainerDetails({pool:db,code:' '}),{statusCode:400});
    await assert.rejects(getContainerDetails({pool:db,code:'STOP'}),{statusCode:404});
    await assert.rejects(getContainerDetails({pool:db,code:'001A'}),{statusCode:503});
    await db.exec(`UPDATE product_container_sync SET version='00000000-0000-4000-8000-000000000001',last_success_at=now(),warnings='[{"sheetName":"YIWU","row":3,"reason":"O lỗi"}]';
      INSERT INTO product_container_lines(sheet_name,sheet_order,container_row,source_row,product_code,product_key,container_name,status,status_label,quantity,ordered_by,vietnam_price)
      VALUES ('YIWU',0,1,2,'001A','001a','CONT A',2,'2.Chưa bốc',50,'SECRET',12345),('SD',3,1,2,'001A','001a','CONT B',5,'5.Đã về',9,'SECRET',999);`);
    const sale=await getContainerDetails({pool:db,code:' 001a '});
    assert.equal(sale.rows.length,1);
    assert.deepEqual(Object.keys(sale.rows[0]).sort(),['containerName','status','statusLabel','eta','color','saleNote','quantity'].sort());
    assert.doesNotMatch(JSON.stringify(sale),/SECRET|12345|warnings|sheetName|sourceRow/);
    const manager=await getContainerDetails({pool:db,code:'001A',fullAccess:true});
    assert.equal(manager.rows.length,2);
    assert.equal(manager.rows[0].vietnamPrice,12345);
    assert.equal(manager.warnings[0].row,3);
  } finally {await db.close();}
});
test('missing migration is explicitly unavailable without breaking old report reads',async()=>{
  const pool={query:async()=>{const err=new Error('missing');err.code='42P01';throw err;}};
  assert.equal((await getContainerMeta({pool})).containerSync.available,false);
});
test('full detail permission defaults to manager and follows grant/revoke and parent',()=>{
  const feature='reports.overview.containers.full';
  assert.equal(hasFeature({vaiTro:'Quản lý'},feature),true);
  assert.equal(hasFeature({vaiTro:'Nhân viên sale'},feature),false);
  const granted={vaiTro:'Nhân viên sale',featurePermissions:{[feature]:true}};
  assert.ok(resolvePermissions(granted).includes(feature));
  assert.equal(hasFeature({vaiTro:'Quản lý',featurePermissions:{[feature]:false}},feature),false);
  assert.equal(hasFeature({...granted,featurePermissions:{[feature]:true,'reports.overview':false}},feature),false);
});
test('migration revokes inherited SELECT from reporting_readonly for both restricted tables',async()=>{
  const db=new PGlite();
  try {
    await db.exec('CREATE ROLE reporting_readonly; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO reporting_readonly;');
    await db.exec(fs.readFileSync(path.join(__dirname,'../db/migrations/0053_product_containers.sql'),'utf8'));
    for(const name of ['product_container_lines','product_container_sync']){
      const {rows}=await db.query("SELECT has_table_privilege('reporting_readonly',$1,'SELECT') AS permitted",[name]);
      assert.equal(rows[0].permitted,false);
    }
  } finally {await db.close();}
});
test('real transaction rollback restores previous snapshot after replacement insert fails',async()=>{
  const {refreshContainers}=require('./sync');
  const {SHEET_NAMES}=require('./parser');
  const db=await fixture();
  try {
    await db.exec(`UPDATE product_container_sync SET version='00000000-0000-4000-8000-000000000001',last_success_at='2020-01-01';
      INSERT INTO product_container_lines(sheet_name,sheet_order,container_row,source_row,product_code,product_key,container_name,status,status_label,quantity)
      VALUES('YIWU',0,1,2,'001A','001a','CONT OLD',2,'2.Chưa bốc',123);`);
    const connection={release(){},query:async(sql,args)=>{
      if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};
      if(sql.includes('pg_advisory_unlock'))return {rows:[{}]};
      if(sql.startsWith('INSERT INTO product_container_lines'))throw Error('simulated insert failure');
      return db.query(sql,args);
    }};
    const line=Array(24).fill('');line[0]='001A';line[14]=999;
    const result=await refreshContainers({pool:{connect:async()=>connection},spreadsheetId:'fixture',client:{listSheetTitles:async()=>SHEET_NAMES,getValues:async()=>[['CONT NEW','2.Chưa bốc'],line]},logger:{info(){},error(){}}});
    assert.equal(result.status,'failed');
    const summary=await readContainerSummary(db);
    assert.equal(summary.totals['001a'].unloadedQty,123);
    assert.equal(summary.containerSync.version,'00000000-0000-4000-8000-000000000001');
    assert.equal(summary.containerSync.stale,true);
  } finally {await db.close();}
});
