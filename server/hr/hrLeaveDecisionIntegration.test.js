'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {PGlite}=require('@electric-sql/pglite');
const {createHrLeaveRepository}=require('./hrLeaveRepository');const {createHrLeaveDecisionService}=require('./hrLeaveDecisionService');const {createHrLeaveAuthorization}=require('./hrLeaveAuthorization');
const UID='11111111-1111-1111-1111-111111111111';
test('actual PostgreSQL guards concurrent web/Telegram decisions, reopening and revoked scope',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE reporting_readonly;CREATE TABLE hr_employees(id BIGINT PRIMARY KEY,bo_phan TEXT);CREATE TABLE app_users(id UUID PRIMARY KEY,username TEXT,is_deleted BOOLEAN DEFAULT false,vai_tro TEXT,trang_thai TEXT,co_so TEXT,feature_permissions JSONB DEFAULT '{}',hr_employee_id BIGINT,telegram_id TEXT DEFAULT '',updated_at TIMESTAMPTZ DEFAULT now());INSERT INTO hr_employees VALUES(1,'KHO');INSERT INTO app_users(id,username,vai_tro,trang_thai,co_so,hr_employee_id,feature_permissions) VALUES('${UID}','staff','Nhân viên kho','Đang hoạt động','hanoi',1,'{"hr.leave.manage":true}');`);
 for(const filename of ['0016_hr_leave_telegram.sql','0029_hr_manager_telegram.sql','0030_drop_leave_provisional_status.sql','0031_hr_leave_approval_scope.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../db/migrations',filename),'utf8'));
 await db.exec("ALTER TABLE hr_employees ADD COLUMN branch TEXT DEFAULT 'hanoi', ADD COLUMN is_active BOOLEAN DEFAULT true");
 await db.exec(fs.readFileSync(path.join(__dirname,'../db/migrations/0038_hr_leave_deadlines.sql'),'utf8'));
 await db.exec("INSERT INTO hr_leave_work_schedules(employee_id,work_date,morning_start,afternoon_start) VALUES(1,'2026-10-06','08:15','13:00')");
 const pool={query:(sql,params)=>db.query(sql,params)};const repo=createHrLeaveRepository({pool});
 const loadUsers=async()=> (await db.query('SELECT * FROM app_users')).rows.map(row=>({id:row.id,username:row.username,vaiTro:row.vai_tro,trangThai:row.trang_thai,assignedCoSo:'Hà Nội',leaveApprovalDepartments:row.leave_approval_departments,featurePermissions:row.feature_permissions,isDeleted:row.is_deleted}));
 const authorization=createHrLeaveAuthorization({loadUsers});const service=createHrLeaveDecisionService({repo,authorization});const user=(await loadUsers())[0];
 const record=await repo.createLeaveRequest({user_id:UID,hr_employee_id:1,bo_phan:'KHO',ho_ten:'Nhân viên A',start_date:'2026-10-06',start_session:'Sáng',end_date:'2026-10-06',end_session:'Chiều',tong_buoi_nghi:2},'Hà Nội');
 const options={notify:false,broadcast:false};
 const results=await Promise.allSettled([
  service.decide({requestId:record.request_id,user,status:'Đã duyệt',channel:'web',expectedVersion:'0'},options),
  service.decide({requestId:record.request_id,user,status:'Từ chối',note:'khác',channel:'telegram',expectedVersion:'0'},options)
 ]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(results.find(result=>result.status==='rejected').reason.code,'LEAVE_DECISION_CONFLICT');
 let row=await repo.getLeaveRequestById(record.request_id,'Hà Nội');assert.equal(row.decision_version,'1');
 await service.decide({requestId:record.request_id,user,status:'Chưa duyệt',channel:'web',expectedVersion:'1'},options);
 row=await repo.getLeaveRequestById(record.request_id,'Hà Nội');assert.equal(row.decision_version,'2');
 // External employee notifier keeps its unchanged scan contract: web without a chat is excluded.
 assert.ok((await db.query('SELECT decision_notified_at FROM hr_leave_requests WHERE request_id=$1',[record.request_id])).rows[0].decision_notified_at);
 const linked=await repo.createLeaveRequest({user_id:UID,hr_employee_id:1,bo_phan:'KHO',telegram_chat_id:'12345',start_date:'2026-10-06',start_session:'Sáng',end_date:'2026-10-06',end_session:'Chiều',tong_buoi_nghi:2},'Hà Nội');
 await service.decide({requestId:linked.request_id,user,status:'Đã duyệt',expectedVersion:'0'},options);
 assert.equal((await db.query('SELECT decision_notified_at FROM hr_leave_requests WHERE request_id=$1',[linked.request_id])).rows[0].decision_notified_at,null);
 await db.query('UPDATE hr_leave_requests SET decision_notified_at=now() WHERE request_id=$1',[linked.request_id]);
 await service.decide({requestId:linked.request_id,user,status:'Chưa duyệt',expectedVersion:'1'},options);
 assert.equal((await db.query('SELECT decision_notified_at FROM hr_leave_requests WHERE request_id=$1',[linked.request_id])).rows[0].decision_notified_at,null);
 await db.exec("UPDATE hr_employees SET bo_phan='Kế toán' WHERE id=1;UPDATE app_users SET leave_approval_departments='{}'");
 assert.equal((await repo.getLeaveRequestById(record.request_id,'Hà Nội')).bo_phan,'KHO');
 await assert.rejects(service.decide({requestId:record.request_id,user,status:'Đã duyệt',expectedVersion:'2'},options),error=>error.statusCode===403);
 assert.equal((await repo.getLeaveRequestById(record.request_id,'Hà Nội')).decision_version,'2');
 }finally{await db.close();}
});
