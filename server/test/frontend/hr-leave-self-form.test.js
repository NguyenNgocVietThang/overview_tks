'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../../public/humanresources/index.html'),'utf8');
function page(features=['hr.leave','hr.leave.manage','hr.leave.submit']) {
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://example.test/humanresources/'});const w=dom.window;
  w.TKSNav={can:feature=>features.includes(feature),handleBranchError:()=>false};
  for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) if(match[1].trim()) w.eval(match[1]);
  return dom;
}
const row={request_id:'NP-1',ho_ten:'A',trang_thai:'Đã duyệt',canManage:true,decision_version:9,thoi_gian_bat_dau:'Sáng 06/10/2026',thoi_gian_ket_thuc:'Chiều 06/10/2026'};
test('approval dropdowns follow per-row canManage and submit the displayed version for reopening',async()=>{
 const dom=page();const w=dom.window;try{
 w.fetch=async()=>({ok:true,status:200,json:async()=>({requests:[row,{...row,request_id:'NP-2',canManage:false}],summary:[]})});
 await w.loadLeaveRequests(); await new Promise(r=>setImmediate(r));
 assert.equal(w.document.querySelectorAll('select.status-select').length,1);
 let body;w.fetch=async(url,opts)=>{body=JSON.parse(opts.body);return {ok:true,status:200,json:async()=>({request:{...row,trang_thai:'Chưa duyệt',decision_version:10}})}};
 const select=w.document.querySelector('select.status-select');await w.submitStatusChange(select,'NP-1','Chưa duyệt');
 assert.equal(body.expectedVersion,9);assert.equal(body.status,'Chưa duyệt');
 }finally{dom.window.close();}
});
test('self form shows trusted read-only profile and sends dates, sessions, reason and optional handover once',async()=>{
 const dom=page(['hr.leave.submit']);const w=dom.window;try{
 assert.equal(typeof w.openSelfLeave,'function');
 const profile={hoTen:'Nhân viên thật',boPhan:'HẬU CẦN',coSo:'Sài Gòn',username:'staff'};let submissions=0;let payload;let finish;
 w.fetch=async(url,opts)=>{
 if(String(url).includes('/self/context'))return {ok:true,status:200,json:async()=>({eligible:true,profile})};
 if(opts?.method==='POST'){submissions++;payload=JSON.parse(opts.body);await new Promise(r=>finish=r);return {ok:true,status:201,json:async()=>({request:{request_id:'NEW'}})};}
 return {ok:true,status:200,json:async()=>({requests:[],summary:[]})};};
 await w.openSelfLeave();assert.equal(w.document.getElementById('selfLeaveIdentity').textContent.includes('Nhân viên thật'),true);assert.equal(w.document.getElementById('selfLeaveModal').hidden,false);
 for(const [id,value] of Object.entries({slStartDate:'2026-10-06',slEndDate:'2026-10-07',slStartSession:'Sáng',slEndSession:'Chiều',slReason:' Việc nhà ',slHandover:' An '}))w.document.getElementById(id).value=value;
 w.updateSelfLeavePreview();assert.match(w.document.getElementById('selfLeaveDuration').textContent,/4 buổi/);
 const event={preventDefault(){}};const pending=w.handleSelfLeaveSubmit(event);await w.handleSelfLeaveSubmit(event);assert.equal(submissions,1);assert.equal(w.document.getElementById('selfLeaveSubmit').disabled,true);
 assert.deepEqual(Object.keys(payload).sort(),['end_date','end_session','ly_do','nguoi_ban_giao','start_date','start_session']);assert.equal(payload.ly_do,'Việc nhà');
 finish();await pending;assert.equal(w.document.getElementById('selfLeaveModal').hidden,true);
 }finally{dom.window.close();}
});
test('self form blocks empty reason and invalid range without submitting',async()=>{
 const dom=page(['hr.leave.submit']);const w=dom.window;try{
 assert.equal(typeof w.openSelfLeave,'function');let posts=0;
 w.fetch=async(url,opts)=>{if(opts?.method==='POST')posts++;return {ok:true,status:200,json:async()=>({eligible:true,profile:{hoTen:'A'}})};};await w.openSelfLeave();
 w.document.getElementById('slReason').value='  ';await w.handleSelfLeaveSubmit({preventDefault(){}});assert.equal(posts,0);assert.match(w.document.getElementById('selfLeaveMsg').textContent,/lý do/);
 w.document.getElementById('slReason').value='Ốm';w.document.getElementById('slStartDate').value='2026-10-07';w.document.getElementById('slEndDate').value='2026-10-06';await w.handleSelfLeaveSubmit({preventDefault(){}});assert.equal(posts,0);
 }finally{dom.window.close();}
});

test('self-only users see all of their submissions without a broad-view default date or status filter',()=>{
 const dom=page(['hr.leave.submit']);try{const w=dom.window;w.initDefaultLeaveFilters();assert.equal(w.document.getElementById('statusFilter').value,'');assert.equal(w.document.getElementById('fromDateFilter').value,'');}finally{dom.window.close();}
});

test('self form preserves entered data and re-enables submit after server denial',async()=>{
 const dom=page(['hr.leave.submit']);const w=dom.window;try{
 w.fetch=async(url,opts)=>opts?.method==='POST'?{ok:false,status:403,json:async()=>({error:'Hồ sơ nhân sự đã ngừng hoạt động.'})}:{ok:true,status:200,json:async()=>({eligible:true,profile:{hoTen:'A'}})};
 await w.openSelfLeave();w.document.getElementById('slStartDate').value='2026-10-06';w.document.getElementById('slReason').value='Việc gia đình';
 await w.handleSelfLeaveSubmit({preventDefault(){}});
 assert.equal(w.document.getElementById('selfLeaveModal').hidden,false);assert.equal(w.document.getElementById('selfLeaveSubmit').disabled,false);assert.equal(w.document.getElementById('slReason').value,'Việc gia đình');assert.match(w.document.getElementById('selfLeaveMsg').textContent,/ngừng hoạt động/);
 }finally{dom.window.close();}
});

test('HR submission timestamps display the Vietnam calendar date and time',()=>{
 const dom=page();try{assert.equal(dom.window.formatDateTime('2026-10-05T18:30:00.000Z'),'06/10/2026 01:30');}finally{dom.window.close();}
});
