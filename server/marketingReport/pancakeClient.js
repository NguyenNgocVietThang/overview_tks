'use strict';
const { PAGE_IDS } = require('./marketingRepository');
const SAFE_CODES = new Set(['PANCAKE_INVALID_RESPONSE','PANCAKE_UNAUTHORIZED','PANCAKE_UNAVAILABLE','INVALID_MARKETING_INPUT','MARKETING_STORAGE_ERROR']);
function safeError(code='PANCAKE_UNAVAILABLE') { return Object.assign(new Error(SAFE_CODES.has(code)?code:'PANCAKE_UNAVAILABLE'),{code:SAFE_CODES.has(code)?code:'PANCAKE_UNAVAILABLE'}); }
function sourceTimestamp(value) {
 if(typeof value!=='string') throw safeError('PANCAKE_INVALID_RESPONSE');
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
 if(!m||m[7]&&/[1-9]/.test(m[7].slice(4))||+m[4]>23||+m[5]>59||+m[6]>59) throw safeError('PANCAKE_INVALID_RESPONSE');
 const day=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));
 if(day.getUTCFullYear()!==+m[1]||day.getUTCMonth()+1!==+m[2]||day.getUTCDate()!==+m[3]) throw safeError('PANCAKE_INVALID_RESPONSE');
 const parsed=new Date(value+(m[8]?'':'Z'));if(!Number.isFinite(+parsed)) throw safeError('PANCAKE_INVALID_RESPONSE');return parsed.toISOString();
}
function createPancakeClient({fetch:fetchFn=globalThis.fetch,tokens=Object.fromEntries(PAGE_IDS.map(id=>[id,process.env['PANCAKE_PAGE_TOKEN_'+id]])),now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=20000,maxAttempts=6,maxConversationPages=10000,maxMessagePages=10000}={}) {
 const lastRequest=new Map();const queues=new Map();
 async function request(pageId,path,params,arrayField) {
  // Serialize all requests per page, including retries and separate callers.
  const previous=queues.get(pageId)||Promise.resolve();let release;const turn=new Promise(r=>{release=r;});queues.set(pageId,turn);await previous;
  try {for(let attempt=0;attempt<maxAttempts;attempt++) {
   const delay=260-(now()-(lastRequest.get(pageId)??-Infinity));if(delay>0) await sleep(delay);lastRequest.set(pageId,now());
   const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);timer.unref?.();let response,body;
   try {const url=new URL('https://pages.fm/api/public_api/'+path);for(const [key,value] of Object.entries({...params,page_access_token:tokens[pageId]})) url.searchParams.set(key,String(value));response=await fetchFn(url.toString(),{method:'GET',signal:controller.signal}); if(response.ok) body=await response.json();}
   catch {if(attempt===maxAttempts-1) throw safeError();await sleep(Math.min(500*2**attempt,15000));continue;}
   finally {clearTimeout(timer);}
   if(response.status===401||response.status===403) throw safeError('PANCAKE_UNAUTHORIZED');
   if(response.status===429||response.status>=500) {if(attempt===maxAttempts-1) throw safeError();await sleep(Math.min(500*2**attempt,15000));continue;}
   if(!response.ok) throw safeError();
   if(body?.success!==true||!Array.isArray(body[arrayField])) throw safeError('PANCAKE_INVALID_RESPONSE');
   const total=body.total_count??body.total??body.pagination?.total;
   if(total!==undefined&&(!Number.isInteger(total)||total<0))throw safeError('PANCAKE_INVALID_RESPONSE');
   Object.defineProperty(body[arrayField],'declaredTotal',{value:total});return body[arrayField];
  }} finally {release();if(queues.get(pageId)===turn) queues.delete(pageId);}
 }
 async function fetchPage(pageId,{since,until}) {
  if(!PAGE_IDS.includes(pageId)||!Number.isInteger(since)||!Number.isInteger(until)||since<0||until<since) throw safeError('INVALID_MARKETING_INPUT');
  if(!tokens[pageId]) throw safeError('PANCAKE_UNAUTHORIZED');
  const conversations=[],seenConversations=new Set();
  for(const type of ['INBOX','COMMENT']) {
   let cursor;const seen=new Set();let exhausted=false,declaredTotal;
   for(let page=0;page<maxConversationPages;page++) {
    const batch=await request(pageId,`v2/pages/${pageId}/conversations`,{type,order_by:'updated_at',since,until,...(cursor?{last_conversation_id:cursor}:{})},'conversations');
    if(batch.declaredTotal!==undefined){if(declaredTotal!==undefined&&declaredTotal!==batch.declaredTotal)throw safeError('PANCAKE_INVALID_RESPONSE');declaredTotal=batch.declaredTotal;}
    if(batch.length>60) throw safeError('PANCAKE_INVALID_RESPONSE');
    for(const c of batch) {if(!c||typeof c.id!=='string'||!c.id||seen.has(c.id)) throw safeError('PANCAKE_INVALID_RESPONSE');seen.add(c.id);if(!seenConversations.has(c.id)){seenConversations.add(c.id);conversations.push({...c,assignmentObservedAt:new Date(now()).toISOString()});}}
    if(batch.length<60){exhausted=true;break;}cursor=batch.at(-1).id;
   }
   if(!exhausted||declaredTotal!==undefined&&seen.size!==declaredTotal) throw safeError('PANCAKE_INVALID_RESPONSE');
  }
  const rows=[],messageIds=new Set();let fetchedMessageCount=0;
  for(const c of conversations) {
   // Proven has_phone=false may skip; an absent flag must fetch messages.
   if(c.has_phone===false) continue;
   const users=c.current_assign_users??[];if(!Array.isArray(users)||users.some(u=>typeof u?.name!=='string')) throw safeError('PANCAKE_INVALID_RESPONSE');
   const employeeRaw=users.map(u=>u.name).filter(Boolean).join(', ');const seen=new Set();let exhausted=false,declaredTotal;
   for(let page=0;page<maxMessagePages;page++) {
    const messages=await request(pageId,`v1/pages/${pageId}/conversations/${encodeURIComponent(c.id)}/messages`,{current_count:page*30},'messages');
    if(messages.declaredTotal!==undefined){if(declaredTotal!==undefined&&declaredTotal!==messages.declaredTotal)throw safeError('PANCAKE_INVALID_RESPONSE');declaredTotal=messages.declaredTotal;}
    if(messages.length>30) throw safeError('PANCAKE_INVALID_RESPONSE');let progress=0;const batchIds=new Set();
    for(const m of messages) {
     if(!m||typeof m.id!=='string'||!m.id) throw safeError('PANCAKE_INVALID_RESPONSE');
     if(batchIds.has(m.id)) throw safeError('PANCAKE_INVALID_RESPONSE');batchIds.add(m.id);
     if(seen.has(m.id)) continue;seen.add(m.id);progress++;
     if(!['INBOX','COMMENT'].includes(m.type)||m.has_phone!==true) continue;
     if(!m.from?.id) throw safeError('PANCAKE_INVALID_RESPONSE');if(String(m.from.id)===pageId) continue;
     if(!Array.isArray(m.phone_info)||!m.phone_info.length||m.phone_info.some(p=>typeof p?.phone_number!=='string'||!p.phone_number.trim())) throw safeError('PANCAKE_INVALID_RESPONSE');
     if(messageIds.has(m.id)) throw safeError('PANCAKE_INVALID_RESPONSE');messageIds.add(m.id);
     const sourceCreatedAt=sourceTimestamp(m.inserted_at);
     if(+new Date(sourceCreatedAt)>until*1000) continue;
     const phone=m.phone_info.map(p=>p.phone_number).join(', ');
     rows.push({sourceKey:m.id,messageId:m.id,conversationId:c.id,type:m.type,phone,phoneKey:phone,employeeRaw,sourceCreatedAt,raw:{message:m,currentAssignUsers:users,assignmentObservedAt:c.assignmentObservedAt}});
    }
    if(messages.length&&progress===0) throw safeError('PANCAKE_INVALID_RESPONSE');
    if(messages.length<30){exhausted=true;break;}
   }
   if(!exhausted||declaredTotal!==undefined&&seen.size!==declaredTotal) throw safeError('PANCAKE_INVALID_RESPONSE');
   fetchedMessageCount+=seen.size;
  }
  Object.defineProperty(rows,'coverage',{value:{complete:true,since,until,conversationCount:conversations.length,messageCount:fetchedMessageCount,phoneMessageCount:rows.length,earliestSourceCreatedAt:rows.reduce((v,r)=>!v||r.sourceCreatedAt<v?r.sourceCreatedAt:v,null),latestSourceCreatedAt:rows.reduce((v,r)=>!v||r.sourceCreatedAt>v?r.sourceCreatedAt:v,null),paginationExhausted:true,scope:'Pancake public API accessible INBOX/COMMENT conversations in declared updated_at range; deleted or inaccessible records cannot be reconstructed'}});
  return rows.sort((a,b)=>a.sourceCreatedAt.localeCompare(b.sourceCreatedAt)||a.sourceKey.localeCompare(b.sourceKey));
 }
 return {fetchPage};
}
module.exports={createPancakeClient,sourceTimestamp,safeError};
