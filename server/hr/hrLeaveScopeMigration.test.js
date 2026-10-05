'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {PGlite}=require('@electric-sql/pglite');
const UID='11111111-1111-1111-1111-111111111111';
test('migration backfills existing grants and freezes departments on external bot and web inserts',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE reporting_readonly;CREATE TABLE hr_employees(id BIGINT PRIMARY KEY,bo_phan TEXT);CREATE TABLE app_users(id UUID PRIMARY KEY,username TEXT,is_deleted BOOLEAN DEFAULT false,vai_tro TEXT,trang_thai TEXT,feature_permissions JSONB DEFAULT '{}',hr_employee_id BIGINT,telegram_id TEXT DEFAULT '',updated_at TIMESTAMPTZ DEFAULT now());INSERT INTO hr_employees VALUES (1,'KHO'),(2,'Kế toán');INSERT INTO app_users(id,username,is_deleted,vai_tro,trang_thai,feature_permissions,hr_employee_id) VALUES ('${UID}','manager',false,'Quản lý','Đang hoạt động','{}',1);`);
 for(const filename of ['0016_hr_leave_telegram.sql','0029_hr_manager_telegram.sql','0030_drop_leave_provisional_status.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../db/migrations',filename),'utf8'));
 await db.exec(`INSERT INTO hr_leave_requests(request_id,user_id,branch,start_date,start_session,end_date,end_session,tong_buoi_nghi) VALUES ('OLD','${UID}','hanoi','2026-10-06','Sáng','2026-10-06','Chiều',2);`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../db/migrations/0031_hr_leave_approval_scope.sql'),'utf8'));
 assert.deepEqual((await db.query('SELECT leave_approval_departments FROM app_users')).rows[0].leave_approval_departments,['KHO','Kế toán']);
 assert.equal((await db.query("SELECT bo_phan FROM hr_leave_requests WHERE request_id='OLD'")).rows[0].bo_phan,'KHO');
 await db.exec(`INSERT INTO hr_leave_requests(request_id,hr_employee_id,branch,start_date,start_session,end_date,end_session,tong_buoi_nghi) VALUES ('BOT',1,'hanoi','2026-10-06','Sáng','2026-10-06','Chiều',2);UPDATE hr_employees SET bo_phan='Sale' WHERE id=1; UPDATE hr_leave_requests SET trang_thai='Đã duyệt',bo_phan='Sale' WHERE request_id='BOT';`);
 assert.equal((await db.query("SELECT bo_phan FROM hr_leave_requests WHERE request_id='BOT'")).rows[0].bo_phan,'KHO');
 await db.exec(`INSERT INTO hr_leave_requests(request_id,user_id,source,branch,start_date,start_session,end_date,end_session,tong_buoi_nghi) VALUES ('WEB','${UID}','web','hanoi','2026-10-06','Sáng','2026-10-06','Chiều',2);`);
 assert.equal((await db.query("SELECT bo_phan FROM hr_leave_requests WHERE request_id='WEB'")).rows[0].bo_phan,'Sale');
 await db.exec(`ALTER TABLE hr_employees ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
 INSERT INTO hr_employees(id,bo_phan) VALUES (3,'TRƯỞNG CHI NHÁNH'),(4,'Ban quản lý'),(5,'HẬU CẦN'),(6,'Bảo vệ');
 UPDATE app_users SET leave_approval_departments=ARRAY['TRƯỞNG CHI NHÁNH','BAN QUẢN LÝ','HẬU CẦN','BẢO VỆ','KHO'];
 INSERT INTO hr_leave_requests(request_id,hr_employee_id,branch,start_date,start_session,end_date,end_session,tong_buoi_nghi) VALUES ('LEGACY',3,'hanoi','2026-10-06','Sáng','2026-10-06','Chiều',2);`);
 const migration=fs.readFileSync(path.join(__dirname,'../db/migrations/0032_hr_department_groups.sql'),'utf8');
 await db.exec(migration);
 assert.deepEqual((await db.query('SELECT bo_phan FROM hr_employees WHERE id >= 3 ORDER BY id')).rows.map(row=>row.bo_phan),['BAN QUẢN TRỊ','BAN QUẢN TRỊ','HẬU CẦN - BẢO VỆ','HẬU CẦN - BẢO VỆ']);
 assert.deepEqual((await db.query('SELECT leave_approval_departments FROM app_users')).rows[0].leave_approval_departments,['BAN QUẢN TRỊ','HẬU CẦN - BẢO VỆ','KHO']);
 assert.equal((await db.query("SELECT bo_phan FROM hr_leave_requests WHERE request_id='LEGACY'")).rows[0].bo_phan,'BAN QUẢN TRỊ');
 await db.exec("UPDATE hr_leave_requests SET bo_phan='KHO' WHERE request_id='LEGACY'");
 assert.equal((await db.query("SELECT bo_phan FROM hr_leave_requests WHERE request_id='LEGACY'")).rows[0].bo_phan,'BAN QUẢN TRỊ');
 await db.exec(migration);
 assert.equal((await db.query('SELECT vai_tro FROM app_users')).rows[0].vai_tro,'Quản lý');
 }finally{await db.close();}
});
