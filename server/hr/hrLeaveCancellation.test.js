'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cancellationEligibility, createHrLeaveCancellation } = require('./hrLeaveCancellation');
const user = {id:'owner'};
const row = {user_id:'owner',loai_yeu_cau:'Xin nghỉ phép',first_session_start_at:'2030-01-01T01:00:00Z'};
test('only the owner can cancel either source and every approval status before first session', () => {
  for (const source of ['web','telegram']) for (const trang_thai of ['Chưa duyệt','Đã duyệt','Từ chối']) {
    assert.equal(cancellationEligibility(user,{...row,source,trang_thai},new Date('2030-01-01T00:59:59.999Z')).canCancel,true);
  }
  assert.equal(cancellationEligibility({id:'manager'},row,new Date('2029-01-01')).canCancel,false);
  assert.equal(cancellationEligibility(user,{...row,loai_yeu_cau:'Nghỉ không phép'},new Date('2029-01-01')).canCancel,false);
});
test('deadline is exclusive and missing or invalid legacy timestamps fail closed', () => {
  for (const now of ['2030-01-01T01:00:00Z','2030-01-01T01:00:00.001Z']) assert.equal(cancellationEligibility(user,row,new Date(now)).canCancel,false);
  for (const value of [null,'','bad']) assert.equal(cancellationEligibility(user,{...row,first_session_start_at:value},new Date('2029-01-01')).canCancel,false);
});

test('cancellation service uses trusted owner and maps atomic SQL results',async()=>{
 let outcome='DELETED',input;
 const service=createHrLeaveCancellation({repo:{getLeaveRequestById:async()=>row},authorization:{routingFor:async()=>({users:[{id:'manager'}]})},pool:{query:async(sql,args)=>{input=args;return {rows:[{outcome,branch:'saigon'}]};}}});
 assert.equal((await service.cancel(user,'ID','3')).co_so,'Sài Gòn');assert.deepEqual(input,['ID','owner','3',['manager']]);
 for(const [result,status] of [['NOT_FOUND',404],['FORBIDDEN',403],['TYPE',403],['CONFLICT',409],['MISSING_START',409],['EXPIRED',409]]){
  outcome=result;await assert.rejects(service.cancel(user,'ID','3'),error=>error.statusCode===status);
 }
 await assert.rejects(service.cancel({id:'manager'},'ID','3'),error=>error.statusCode===403);
 for(const version of [null,-1,'1.1','9223372036854775808'])await assert.rejects(service.cancel(user,'ID',version),error=>error.statusCode===400);
});
