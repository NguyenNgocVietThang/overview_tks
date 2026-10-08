'use strict';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{}'; process.env.JWT_SECRET = 'test'; process.env.SUPABASE_DB_URL = '';
const test = require('node:test'); const assert = require('node:assert/strict'); const crypto = require('node:crypto');
const { verifyInitData, createManagerLeaveMiniApp } = require('./managerLeaveMiniApp');
const express = require('express');
function signed(patch = {}, token = 'bot-token') {
 const params = new URLSearchParams({ auth_date: '1000', user: JSON.stringify({ id: 123 }), ...patch });
 const check = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n');
 const secret = crypto.createHmac('sha256','WebAppData').update(token).digest();
 params.set('hash', crypto.createHmac('sha256',secret).update(check).digest('hex')); return params.toString();
}
test('MiniApp verifies signed identity and rejects tampering, duplicate fields, future and expired data', () => {
 assert.equal(verifyInitData(signed(), 'bot-token', 1000).id, 123);
 for (const value of [signed().replace('123','124'), signed()+'&user=%7B%22id%22%3A123%7D', signed({auth_date:'1001'}), signed({auth_date:'99'}), signed({},'wrong')]) assert.throws(() => verifyInitData(value, 'bot-token',1000));
});
test('MiniApp reads only authorized request and rejects stale/final/oversized input without mutation; blank reason accepted', async t => {
 let changes = []; let permission = true; let row = {request_id:'NP-1',loai_yeu_cau:'Xin nghỉ phép',trang_thai:'Chưa duyệt',decision_version:'1',ho_ten:'A',timing_status:'Xin muộn',registration_deadline_date:'2026-10-04'};
 const user = {id:'user',telegramId:'123'};
 const app=express();app.use(express.json());app.use(createManagerLeaveMiniApp({enabled:true,token:'bot-token',now:()=>1000,getManager:async id=>id===123?user:null,authorization:{authorize:async()=>{if(!permission)throw Object.assign(new Error('denied'),{statusCode:403});return user;}},leaveRepo:{getLeaveRequestById:async()=>row},decide:async input=>{changes.push(input);return {...row,trang_thai:'Từ chối'};}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const send=body=>fetch(`http://127.0.0.1:${server.address().port}/api/telegram/manager-leave/miniapp/reject`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({initData:signed(),requestId:'NP-1',expectedVersion:'1',...body})});
 const contextResponse=await fetch(`http://127.0.0.1:${server.address().port}/api/telegram/manager-leave/miniapp/context`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({initData:signed(),requestId:'NP-1',expectedVersion:'1'})});
 const contextBody=await contextResponse.json();assert.equal(contextBody.request.timing_status,'Xin muộn');assert.equal(contextBody.request.registration_deadline_date,'2026-10-04');
 assert.equal((await send({note:' '.repeat(3)})).status,200);assert.equal(changes[0].note,'');assert.equal(changes[0].expectedVersion,'1');
 assert.equal((await send({expectedVersion:'0'})).status,409);assert.equal((await send({note:'a'.repeat(501)})).status,400);
 permission=false;assert.equal((await send({})).status,403);permission=true;row.trang_thai='Đã duyệt';assert.equal((await send({})).status,409);assert.equal(changes.length,1);
});
