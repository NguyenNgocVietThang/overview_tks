'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PAGE = '1184366971419195';
function api() { const p=path.join(__dirname,'pancakeClient.js'); const m=fs.existsSync(p)?require(p):{}; assert.equal(typeof m.createPancakeClient,'function','Readonly Pancake client must exist'); return m; }
const message=(id,extra={})=>({id,type:'INBOX',inserted_at:'2026-09-27T03:00:00',from:{id:'customer'},has_phone:true,phone_info:[{phone_number:'0900000001'},{phone_number:'0900000002'}],...extra});
function transport(handler) { let time=0; const calls=[]; return { calls, now:()=>time,sleep:async ms=>{time+=ms;},fetch:async (url,options)=>{ const u=new URL(url);calls.push({time,url:u,options}); const body=await handler(u,calls.length); return {ok:body.status===undefined||body.status===200,status:body.status||200,json:async()=>body}; } }; }
test('typed cursor conversations and offset messages exhaust pages, filter sent records and retain one multi-phone cell',async()=>{
 const wire=transport(u=>{ if(u.pathname.endsWith('/messages')) {const n=+u.searchParams.get('current_count');return {success:true,messages:n===0?Array.from({length:30},(_,i)=>message('m'+i,{from:{id:PAGE}})):[message('new'),message('sent',{from:{id:PAGE}}),message('unsupported',{type:'NOTE'}),message('empty',{has_phone:false})]};} const type=u.searchParams.get('type');assert.ok(['INBOX','COMMENT'].includes(type));return {success:true,conversations:type==='INBOX'&&!u.searchParams.has('last_conversation_id')?Array.from({length:60},(_,i)=>({id:'c'+i,has_phone:i===0,current_assign_users:[{name:'B'},{name:'A'}]})):[]}; });
 const client=api().createPancakeClient({...wire,tokens:{[PAGE]:'fixture-secret'}});const rows=await client.fetchPage(PAGE,{since:1,until:1791000000});
 assert.equal(rows.length,1);assert.equal(rows[0].sourceKey,'new');assert.equal(rows[0].phone,'0900000001, 0900000002');assert.equal(rows[0].employeeRaw,'B, A');assert.equal(rows[0].sourceCreatedAt,'2026-09-27T03:00:00.000Z');assert.ok(wire.calls.every((c,i)=>i===0||c.time-wire.calls[i-1].time>=260));assert.ok(wire.calls.every(c=>c.options.method==='GET'));assert.ok(wire.calls.some(c=>c.url.searchParams.get('current_count')==='30'));assert.ok(wire.calls.some(c=>c.url.searchParams.get('last_conversation_id')==='c59'));
});
test('HTTP200 errors, missing sender and repeated cursors fail safely without token diagnostics',async()=>{
 for(const scenario of ['false','sender','cursor']) {const wire=transport(u=>scenario==='false'?{success:false,error:'fixture-secret'}:u.pathname.endsWith('/messages')?{success:true,messages:[message('m',{from:null})]}:{success:true,conversations:scenario==='cursor'?Array.from({length:60},(_,i)=>({id:'c'+i,has_phone:false})):[{id:'c',has_phone:true}]}); const client=api().createPancakeClient({...wire,tokens:{[PAGE]:'fixture-secret'}});await assert.rejects(client.fetchPage(PAGE,{since:1,until:2}),e=>e.code==='PANCAKE_INVALID_RESPONSE'&&!JSON.stringify(e).includes('fixture-secret')&&!e.stack.includes('fixture-secret'));}
});
test('temporary retries are bounded, rate spaced and unauthorized pages never retry',async()=>{
 const wire=transport((u,n)=>n<=2?{status:503}:{success:true,conversations:[]});const client=api().createPancakeClient({...wire,tokens:{[PAGE]:'secret'}});assert.deepEqual(await client.fetchPage(PAGE,{since:1,until:2}),[]);assert.equal(wire.calls.length,4);assert.ok(wire.calls.every((c,i)=>!i||c.time-wire.calls[i-1].time>=260));
 const down=transport(()=>({status:429}));await assert.rejects(api().createPancakeClient({...down,tokens:{[PAGE]:'secret'}}).fetchPage(PAGE,{since:1,until:2}),{code:'PANCAKE_UNAVAILABLE'});assert.equal(down.calls.length,6);
 const bad=transport(()=>({status:401}));await assert.rejects(api().createPancakeClient({...bad,tokens:{[PAGE]:'secret'}}).fetchPage(PAGE,{since:1,until:2}),{code:'PANCAKE_UNAUTHORIZED'});assert.equal(bad.calls.length,1);
});
test('duplicate messages, page caps and invalid timestamps reject instead of truncating',async()=>{
 for(const scenario of ['duplicate','cap','timestamp']) {const wire=transport(u=>u.pathname.endsWith('/messages')?{success:true,messages:scenario==='duplicate'?Array.from({length:30},()=>message('same')):[message('m',{inserted_at:'2026-02-30T00:00:00'})]}:{success:true,conversations:scenario==='cap'?Array.from({length:60},(_,i)=>({id:'c'+i,has_phone:false})):[{id:'c',has_phone:true}]});await assert.rejects(api().createPancakeClient({...wire,tokens:{[PAGE]:'secret'},maxConversationPages:1}).fetchPage(PAGE,{since:1,until:2}),{code:'PANCAKE_INVALID_RESPONSE'});}
});
test('unknown page IDs and missing tokens fail before a network request',async()=>{const wire=transport(()=>{throw Error('must not call')}); const c=api().createPancakeClient({...wire,tokens:{}});await assert.rejects(c.fetchPage('other',{since:1,until:2}),{code:'INVALID_MARKETING_INPUT'});await assert.rejects(c.fetchPage(PAGE,{since:1,until:2}),{code:'PANCAKE_UNAUTHORIZED'});assert.equal(wire.calls.length,0);});

test('messages created after the fixed run cutoff wait for the next synchronization',async()=>{const wire=transport(u=>u.pathname.endsWith('/messages')?{success:true,messages:[message('old'),message('late',{inserted_at:'2026-10-01T16:55:01'})]}:{success:true,conversations:u.searchParams.get('type')==='INBOX'?[{id:'c',has_phone:true}]:[]});const rows=await api().createPancakeClient({...wire,tokens:{[PAGE]:'secret'}}).fetchPage(PAGE,{since:1,until:1790873700});assert.deepEqual(rows.map(r=>r.messageId),['old']);});

test('short final message pages reject duplicate IDs',async()=>{const wire=transport(u=>u.pathname.endsWith('/messages')?{success:true,messages:[message('same'),message('same')]}:{success:true,conversations:u.searchParams.get('type')==='INBOX'?[{id:'c'}]:[]});await assert.rejects(api().createPancakeClient({...wire,tokens:{[PAGE]:'secret'}}).fetchPage(PAGE,{since:1,until:1791000000}),{code:'PANCAKE_INVALID_RESPONSE'});});

test('Pancake six-digit zero-padded microseconds normalize without losing source precision',()=>{const {sourceTimestamp}=api();assert.equal(sourceTimestamp('2026-09-27T03:00:00.000000'),'2026-09-27T03:00:00.000Z');assert.equal(sourceTimestamp('2026-09-27T03:00:00.123000'),'2026-09-27T03:00:00.123Z');assert.throws(()=>sourceTimestamp('2026-09-27T03:00:00.123001'),{code:'PANCAKE_INVALID_RESPONSE'});});

test('full accessible API coverage exposes exhaustion and rejects advertised totals that do not match fetched records',async()=>{
 const wire=transport(u=>({success:true,conversations:[]}));const rows=await api().createPancakeClient({...wire,tokens:{[PAGE]:'secret'}}).fetchPage(PAGE,{since:0,until:1791000000});assert.equal(rows.coverage.complete,true);assert.equal(rows.coverage.since,0);assert.equal(rows.coverage.paginationExhausted,true);
 for(const scope of ['conversation','message']){const bad=transport(u=>u.pathname.endsWith('/messages')?{success:true,total:2,messages:[message('one')]}:{success:true,total:scope==='conversation'?2:1,conversations:[{id:'c'}]});await assert.rejects(api().createPancakeClient({...bad,tokens:{[PAGE]:'secret'}}).fetchPage(PAGE,{since:0,until:1791000000}),{code:'PANCAKE_INVALID_RESPONSE'});}
});

test('assignment evidence records conversation observation time before a long message fetch crosses midnight',async()=>{
 let observed=Date.parse('2026-09-30T16:59:00Z');const wire=transport(u=>{if(u.pathname.endsWith('/messages')){observed=Date.parse('2026-09-30T18:10:00Z');return {success:true,messages:[message('m')]};}return {success:true,conversations:u.searchParams.get('type')==='INBOX'?[{id:'c',current_assign_users:[{name:'B'}]}]:[]};});
 const rows=await api().createPancakeClient({...wire,now:()=>observed,tokens:{[PAGE]:'secret'}}).fetchPage(PAGE,{since:0,until:1791000000});assert.equal(rows[0].raw.assignmentObservedAt,'2026-09-30T16:59:00.000Z');
});
