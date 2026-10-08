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
test('schedule GET/PUT require fresh employee approval scope before reading or updating',async()=>{
 let writes=0,reads=0;const app=createHrLeaveRoutes({schedules:{getEmployee:async()=>({id:'2',branch:'saigon',bo_phan:'SALE'}),getSchedule:async()=>{reads++;},setSchedule:async()=>{writes++;}},authorization:{authorizeEmployee:async()=>{throw Object.assign(Error('forbidden'),{statusCode:403});}}});
 for(const method of ['get','put']){const response=res();await handler(app,method,'/api/hr/leave-work-schedules/:employeeId')({user:{id:'m'},params:{employeeId:'2'},query:{date:'2030-01-01'},body:{date:'2030-01-01',morningStart:'08:00',afternoonStart:null}},response);assert.equal(response.code,403);}
 assert.equal(writes,0);assert.equal(reads,0);
});
