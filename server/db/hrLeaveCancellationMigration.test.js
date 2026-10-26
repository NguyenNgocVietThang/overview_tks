'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const U='11111111-1111-1111-1111-111111111111', M='22222222-2222-2222-2222-222222222222';
async function fixture(){
 const db=new PGlite();
 await db.exec(`CREATE ROLE reporting_readonly;
 CREATE TABLE hr_employees(id BIGINT PRIMARY KEY,bo_phan TEXT,branch TEXT,is_active BOOLEAN DEFAULT true,ho_ten TEXT DEFAULT 'A');
 CREATE TABLE app_users(id UUID PRIMARY KEY,username TEXT,is_deleted BOOLEAN DEFAULT false,vai_tro TEXT,trang_thai TEXT,feature_permissions JSONB DEFAULT '{}',hr_employee_id BIGINT,telegram_id TEXT DEFAULT '',updated_at TIMESTAMPTZ DEFAULT now());
 INSERT INTO hr_employees VALUES(1,'KHO','hanoi',true,'A');
 INSERT INTO app_users(id,username,vai_tro,trang_thai,hr_employee_id) VALUES('${U}','owner','Nhân viên kho','Đang hoạt động',1);
 INSERT INTO app_users(id,username,vai_tro,trang_thai,telegram_id) VALUES('${M}','manager','Quản lý','Đang hoạt động','123');`);
 for(const name of ['0016_hr_leave_telegram.sql','0029_hr_manager_telegram.sql','0030_drop_leave_provisional_status.sql','0031_hr_leave_approval_scope.sql','0038_hr_leave_deadlines.sql','0093_notifications.sql','0094_hr_leave_cancellation.sql']) await db.exec(fs.readFileSync(path.join(__dirname,'migrations',name),'utf8'));
 return db;
}
async function insert(db,id,{date='2100-01-01',source='web'}={}){
 await db.query(`INSERT INTO hr_leave_requests(request_id,user_id,source,branch,start_date,start_session,end_date,end_session,tong_buoi_nghi,ho_ten) VALUES($1,$2::uuid,$3,'hanoi',$4::date,'Sáng',$4::date,'Chiều',2,'A')`,[id,U,source,date]);
}
async function cancel(db,id,actor=U,version='0'){
 return (await db.query('SELECT * FROM hr_cancel_own_leave($1,$2,$3::bigint,$4::text[])',[id,actor,version,[M,M]])).rows[0].outcome;
}
test('real SQL deletes every source/status with history and durable deduplicated notifications',async()=>{
 const db=await fixture();try{
 for(const source of ['web','telegram']) for(const status of ['Chưa duyệt','Đã duyệt','Từ chối']){
  const id=source+status;await insert(db,id,{source});
  if(status!=='Chưa duyệt') await db.query('UPDATE hr_leave_requests SET trang_thai=$2,approver_user_id=$3::uuid WHERE request_id=$1',[id,status,M]);
  const version=(await db.query('SELECT decision_version FROM hr_leave_requests WHERE request_id=$1',[id])).rows[0].decision_version;
  await db.query(`INSERT INTO hr_manager_telegram_cards(request_id,user_id,telegram_chat_id,message_id,expected_version) VALUES($1,$2::uuid,'123',44,$3::bigint)`,[id,M,version]);
  await db.query(`INSERT INTO notifications(id,recipient_user_id,type,related_type,related_id) VALUES(gen_random_uuid(),$1,'old','leaveRequest',$2)`,[M,id]);
  assert.equal(await cancel(db,id,U,String(version)),'DELETED');
  for(const table of ['hr_leave_requests','hr_leave_submissions','hr_manager_telegram_cards','hr_leave_change_events','hr_leave_approver_recipients']) assert.equal((await db.query(`SELECT count(*)::int n FROM ${table} WHERE request_id=$1`,[id])).rows[0].n,0,table);
  assert.equal((await db.query('SELECT count(*)::int n FROM hr_leave_cancellation_jobs WHERE request_id=$1',[id])).rows[0].n,2);
  assert.equal((await db.query('SELECT count(*)::int n FROM notifications WHERE related_id=$1',[id])).rows[0].n,0);
  assert.equal(await cancel(db,id),'NOT_FOUND');
 }
 assert.equal((await db.query("SELECT count(*)::int n FROM notifications WHERE type='hr_leave_cancelled' AND related_id IS NULL")).rows[0].n,6);
 }finally{await db.close();}
});
test('SQL rejects nonowners, stale versions, inactive owners, absence records and expired starts',async()=>{
 const db=await fixture();try{
 await insert(db,'FUTURE');
 assert.equal(await cancel(db,'FUTURE',M),'FORBIDDEN');assert.equal(await cancel(db,'FUTURE',U,'2'),'CONFLICT');
 await db.exec(`UPDATE app_users SET trang_thai='Đã khóa' WHERE id='${U}'`);assert.equal(await cancel(db,'FUTURE'),'FORBIDDEN');
 await db.exec(`UPDATE app_users SET trang_thai='Đang hoạt động' WHERE id='${U}'`);
 await db.exec("UPDATE hr_leave_requests SET loai_yeu_cau='Tự ý nghỉ (HR ghi nhận)' WHERE request_id='FUTURE'");
 const version=(await db.query("SELECT decision_version FROM hr_leave_requests WHERE request_id='FUTURE'")).rows[0].decision_version;
 assert.equal(await cancel(db,'FUTURE',U,String(version)),'TYPE');
 await insert(db,'PAST',{date:'2000-01-01'});assert.equal(await cancel(db,'PAST'),'EXPIRED');
 assert.equal((await db.query('SELECT count(*)::int n FROM hr_leave_cancellation_jobs')).rows[0].n,0);
 }finally{await db.close();}
});
test('history guard survives and a failing deletion rolls back jobs, notifications and request',async()=>{
 const db=await fixture();try{
 await insert(db,'ROLLBACK');
 await db.query(`INSERT INTO hr_manager_telegram_updates(update_id,payload,effects) VALUES(55,'{}'::jsonb,$1::jsonb)`,[JSON.stringify([{method:'notifyDecision',request:{request_id:'ROLLBACK',ly_do:'private snapshot'}}])]);
 await assert.rejects(db.exec("DELETE FROM hr_leave_submissions WHERE request_id='ROLLBACK'"),/immutable/);
 await assert.rejects(db.exec("UPDATE hr_leave_submissions SET ly_do='bad' WHERE request_id='ROLLBACK'"),/immutable/);
 await assert.rejects(db.exec("DELETE FROM hr_leave_requests WHERE request_id='ROLLBACK'"),/validated owner/);
 await db.exec(`CREATE FUNCTION fail_delete() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced rollback'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER zz_fail_delete BEFORE DELETE ON hr_leave_requests FOR EACH ROW EXECUTE FUNCTION fail_delete();`);
 await assert.rejects(cancel(db,'ROLLBACK'),/forced rollback/);
 assert.equal((await db.query('SELECT count(*)::int n FROM hr_leave_cancellation_jobs')).rows[0].n,0);
 assert.equal((await db.query('SELECT count(*)::int n FROM notifications')).rows[0].n,0);
 assert.equal((await db.query('SELECT count(*)::int n FROM hr_leave_submissions')).rows[0].n,1);
 await db.exec('DROP TRIGGER zz_fail_delete ON hr_leave_requests');assert.equal(await cancel(db,'ROLLBACK'),'DELETED');
 const inbox=(await db.query('SELECT * FROM hr_manager_telegram_updates WHERE update_id=55')).rows[0];
 assert.deepEqual(inbox.payload,{});assert.deepEqual(inbox.effects,[]);assert.ok(inbox.completed_at);
 await db.query(`INSERT INTO notifications(id,recipient_user_id,type,related_type,related_id) VALUES(gen_random_uuid(),$1,'late','leaveRequest','ROLLBACK')`,[M]);
 assert.equal((await db.query("SELECT count(*)::int n FROM notifications WHERE type='late'")).rows[0].n,0);
 }finally{await db.close();}
});

test('legacy missing starts fail closed and previous approvers remain recipients after later decisions',async()=>{
 const db=await fixture();try{
 await insert(db,'LEGACY');
 // Simulate a historical snapshot, without weakening production triggers.
 await db.exec("ALTER TABLE hr_leave_requests DISABLE TRIGGER hr_leave_00_submission; UPDATE hr_leave_requests SET first_session_start_at=NULL WHERE request_id='LEGACY'; ALTER TABLE hr_leave_requests ENABLE TRIGGER hr_leave_00_submission");
 assert.equal(await cancel(db,'LEGACY'),'MISSING_START');
 const other='33333333-3333-3333-3333-333333333333';
 await db.query("INSERT INTO app_users(id,username,trang_thai) VALUES($1::uuid,'previous','Đang hoạt động')",[other]);
 await insert(db,'HISTORY');
 await db.query("UPDATE hr_leave_requests SET trang_thai='Đã duyệt',approver_user_id=$1::uuid WHERE request_id='HISTORY'",[other]);
 await db.query("UPDATE hr_leave_requests SET trang_thai='Từ chối',approver_user_id=$1::uuid WHERE request_id='HISTORY'",[M]);
 assert.equal(await cancel(db,'HISTORY',U,'2'),'DELETED');
 const recipients=(await db.query("SELECT recipient_user_id FROM notifications WHERE type='hr_leave_cancelled' ORDER BY recipient_user_id")).rows;
 assert.deepEqual(recipients.map(r=>r.recipient_user_id),[M,other]);
 }finally{await db.close();}
});
