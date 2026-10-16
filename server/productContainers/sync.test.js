'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const { refreshContainers, startContainerSchedule }=require('./sync');
const { SHEET_NAMES, INTERVAL_MS }=require('./parser');
function fakeConnection({locked=true,lastAttempt=null,lastSuccess=null}={}) {
  const calls=[];
  return {calls,release(){calls.push('RELEASE');},async query(sql,params){calls.push({sql,params});
    if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked}]};
    if(sql.startsWith('SELECT last_attempt'))return {rows:[{last_attempt_at:lastAttempt,last_success_at:lastSuccess}]};
    return {rows:[]};}};
}
const fixed=new Date('2026-10-15T02:00:00Z');
test('one source failure keeps prior snapshot, records safe error and releases shared lock',async()=>{
  const conn=fakeConnection();
  const reads=[];
  const result=await refreshContainers({pool:{connect:async()=>conn},spreadsheetId:'fixture',now:()=>fixed,
    client:{listSheetTitles:async()=>SHEET_NAMES,getValues:async(name)=>{reads.push(name);if(name==='SD')throw Error('secret request');return [];}},logger:{info(){},error(){}}});
  assert.equal(result.status,'failed');
  assert.equal(conn.calls.some(x=>x.sql?.startsWith('DELETE')),false);
  assert.ok(conn.calls.some(x=>x.sql?.includes('last_error')));
  assert.ok(conn.calls.some(x=>x.sql?.includes('pg_advisory_unlock')));
  assert.equal(conn.calls.at(-1),'RELEASE');
  assert.doesNotMatch(JSON.stringify(conn.calls),/secret request/);
});
test('not-due and shared-lock busy do not read Google',async()=>{
  for(const opts of [{lastSuccess:'2026-10-15T01:00:00Z'},{locked:false},{lastAttempt:'2026-10-15T01:30:00Z'}]){
    const conn=fakeConnection(opts);let reads=0;
    const result=await refreshContainers({pool:{connect:async()=>conn},spreadsheetId:'fixture',now:()=>fixed,client:{listSheetTitles:async()=>{reads++;return SHEET_NAMES;}},logger:{info(){},error(){}}});
    assert.ok(['not-due','busy'].includes(result.status));assert.equal(reads,0);
  }
});
test('six-sheet success commits rows and metadata together; rollback on insert error',async()=>{
  for(const fail of [false,true]){
    const conn=fakeConnection();const original=conn.query;
    conn.query=async function(sql,params){if(fail&&sql.startsWith('INSERT INTO product_container_lines'))throw Error('insert fail');return original.call(this,sql,params);};
    const reads=[];
    const result=await refreshContainers({pool:{connect:async()=>conn},spreadsheetId:'fixture',now:()=>fixed,client:{listSheetTitles:async()=>SHEET_NAMES,getValues:async(name)=>{reads.push(name);const row=Array(24).fill('');row[0]='SKU';row[14]=2;return [['CONT A','2.Chưa bốc'],row];}},logger:{info(){},error(){}}});
    assert.equal(new Set(reads).size,6);
    const sql=conn.calls.filter(x=>x.sql).map(x=>x.sql);
    assert.ok(sql.indexOf('BEGIN')<sql.findIndex(x=>x.startsWith('DELETE')));
    assert.ok(sql.includes(fail?'ROLLBACK':'COMMIT'));
    assert.equal(result.status,fail?'failed':'updated');
  }
});
test('scheduler starts independently, runs every two hours and can stop',async()=>{
  let callback;let count=0;let cleared=false;
  const runtime=startContainerSchedule({spreadsheetId:'fixture',refresh:async()=>{count++;},setTimeoutFn:(cb,ms)=>{callback=cb;assert.equal(ms,INTERVAL_MS);return {unref(){}};},clearTimeoutFn:()=>{cleared=true;}});
  await runtime.ready;await callback();assert.equal(count,2);runtime.stop();assert.equal(cleared,true);
});
test('restart schedules remaining persisted due time rather than another full two hours',async()=>{
  let delay;
  const runtime=startContainerSchedule({spreadsheetId:'fixture',now:()=>1000,refresh:async()=>({status:'not-due',nextAttemptAt:1600}),setTimeoutFn:(cb,ms)=>{delay=ms;return {};},clearTimeoutFn(){}});
  await runtime.ready;assert.equal(delay,600);runtime.stop();
});
test('unlock failure discards the DB session instead of leaking its advisory lock into pool',async()=>{
  const conn=fakeConnection({lastSuccess:'2026-10-15T01:00:00Z'});const query=conn.query;
  let releasedWith;
  conn.query=async function(sql,args){if(sql.includes('pg_advisory_unlock'))throw Error('unlock failed');return query.call(this,sql,args);};
  conn.release=error=>{releasedWith=error;};
  await refreshContainers({pool:{connect:async()=>conn},spreadsheetId:'fixture',now:()=>fixed,logger:{info(){},error(){}}});
  assert.ok(releasedWith instanceof Error);
});
test('unchanged sheet keeps rows and version: no DELETE/INSERT, only freshness timestamps',async()=>{
  const conn=fakeConnection();const original=conn.query;
  conn.query=async function(sql,params){
    if(sql.includes('jsonb_populate_recordset')&&sql.includes('AS unchanged'))return {rows:[{unchanged:true}]};
    return original.call(this,sql,params);
  };
  const result=await refreshContainers({pool:{connect:async()=>conn},spreadsheetId:'fixture',now:()=>fixed,
    client:{listSheetTitles:async()=>SHEET_NAMES,getValues:async()=>{const row=Array(24).fill('');row[0]='SKU';row[14]=2;return [['CONT A','2.Chưa bốc'],row];}},logger:{info(){},error(){}}});
  const sql=conn.calls.filter(x=>x.sql).map(x=>x.sql);
  assert.equal(result.status,'unchanged');
  assert.equal(sql.some(x=>x.startsWith('DELETE')||x.startsWith('INSERT INTO product_container_lines')),false);
  assert.equal(sql.some(x=>/SET version=/.test(x)),false,'khong doi version khi noi dung khong doi');
  const touch=sql.find(x=>/UPDATE product_container_sync SET last_success_at/.test(x));
  assert.ok(touch&&!/version/.test(touch));
  assert.ok(sql.includes('COMMIT'));
});
