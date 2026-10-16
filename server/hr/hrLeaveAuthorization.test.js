'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const { normalizeDepartments, isActiveApprover, matchesApprovalScope, selectApprovers, createHrLeaveAuthorization }=require('./hrLeaveAuthorization');
const STAFF={id:'staff',username:'staff',vaiTro:'Nhân viên kho',trangThai:'Đang hoạt động',coSo:'Hà Nội',assignedCoSo:'Hà Nội',leaveApprovalDepartments:['Kho'],featurePermissions:{'hr.leave.manage':true}};
const REQUEST={request_id:'NP-1',co_so:'Hà Nội',bo_phan:' KHO ',user_id:'staff'};
test('staff grant approves own request only in explicit department and assigned branch',()=>{
 assert.equal(isActiveApprover(STAFF),true); assert.equal(matchesApprovalScope(STAFF,REQUEST),true);
 assert.equal(matchesApprovalScope(STAFF,{...REQUEST,bo_phan:'Kế toán'}),false);
 assert.equal(matchesApprovalScope({...STAFF,coSo:'Cả hai'}, {...REQUEST,co_so:'Sài Gòn'}),false);
 assert.equal(matchesApprovalScope({...STAFF,assignedCoSo:''},REQUEST),false);
 assert.deepEqual(normalizeDepartments([' Kho ','KHO','Kế  toán']),['Kho','Kế toán']);
});
test('recipient routing excludes inactive and revoked users and falls back only with no normal approver',()=>{
 const senior={...STAFF,id:'senior',username:'admin',leaveApprovalDepartments:[],assignedCoSo:''};
 assert.deepEqual(selectApprovers([STAFF,senior],REQUEST).users.map(u=>u.id),['staff']);
 const route=selectApprovers([{...STAFF,trangThai:'Khóa'},senior],REQUEST);
 assert.equal(route.fallback,true);assert.deepEqual(route.users.map(u=>u.id),['senior']);
 assert.equal(selectApprovers([{...senior,trangThai:'Khóa'}],REQUEST).missing,true);
 assert.equal(selectApprovers([{...STAFF,featurePermissions:{'hr.leave.manage':false}}],REQUEST).missing,true);
 assert.equal(selectApprovers([STAFF],{...REQUEST,bo_phan:''}).missing,true);
});
test('authorization reloads current account before every action and refuses revoked scope',async()=>{
 let current={...STAFF};const authorization=createHrLeaveAuthorization({loadUsers:async()=>[current]});
 assert.equal((await authorization.authorize(STAFF,REQUEST)).id,'staff');
 current={...STAFF,leaveApprovalDepartments:[]};
 await assert.rejects(authorization.authorize(STAFF,REQUEST),e=>e.statusCode===403);
 assert.equal(await authorization.canDecide(STAFF,REQUEST),false);
 current={...STAFF,username:'renamed',trangThai:'Khóa'};
 await assert.rejects(authorization.authorize(STAFF,REQUEST),e=>e.statusCode===403);
});
