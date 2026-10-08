'use strict';
const test=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const UID='11111111-1111-1111-1111-111111111111';
async function fixture() {
 const db=new PGlite();
 await db.exec(`CREATE ROLE reporting_readonly;
 CREATE TABLE hr_employees(id BIGINT PRIMARY KEY,bo_phan TEXT,branch TEXT,is_active BOOLEAN DEFAULT true,ho_ten TEXT DEFAULT 'A');
 CREATE TABLE app_users(id UUID PRIMARY KEY,username TEXT,is_deleted BOOLEAN DEFAULT false,vai_tro TEXT,trang_thai TEXT,feature_permissions JSONB DEFAULT '{}',hr_employee_id BIGINT,telegram_id TEXT DEFAULT '',updated_at TIMESTAMPTZ DEFAULT now());
 INSERT INTO hr_employees(id,bo_phan,branch,is_active) VALUES(1,'KHO','hanoi',true),(2,'SALE','hanoi',true);
 INSERT INTO app_users(id,username,vai_tro,trang_thai,hr_employee_id) VALUES('${UID}','a','Nhân viên kho','Đang hoạt động',1);`);
 for(const filename of ['0016_hr_leave_telegram.sql','0029_hr_manager_telegram.sql','0030_drop_leave_provisional_status.sql','0031_hr_leave_approval_scope.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../db/migrations',filename),'utf8'));
 await db.exec(`INSERT INTO hr_leave_requests(request_id,user_id,branch,start_date,start_session,end_date,end_session,tong_buoi_nghi) VALUES('LEGACY','${UID}','hanoi','2030-01-01','Sáng','2030-01-01','Chiều',2)`);
 const migration=path.join(__dirname,'../db/migrations/0038_hr_leave_deadlines.sql');
 assert.ok(fs.existsSync(migration),'deadline migration exists');await db.exec(fs.readFileSync(migration,'utf8'));
 return db;
}
const insert=(id,date='2030-01-01',extra='')=>`INSERT INTO hr_leave_requests(request_id,user_id,branch,start_date,start_session,end_date,end_session,tong_buoi_nghi ${extra ? ','+extra.split('|')[0]:''}) VALUES('${id}','${UID}','hanoi','${date}','Sáng','${date}','Chiều',999 ${extra ? ','+extra.split('|')[1]:''})`;
test('database snapshots direct bot inserts authoritatively, preserves approvals and legacy, journals calendar updates',async()=>{
 let db;try {db=await fixture();
 await db.exec(`INSERT INTO hr_leave_work_schedules(employee_id,work_date,morning_start,afternoon_start) VALUES(1,'2030-01-01','08:15','13:00'),(1,'2030-01-02','09:00','14:00')`);
 await db.exec(insert('BOT','2030-01-01',`thoi_gian_gui,timing_status,submission_revision,bo_phan| '2000-01-01','Vi phạm',99,'SALE'`));
 let row=(await db.query("SELECT * FROM hr_leave_requests WHERE request_id='BOT'")).rows[0];
 assert.equal(row.tong_buoi_nghi,2);assert.equal(row.timing_status,'Đúng hạn');assert.equal(row.submission_revision,1);assert.notEqual(new Date(row.thoi_gian_gui).getUTCFullYear(),2000);assert.equal(row.trang_thai,'Chưa duyệt');assert.equal(row.bo_phan,'KHO');
 const before=row;
 await db.exec("UPDATE hr_leave_work_schedules SET morning_start='10:00',version=2 WHERE employee_id=1 AND work_date='2030-01-01'; UPDATE hr_leave_requests SET trang_thai='Đã duyệt',timing_status='Vi phạm',thoi_gian_gui='2000-01-01',schedule_version=99 WHERE request_id='BOT'");
 row=(await db.query("SELECT * FROM hr_leave_requests WHERE request_id='BOT'")).rows[0];assert.equal(row.timing_status,before.timing_status);assert.equal(row.schedule_version,before.schedule_version);assert.deepEqual(row.thoi_gian_gui,before.thoi_gian_gui);assert.equal(row.decision_version,1);
 await db.exec("UPDATE hr_leave_requests SET start_date='2030-01-02',end_date='2030-01-02' WHERE request_id='BOT'");
 row=(await db.query("SELECT * FROM hr_leave_requests WHERE request_id='BOT'")).rows[0];assert.equal(row.trang_thai,'Chưa duyệt');assert.equal(row.decision_version,2);assert.equal(row.submission_revision,2);assert.equal(row.nguoi_duyet,'');assert.equal(row.thoi_diem_duyet,null);assert.equal(row.decision_notified_at,null);assert.equal(row.leave_sessions[0].date,'2030-01-02');
 const history=(await db.query("SELECT * FROM hr_leave_submissions WHERE request_id='BOT' ORDER BY submission_revision")).rows;
 assert.equal(history.length,2);assert.equal(history[0].schedule_version,1);assert.equal(history[0].first_session_start_at.toISOString(),'2030-01-01T01:15:00.000Z');
 assert.equal((await db.query("SELECT timing_status FROM hr_leave_requests WHERE request_id='LEGACY'")).rows[0].timing_status,null);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM hr_leave_submissions WHERE request_id='LEGACY'")).rows[0].n,0);
 await assert.rejects(db.exec("UPDATE hr_leave_submissions SET timing_status='Vi phạm' WHERE request_id='BOT'"),/immutable/i);
 }finally{if(db)await db.close();}
});
test('missing schedules and invalid selections roll back both request and history; linked Telegram identity works',async()=>{
 let db;try {db=await fixture();
 await db.exec(insert('MISSING'));
 const fallback=(await db.query("SELECT schedule_start::text AS start,schedule_version::text AS version FROM hr_leave_requests WHERE request_id='MISSING'")).rows[0];
 assert.deepEqual(fallback,{start:'07:45:00',version:'0'});
 await db.exec(`INSERT INTO hr_leave_work_schedules(employee_id,work_date,morning_start,afternoon_start) VALUES(1,'2030-01-01','08:15','13:00');INSERT INTO hr_telegram_links(user_id,status,link_method,telegram_chat_id,linked_at) VALUES('${UID}','linked','manual','123',now());`);
 await db.exec("INSERT INTO hr_leave_requests(request_id,telegram_chat_id,branch,start_date,start_session,end_date,end_session,tong_buoi_nghi) VALUES('LINK','123','hanoi','2030-01-01','Sáng','2030-01-01','Chiều',2)");
 assert.equal((await db.query("SELECT hr_employee_id FROM hr_leave_requests WHERE request_id='LINK'")).rows[0].hr_employee_id,1);
 await assert.rejects(db.exec(insert('EMPTY','2030-01-01',"leave_sessions|'[]'::jsonb")),/INVALID_LEAVE_SESSIONS/);
 await assert.rejects(db.exec(insert('DUP','2030-01-01',`leave_sessions|'[{"date":"2030-01-01","session":"Sáng"},{"date":"2030-01-01","session":"Sáng"}]'::jsonb`)),/INVALID_LEAVE_SESSIONS/);
 }finally{if(db)await db.close();}
});
module.exports={fixture,UID};

test('SQL timing boundaries include entire deadline minute, use equal first start as violation and match large-session policy',async()=>{
 let db;try {db=await fixture();
 const cases=[['2026-10-06','08:15',2,'2026-10-04T16:59:59.999Z','Đúng hạn','2026-10-04'],['2026-10-06','08:15',2,'2026-10-04T17:00:00Z','Xin muộn','2026-10-04'],['2026-10-06','08:15',2,'2026-10-06T01:14:59.999Z','Xin muộn','2026-10-04'],['2026-10-06','08:15',2,'2026-10-06T01:15:00Z','Vi phạm','2026-10-04'],['2026-10-06','08:15',2,'2026-10-06T01:15:00.001Z','Vi phạm','2026-10-04'],['2026-10-08','08:15',4,'2026-10-05T16:59:59.999Z','Đúng hạn','2026-10-05'],['2028-03-01','08:15',2,'2028-02-28T17:00:00Z','Xin muộn','2028-02-28'],['2027-01-01','08:15',3,'2026-12-28T17:00:00Z','Đúng hạn','2026-12-29']];
 for(const [date,time,total,sent,label,deadline] of cases){const row=(await db.query('SELECT deadline_date::text AS deadline_date,timing FROM hr_leave_calculate_timing($1::date,$2::time,$3::int,$4::timestamptz)',[date,time,total,sent])).rows[0];assert.equal(row.timing,label);assert.equal(row.deadline_date,deadline);}
 }finally{if(db)await db.close();}
});

test('every registration timing can be approved without changing snapshot, and failed calendar edits roll back',async()=>{
 let db;try {db=await fixture();
 const {createHrLeaveRepository}=require('./hrLeaveRepository');const repo=createHrLeaveRepository({pool:db});
 const tomorrow=(await db.query("SELECT (((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)+1)::text AS date")).rows[0].date;
 for(const [id,date,label] of [['ON_TIME','2100-01-01','Đúng hạn'],['LATE',tomorrow,'Xin muộn'],['VIOLATION','2000-01-01','Vi phạm']]) {
  await db.query('INSERT INTO hr_leave_work_schedules(employee_id,work_date,morning_start,afternoon_start) VALUES(1,$1::date,\'08:15\',\'13:00\')',[date]);
  const row=await repo.createLeaveRequest({user_id:UID,hr_employee_id:1,start_date:date,start_session:'Sáng',end_date:date,end_session:'Chiều',tong_buoi_nghi:2},'Hà Nội');assert.equal(row.timing_status,label);assert.equal(row.trang_thai,'Chưa duyệt');
  const approved=await repo.updateLeaveRequestStatus(row.request_id,{status:'Đã duyệt',expectedVersion:'0'},'Hà Nội');assert.equal(approved.timing_status,label);assert.equal(approved.first_session_start_at,row.first_session_start_at);assert.equal(approved.thoi_gian_gui,row.thoi_gian_gui);assert.equal(approved.submission_revision,1);
  assert.equal((await repo.getSubmissionHistory(row.request_id)).length,1);assert.equal((await repo.getLeaveRequestById(row.request_id,'Hà Nội')).trang_thai,'Đã duyệt');
 }
 await assert.rejects(db.exec("INSERT INTO hr_leave_submissions SELECT * FROM hr_leave_submissions LIMIT 1"),/immutable/i);
 }finally{if(db)await db.close();}
});

test('real repository resubmission guards version, ownership and active employee linkage; same calendar resend journals',async()=>{
 let db;try {db=await fixture();
 const {createHrLeaveRepository}=require('./hrLeaveRepository');
 const repo=createHrLeaveRepository({pool:db});assert.equal(typeof repo.resubmitLeaveRequest,'function');
 await db.exec(`INSERT INTO hr_leave_work_schedules(employee_id,work_date,morning_start,afternoon_start) VALUES(1,'2030-01-01','08:15','13:00')`);
 const created=await repo.createLeaveRequest({user_id:UID,hr_employee_id:1,start_date:'2030-01-01',start_session:'Sáng',end_date:'2030-01-01',end_session:'Chiều',tong_buoi_nghi:2},'Hà Nội');
 const payload={userId:UID,employeeId:1,expectedVersion:'0',start_date:'2030-01-01',start_session:'Sáng',end_date:'2030-01-01',end_session:'Chiều',leave_sessions:created.leave_sessions,ly_do:'New reason',nguoi_ban_giao:''};
 const resent=await repo.resubmitLeaveRequest(created.request_id,payload,'Hà Nội');assert.equal(resent.submission_revision,2);assert.equal(resent.decision_version,'1');
 assert.equal((await repo.getSubmissionHistory(created.request_id)).length,2);
 await assert.rejects(repo.resubmitLeaveRequest(created.request_id,payload,'Hà Nội'),{statusCode:409});
 await db.exec(`UPDATE app_users SET hr_employee_id=2 WHERE id='${UID}'`);
 await assert.rejects(repo.resubmitLeaveRequest(created.request_id,{...payload,expectedVersion:'1'},'Hà Nội'),{statusCode:409});
 assert.equal((await repo.getSubmissionHistory(created.request_id)).length,2);
 }finally{if(db)await db.close();}
});
test('schedule repository round-trips nullable starts and database owns monotonically increasing version',async()=>{
 let db;try {db=await fixture();
 const repo=require('./hrLeaveWorkSchedulesRepository').createHrLeaveWorkSchedulesRepository({pool:db});
 assert.deepEqual(await repo.getSchedule('1','2030-01-01'),{employeeId:'1',date:'2030-01-01',morningStart:'07:45',afternoonStart:'12:30',version:'0'});
 const first=await repo.setSchedule('1',{date:'2030-01-01',morningStart:'08:15',afternoonStart:null});
 assert.deepEqual(first,{employeeId:'1',date:'2030-01-01',morningStart:'08:15',afternoonStart:'12:30',version:'1'});
 const next=await repo.setSchedule('1',{date:'2030-01-01',morningStart:null,afternoonStart:null});assert.equal(next.version,'2');assert.equal(next.morningStart,'07:45');
 assert.deepEqual(await repo.getSchedule('1','2030-01-01'),next);
 }finally{if(db)await db.close();}
});
