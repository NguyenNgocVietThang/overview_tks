'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHrLeaveRoutes}=require('./hrLeaveRoutes');
function res(){return {status(c){this.code=c;return this;},json(b){this.body=b;return this;}};}
function handler(router,method,path){const route=router.stack.find(x=>x.route?.path===path && x.route.methods[method]);assert.ok(route,path+' exists');return route.route.stack.at(-1).handle;}
test('preview and resubmit delegate trusted identity and history hides unrelated rows from self-only accounts',async()=>{
 const app=createHrLeaveRoutes({repo:{getLeaveRequestById:async()=>({request_id:'OTHER',user_id:'u2',co_so:'Sài Gòn'}),getSubmissionHistory:async()=>{throw Error('must not read unrelated history');}},selfService:{preview:async(user)=>({timingStatus:user.id}),resubmit:async(user,id)=>({request_id:id,user_id:user.id}),context:async()=>({eligible:true,profile:{coSo:'Sài Gòn'}})}});
 const preview=res();await handler(app,'post','/api/hr/leave-requests/self/preview')({user:{id:'u1'},body:{}},preview);assert.equal(preview.body.timingStatus,'u1');
 const resend=res();await handler(app,'post','/api/hr/leave-requests/self/:id/resubmit')({user:{id:'u1'},params:{id:'OWN'},body:{}},resend);assert.equal(resend.body.request.request_id,'OWN');
 const history=res();await handler(app,'get','/api/hr/leave-requests/:id/history')({user:{id:'u1',permissions:['hr.leave.submit'],vaiTro:'Khách'},params:{id:'OTHER'}},history);assert.equal(history.code,404);
});
test('schedule GET/PUT require fresh account approval scope before reading or updating',async()=>{
 let writes=0,reads=0,scoped;const app=createHrLeaveRoutes({schedules:{getAccount:async()=>({user_id:'22222222-2222-2222-2222-222222222222',branch:'saigon',bo_phan:'Sale SG'}),getScheduleForUser:async()=>{reads++;},setScheduleForUser:async()=>{writes++;}},authorization:{authorizeEmployee:async(user,account)=>{scoped=account;throw Object.assign(Error('forbidden'),{statusCode:403});}}});
 for(const method of ['get','put']){const response=res();await handler(app,method,'/api/hr/leave-work-schedules/:userId')({user:{id:'m'},params:{userId:'22222222-2222-2222-2222-222222222222'},query:{date:'2030-01-01'},body:{date:'2030-01-01',morningStart:'08:00',afternoonStart:null}},response);assert.equal(response.code,403);}
 assert.equal(writes,0);assert.equal(reads,0);
 assert.deepEqual([scoped.branch,scoped.bo_phan],['saigon','Sale SG'],'phạm vi kiểm tra theo cơ sở/bộ phận của tài khoản');
});
test('schedule GET/PUT đọc và ghi lịch theo user_id khi có quyền',async()=>{
 const calls=[];const U='22222222-2222-2222-2222-222222222222';
 const app=createHrLeaveRoutes({schedules:{getAccount:async()=>({user_id:U,branch:'saigon',bo_phan:'Sale SG'}),getScheduleForUser:async(id,date)=>{calls.push(['get',id,date]);return {userId:id,date};},setScheduleForUser:async(id,patch)=>{calls.push(['set',id,patch.date,patch.morningStart]);return {userId:id,...patch};}},authorization:{authorizeEmployee:async()=>({id:'m'})}});
 const got=res();await handler(app,'get','/api/hr/leave-work-schedules/:userId')({user:{id:'m'},params:{userId:U},query:{date:'2030-01-01'}},got);
 assert.equal(got.body.schedule.userId,U);
 const put=res();await handler(app,'put','/api/hr/leave-work-schedules/:userId')({user:{id:'m'},params:{userId:U},body:{date:'2030-01-02',morningStart:'08:00',afternoonStart:null}},put);
 assert.equal(put.body.schedule.userId,U);
 assert.deepEqual(calls,[['get',U,'2030-01-01'],['set',U,'2030-01-02','08:00']]);
 const missing=createHrLeaveRoutes({schedules:{getAccount:async()=>null},authorization:{authorizeEmployee:async()=>({})}});
 const notFound=res();await handler(missing,'get','/api/hr/leave-work-schedules/:userId')({user:{id:'m'},params:{userId:U},query:{date:'2030-01-01'}},notFound);
 assert.equal(notFound.code,404);
});
