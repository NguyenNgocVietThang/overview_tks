'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createHrLeaveDecisionService}=require('./hrLeaveDecisionService');
const USER={id:'manager',hoTen:'An',vaiTro:'Quản lý'};
const REQUEST={request_id:'NP-1',co_so:'Hà Nội',bo_phan:'KHO',decision_version:'3'};
const authorization={authorize:async user=>user,routingFor:async()=>({users:[],fallback:false,missing:true})};
function fixture(patch={}) {return createHrLeaveDecisionService({authorization,repo:{getLeaveRequestById:async()=>REQUEST,updateLeaveRequestStatus:async (_id,data)=>({...REQUEST,trang_thai:data.status})},...patch});}
test('Telegram decision records trimmed reason, fresh approver and optimistic final guard',async()=>{
 let input;const service=fixture({repo:{getLeaveRequestById:async()=>REQUEST,updateLeaveRequestStatus:async(...args)=>{input=args;return REQUEST;}},authorization:{...authorization,authorize:async user=>({...user,hoTen:'Tên mới'})}});
 await service.decide({requestId:'NP-1',user:USER,status:'Từ chối',note:'  hết người trực  ',channel:'telegram',expectedVersion:'3'},{notify:false,broadcast:false});
 assert.equal(input[1].note,'Người duyệt: Tên mới - Quản lý\nLý do từ chối: hết người trực');assert.equal(input[1].expectedVersion,'3');assert.equal(input[1].lockFinal,true);
});
test('web decisions require version and guard reopening without locking final state',async()=>{
 let writes=0;const service=fixture({repo:{getLeaveRequestById:async()=>REQUEST,updateLeaveRequestStatus:async(_id,data)=>{writes++;assert.equal(data.expectedVersion,'3');assert.equal(data.lockFinal,false);return REQUEST;}}});
 await assert.rejects(service.decide({requestId:'NP-1',user:USER,status:'Chưa duyệt'}),e=>e.code==='INVALID_DECISION_VERSION');
 await service.decide({requestId:'NP-1',user:USER,status:'Chưa duyệt',expectedVersion:'3'},{notify:false,broadcast:false});
 for(const note of [123,'x'.repeat(501)])await assert.rejects(service.decide({requestId:'NP-1',user:USER,status:'Từ chối',note,expectedVersion:'3'}),e=>e.code==='INVALID_NOTE');
 assert.equal(writes,1);
});
test('revoked department authorization never writes a decision',async()=>{
 let writes=0;const service=fixture({authorization:{authorize:async()=>{throw Object.assign(new Error('denied'),{statusCode:403});}},repo:{getLeaveRequestById:async()=>REQUEST,updateLeaveRequestStatus:async()=>{writes++;}}});
 await assert.rejects(service.decide({requestId:'NP-1',user:USER,status:'Đã duyệt',expectedVersion:'3'}),e=>e.statusCode===403);assert.equal(writes,0);
});
test('decision notifications use request_id and survive notification failures',async()=>{
 const events=[],notes=[];const service=fixture({repo:{getLeaveRequestById:async()=>REQUEST,updateLeaveRequestStatus:async()=>({...REQUEST,ho_ten:'Lan',web_username:'lan'})},broadcast:(...args)=>events.push(args),notifyManagers:async(_id,_branch,payload)=>notes.push(payload),findEmployee:async()=>({id:'employee'}),notifyEmployee:async payload=>{notes.push(payload);throw new Error('unavailable');},logger:{error(){}}});
 const updated=await service.decide({requestId:'NP-1',user:USER,status:'Đã duyệt',expectedVersion:'3'});assert.equal(updated.request_id,'NP-1');assert.equal(events[0][0],'LEAVE_STATUS_CHANGED');assert.ok(notes.every(n=>n.relatedId==='NP-1'));
});
