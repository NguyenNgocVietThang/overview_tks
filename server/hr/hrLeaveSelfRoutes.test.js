'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const routes = require('./hrLeaveRoutes');
function res() { return { code: 0, status(code) {this.code=code; return this;}, json(body) {this.body=body; return this;} }; }
function handler(router, method, path) { const layer=router.stack.find(x=>x.route?.path===path && x.route.methods[method]); assert.ok(layer, path+' registered'); return layer.route.stack.at(-1).handle; }
function router(deps) { assert.equal(typeof routes.createHrLeaveRoutes, 'function', 'routes support injected collaborators'); return routes.createHrLeaveRoutes(deps); }
test('list enriches row capabilities using shared fresh authorization', async () => {
  const row = { request_id:'NP-1', bo_phan:'KHO', co_so:'Hà Nội' };
  const app=router({ repo:{getLeaveRequests:async()=>[row]}, authorization:{describeRequests:async(user, rows)=>rows.map(r=>({...r,canManage:false,routingWarning:'Chưa có người duyệt'}))} });
  const response=res(); await handler(app,'get','/api/hr/leave-requests')({ user:{vaiTro:'Quản lý'}, query:{} },response);
  assert.equal(response.code,200); assert.equal(response.body.requests[0].canManage,false); assert.equal(response.body.requests[0].routingWarning,'Chưa có người duyệt');
});
test('self-only viewers are restricted by server userId filter and retain no broad read route', async () => {
  let filters;
  const app=router({repo:{getLeaveRequests:async(f)=>{filters=f; return [{request_id:'OWN',user_id:'u-1'},{request_id:'OTHER',user_id:'u-2'}];}}, selfService:{context:async()=>({eligible:true,profile:{coSo:'Sài Gòn'}})}, authorization:{describeRequests:async(_,rows)=>rows.map(r=>({...r,canManage:false,routingWarning:''}))} });
  const response=res(); await handler(app,'get','/api/hr/leave-requests')({user:{id:'u-1',vaiTro:'Khách',permissions:['hr.leave.submit']},query:{employee:'other',branch:'Hà Nội'}},response);
  assert.equal(response.code,200); assert.equal(filters.userId,'u-1'); assert.deepEqual(response.body.requests.map(r=>r.request_id),['OWN']);
});
test('PATCH carries optimistic version to shared decisions even when reopening', async () => {
  let input;
  const app=router({decisions:{decide:async args=>{input=args; return {request_id:'NP-1',trang_thai:'Chưa duyệt'};},notifyDecision:async()=>{}}});
  const response=res(); await handler(app,'patch','/api/hr/leave-requests/:id/status')({user:{id:'m'},params:{id:'NP-1'},body:{status:'Chưa duyệt',expectedVersion:7}},response);
  assert.equal(response.code,200); assert.equal(input.expectedVersion,7); assert.equal(input.channel,'web');
});
test('self POST sends trusted session user and broadcasts created record', async () => {
  let received;
  const app=router({selfService:{submit:async(user,body)=>{received={user,body};return {request_id:'NEW',co_so:'Sài Gòn'};}}, authorization:{routingFor:async()=>({users:[],missing:false,fallback:false})},notifyAllUsers:async()=>{}});
  const response=res(); await handler(app,'post','/api/hr/leave-requests/self')({user:{id:'u-1'},body:{ly_do:'Ốm'}},response);
  assert.equal(response.code,201); assert.equal(received.user.id,'u-1'); assert.equal(response.body.request.request_id,'NEW');
});

test('self creation warns about missing routing and never notifies broad viewers', async () => {
  let broad = 0; let recipients;
  const app = router({
    selfService: { submit: async () => ({request_id:'NEW',bo_phan:'KHO',co_so:'Sài Gòn'}) },
    authorization: { routingFor: async () => ({users:[],missing:true,fallback:true}) },
    notifyAllUsers: async () => {broad++;},
    notifyApprovers: async ids => {recipients=ids;}
  });
  const response=res();await handler(app,'post','/api/hr/leave-requests/self')({user:{id:'u-1'},body:{}},response);
  assert.equal(response.code,201);assert.match(response.body.routingWarning,/Chưa có người duyệt/);assert.equal(broad,0);assert.equal(recipients,undefined);
});
test('self creation sends notifications only to routed approvers', async () => {
  let recipients;
  const app = router({
    selfService: { submit: async () => ({request_id:'NEW',bo_phan:'KHO',co_so:'Sài Gòn'}) },
    authorization: { routingFor: async () => ({users:[{id:'manager-kho'}],missing:false,fallback:false}) },
    notifyApprovers: async ids => {recipients=ids;}
  });
  const response=res();await handler(app,'post','/api/hr/leave-requests/self')({user:{id:'u-1'},body:{}},response);
  assert.equal(response.code,201);assert.deepEqual(recipients,['manager-kho']);
});

test('manual absence middleware requires its own permission even for leave approvers', () => {
  const app=router({});
  const route=app.stack.find(layer=>layer.route?.path==='/api/hr/leave-requests' && layer.route.methods.post).route;
  const guard=route.stack[1].handle;
  const denied=res();let next=false;
  guard({user:{permissions:['hr.leave','hr.leave.manage']}},denied,()=>{next=true;});
  assert.equal(denied.code,403);assert.equal(next,false);
  guard({user:{permissions:['hr.leave.absence.manage']}},res(),()=>{next=true;});assert.equal(next,true);
});

test('detail exposes current row decision capability and routing warning for notification controls', async () => {
  const app = router({
    repo: { getLeaveRequestById: async () => ({request_id:'NP-1',decision_version:'8'}) },
    authorization: { describeRequests: async (_,rows) => rows.map(row=>({...row,canManage:false,routingWarning:'Chưa có người duyệt'})) }
  });
  const response=res();await handler(app,'get','/api/hr/leave-requests/:id')({user:{id:'manager',permissions:['hr.leave']},params:{id:'NP-1'}},response);
  assert.equal(response.code,200);assert.equal(response.body.request.canManage,false);assert.equal(response.body.request.decision_version,'8');assert.equal(response.body.request.routingWarning,'Chưa có người duyệt');
});

test('legacy pending create notifies only scoped approvers while manual absence retains legacy notifications', async () => {
  const recipients=[];let broad=0;
  const app=router({
    repo:{...require('./hrLeaveRepository'),createLeaveRequest:async(payload,branch)=>({...payload,request_id:'NP-NEW',bo_phan:'KHO',co_so:branch})},
    authorization:{routingFor:async()=>({users:[{id:'kho-approver'}],missing:false,fallback:false})},
    notifyApprovers:async ids=>{recipients.push(ids);}, notifyAllUsers:async()=>{broad++;}
  });
  const create=handler(app,'post','/api/hr/leave-requests');
  const body={ho_ten:'A',ly_do:'Việc gia đình',start_date:'2026-10-08',start_session:'Sáng',end_date:'2026-10-08',end_session:'Chiều',co_tu_y_nghi:false};
  const pending=res();await create({user:{id:'manager'},branch:'Hà Nội',body},pending);
  assert.equal(pending.code,201);assert.deepEqual(recipients,[['kho-approver']]);assert.equal(broad,0);
  const absence=res();await create({user:{id:'manager'},branch:'Hà Nội',body:{...body,co_tu_y_nghi:true}},absence);
  assert.equal(absence.code,201);assert.equal(broad,1);assert.deepEqual(recipients,[['kho-approver']]);
});
