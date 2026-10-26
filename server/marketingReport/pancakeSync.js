'use strict';
const {createMarketingRepository,ACTIVE_PAGE_IDS}=require('./marketingRepository');
const {createPancakeClient,safeError}=require('./pancakeClient');
const {phoneText}=require('./marketingParsers');
const {isPhoneReportObservation}=require('./marketingAggregation');
function createPostgresSyncLock({pool=require('../db/pool').getPool(),independent=false}={}) {
 const LOCK_KEYS=[731042,independent?2356:2355];
 return {async acquire(){let client;try{client=await pool.connect();const result=await client.query('SELECT pg_try_advisory_lock($1,$2) AS locked',LOCK_KEYS);if(!result.rows[0]?.locked){client.release();return null;}}catch{client?.release(true);throw safeError('MARKETING_STORAGE_ERROR');}
  let released=false;return {listRunningRunIds:async()=>{try{return (await client.query("SELECT id::text AS id FROM marketing_sync_runs WHERE status='running' AND starts_with(run_key,$1) ORDER BY id",[independent?'pancake-independent:':'pancake:'])).rows.map(r=>r.id);}catch{throw safeError('MARKETING_STORAGE_ERROR');}},async release(){if(released)return;released=true;try{const result=await client.query('SELECT pg_advisory_unlock($1,$2) AS unlocked',LOCK_KEYS);if(result.rows[0]?.unlocked!==true)throw Error();client.release();}catch{client.release(true);throw safeError('MARKETING_STORAGE_ERROR');}}};}};
}
const phoneParts=value=>String(value).split(',').map(s=>s.trim()).sort();
const employeeParts=value=>String(value??'').split(', ').filter(Boolean).sort();
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const samePhone=(a,b)=>equal(phoneParts(a),phoneParts(b));
const sameEmployees=(a,b)=>equal(employeeParts(a),employeeParts(b));
// Same number written differently (+84…, leading 0, doubled 0); used only to choose among rows already tied to one message.
const canonicalDigits=value=>{let d=String(value).replace(/\D/g,'').replace(/^0+/,'');if(d.startsWith('84')&&d.length>9)d=d.slice(2).replace(/^0+/,'');return d;};
const compatiblePhone=(a,b)=>equal(String(a).split(',').map(canonicalDigits).filter(Boolean).sort(),String(b).split(',').map(canonicalDigits).filter(Boolean).sort());
const rowRef=r=>`${r.tab}!${r.rowNumber}`;
function historyPhone(row){return typeof row.raw?.[19]==='number'?phoneText(row.raw[19]):row.phone;}
function preparePageRows(rows,snapshot,pageId) {
 const history=snapshot.rawRows.filter(r=>r.origin==='sheet'&&r.pageId===pageId&&isPhoneReportObservation(r));
 const byTimestamp=new Map();for(const r of history){if(!r.sourceCreatedAt)continue;const list=byTimestamp.get(r.sourceCreatedAt)||[];list.push(r);byTimestamp.set(r.sourceCreatedAt,list);}
 const horizon=history.reduce((last,r)=>r.sourceCreatedAt&&r.sourceCreatedAt>last?r.sourceCreatedAt:last,'');
 const facts=new Map(snapshot.facts.filter(f=>f.pageId===pageId).map(f=>[f.sourceKey,f]));
 const linked=new Set(snapshot.facts.filter(f=>f.historicalRowId).map(f=>f.historicalRowId));
 const planned=[],unresolved=[],claimed=new Map();
 // Identity mode: the history was linked to Pancake message IDs from the full export, so a message is adopted by ID
 // (any number of history rows may share it) instead of guessing from phone and timestamp.
 const identityRows=new Map(),historyById=new Map(history.map(r=>[r.id,r]));
 for(const link of snapshot.identities||[]){if(link.pageId!==pageId||!historyById.has(link.historyRowId))continue;const list=identityRows.get(link.messageId)||[];list.push(historyById.get(link.historyRowId));identityRows.set(link.messageId,list);}
 const identityMode=identityRows.size>0;
 const baselineIds=new Set((snapshot.baselineMessages||[]).filter(b=>b.pageId===pageId).map(b=>b.messageId));
 const windowStart=history.reduce((first,r)=>r.sourceCreatedAt&&(!first||r.sourceCreatedAt<first)?r.sourceCreatedAt:first,'');
 const skipped={baselineExcluded:0,preWindow:0};
 for(const input of rows){const row={...input};const fact=facts.get(row.sourceKey);
  if(fact){let previous=fact.currentInput;if(!previous){previous=snapshot.rawRows.filter(r=>r.origin==='pancake'&&r.factId===fact.id).at(-1);}
   if(!previous){unresolved.push({pageId,reason:'missing-canonical-metadata',rowReferences:history.filter(r=>r.id===fact.historicalRowId).map(rowRef)});continue;}
   if(samePhone(previous.phone,row.phone)){row.phone=previous.phone;row.phoneKey=previous.phoneKey;}
   if(sameEmployees(previous.employeeRaw,row.employeeRaw))row.employeeRaw=previous.employeeRaw;
   planned.push(row);continue;
  }
  if(identityMode){
   const linkedRows=identityRows.get(row.messageId);
   if(linkedRows){const ordered=[...linkedRows].sort((a,b)=>BigInt(a.sourceOrder)<BigInt(b.sourceOrder)?-1:1);const same=ordered.filter(h=>compatiblePhone(historyPhone(h),row.phone));const anchor=(same.length?same:ordered).at(-1);
    row.historicalRowId=anchor.id;row.phoneKey=anchor.phoneKey;if(sameEmployees(anchor.employeeRaw,row.employeeRaw))row.employeeRaw=anchor.employeeRaw;planned.push(row);continue;}
   if(baselineIds.has(row.messageId)){skipped.baselineExcluded++;continue;}
   if(windowStart&&row.sourceCreatedAt<windowStart){skipped.preWindow++;continue;}
   if(horizon&&row.sourceCreatedAt<=horizon){unresolved.push({pageId,reason:'unknown-in-window',rowReferences:[],messageIds:[row.messageId]});continue;}
   planned.push(row);continue;
  }
  const undated=history.filter(h=>!h.sourceCreatedAt&&samePhone(historyPhone(h),row.phone));
  if(undated.length){unresolved.push({pageId,reason:'missing-history-timestamp',rowReferences:undated.map(rowRef)});continue;}
  const candidates=(byTimestamp.get(row.sourceCreatedAt)||[]).filter(h=>samePhone(historyPhone(h),row.phone));
  const keys=new Set(candidates.map(h=>h.phoneKey));
  if(keys.size===1){const sorted=candidates.sort((a,b)=>BigInt(a.sourceOrder)<BigInt(b.sourceOrder)?1:-1);const selected=sorted[0];
   if(linked.has(selected.id)||claimed.has(selected.id)) {unresolved.push({pageId,reason:'ambiguous-baseline',rowReferences:[rowRef(selected)]});continue;}
   claimed.set(selected.id,row.sourceKey);row.historicalRowId=selected.id;row.phoneKey=selected.phoneKey;if(sameEmployees(selected.employeeRaw,row.employeeRaw))row.employeeRaw=selected.employeeRaw;planned.push(row);continue;
  }
  if(keys.size>1||horizon&&row.sourceCreatedAt<=horizon){const relevant=(byTimestamp.get(row.sourceCreatedAt)||history.filter(h=>samePhone(historyPhone(h),row.phone))).map(rowRef);unresolved.push({pageId,reason:keys.size>1?'ambiguous-baseline':'unmatched-baseline',rowReferences:[...new Set(relevant)]});continue;}
  // No history or later than its captured creation coverage: ordinary new source observation.
  planned.push(row);
 }
 // Fractions near an older whole-second history row require reconciliation even if after the exact horizon.
 for(const row of planned.filter(r=>!r.historicalRowId&&!facts.has(r.sourceKey))){if(/\.\d*[1-9]\d*Z$/.test(row.sourceCreatedAt)){const second=row.sourceCreatedAt.slice(0,19)+'.000Z';const near=(byTimestamp.get(second)||[]).filter(h=>samePhone(historyPhone(h),row.phone));if(near.length)unresolved.push({pageId,reason:'timestamp-precision',rowReferences:near.map(rowRef)});}}
 if(unresolved.length)throw Object.assign(safeError('PANCAKE_INVALID_RESPONSE'),{unresolved});
 return Object.defineProperty(planned,'skipped',{value:skipped});
}
function pageHorizon(snapshot,pageId){const times=snapshot.rawRows.filter(r=>r.origin==='sheet'&&r.pageId===pageId&&isPhoneReportObservation(r)&&r.sourceCreatedAt).map(r=>+new Date(r.sourceCreatedAt));return times.length?Math.max(0,Math.floor(Math.min(...times)/1000)-86400):0;}
function createPancakeSync({repository=createMarketingRepository(),client=createPancakeClient(),lock,now=()=>new Date(),independent=process.env.MARKETING_REPORT_SOURCE==='pancake'}={}) {
 lock??=createPostgresSyncLock({independent});
 async function run({slotDate,retry=false}={}) {
  const parsedSlot=new Date(slotDate+'T00:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(slotDate||'')||!Number.isFinite(+parsedSlot)||parsedSlot.toISOString().slice(0,10)!==slotDate)throw safeError('INVALID_MARKETING_INPUT');
  const lease=await lock.acquire();if(!lease)return {skipped:'busy'};
  try {const runStartedAt=now();const until=Math.floor(+runStartedAt/1000);const baseKey=(independent?'pancake-independent:':'pancake:')+slotDate;let recovered=false,recoveryKey=null;
   for(const id of await lease.listRunningRunIds()){const stale=await repository.getSyncRun(id);await repository.finishSyncRun(id);if(stale.runKey===baseKey)recovered=true;
    else if(stale.runKey.startsWith(baseKey+':retry:1')&&stale.status==='running'){recovered=true;recoveryKey=stale.runKey+':recovery';}}
   let run=await repository.startSyncRun({runKey:baseKey,startedAt:runStartedAt.toISOString()});
   if(run.status==='success')return {...await repository.getSyncRun(run.id),replayed:true};
   if(run.status==='error'){
    const latest=await repository.getLatestSlotRun(baseKey);
    if(latest?.status==='success')return {...latest,replayed:true};
    if(!retry&&!recovered)return {...await repository.getSyncRun(run.id),replayed:true};
    run=await repository.startSyncRun({runKey:recoveryKey||baseKey+':retry:1',startedAt:runStartedAt.toISOString()});
    if(run.status!=='running')return {...await repository.getSyncRun(run.id),replayed:true};
   }
   const snapshot=independent?{rawRows:[],facts:[]}:await repository.readSnapshot({includeIdentities:true});const unresolved=[],baselineSkipped=[];const adoptedIds=new Set([...snapshot.facts.map(f=>f.historicalRowId),...(snapshot.identities||[]).map(l=>l.historyRowId)].filter(Boolean));
   // Pages use independent tokens and rate limits, so read them concurrently (the largest page dominates the run);
   // everything is still prepared and committed one page at a time.
   const fetches=new Map(ACTIVE_PAGE_IDS.map(pageId=>[pageId,client.fetchPage(pageId,{since:independent?0:pageHorizon(snapshot,pageId),until}).then(rows=>({rows}),error=>({error}))]));
   let committing=Promise.resolve();
   const processPage=async pageId=>{
    const fetched=await fetches.get(pageId);
    const previous=committing;let releaseCommit;committing=new Promise(resolve=>{releaseCommit=resolve;});await previous;
    try {
    if(fetched.error)throw fetched.error;const rows=fetched.rows;
    const prepared=independent?rows:preparePageRows(rows,snapshot,pageId);
    await repository[independent?'commitIndependentPageSync':'commitPageSync']({runId:run.id,pageId,rows:prepared,completedAt:now().toISOString(),completionNow:now,coverage:rows.coverage});
    if(prepared.skipped&&(prepared.skipped.baselineExcluded||prepared.skipped.preWindow))baselineSkipped.push({pageId,...prepared.skipped});
    for(const row of prepared)if(row.historicalRowId)adoptedIds.add(row.historicalRowId);
   }catch(error){if(error.unresolved)unresolved.push(...error.unresolved);await repository[independent?'failIndependentPageSync':'failPageSync']({runId:run.id,pageId,completedAt:now().toISOString(),errorCode:error.code||'PANCAKE_UNAVAILABLE'});}finally{releaseCommit();}};
   if(independent){
    const results=await Promise.allSettled(ACTIVE_PAGE_IDS.map(processPage));
    const failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;
   }else for(const pageId of ACTIVE_PAGE_IDS)await processPage(pageId);
   const unlinkedHistoricalRows=ACTIVE_PAGE_IDS.map(pageId=>({pageId,rowReferences:snapshot.rawRows.filter(r=>r.origin==='sheet'&&r.pageId===pageId&&isPhoneReportObservation(r)&&!adoptedIds.has(r.id)).map(rowRef)})).filter(r=>r.rowReferences.length);
   const finished=await repository.finishSyncRun(run.id);
   // Gộp SĐT sẵn vào marketing_phone_summary (migration 0069); lỗi/thiếu bảng chỉ bỏ qua, báo cáo lùi về gộp JS.
   if(independent&&typeof repository.refreshIndependentSummary==='function')await repository.refreshIndependentSummary().catch(()=>{});
   return {...finished,unresolved,unlinkedHistoricalRows,baselineSkipped};
  }finally{await lease.release();}
 }
 return {run};
}
module.exports={createPancakeSync,createPostgresSyncLock,preparePageRows,pageHorizon};
