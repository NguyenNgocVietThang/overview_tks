'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const UID = '11111111-1111-1111-1111-111111111111';
const dir = path.join(__dirname, '../db/migrations');

test('migration 0073 đổi Bộ phận theo cơ sở, nhân đôi quyền duyệt và đổi snapshot đơn nghỉ cũ', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE reporting_readonly;
      CREATE TABLE hr_employees(id BIGINT PRIMARY KEY, bo_phan TEXT, branch TEXT, updated_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE app_users(id UUID PRIMARY KEY,username TEXT,is_deleted BOOLEAN DEFAULT false,vai_tro TEXT,trang_thai TEXT,feature_permissions JSONB DEFAULT '{}',hr_employee_id BIGINT,telegram_id TEXT DEFAULT '',updated_at TIMESTAMPTZ DEFAULT now());
      INSERT INTO hr_employees(id,bo_phan,branch) VALUES (1,'KHO','hanoi'),(2,'KHO','saigon'),(3,'SALE','hanoi'),(4,'SALE','saigon'),(5,'BAN QUẢN TRỊ','hanoi'),(6,'TRƯỞNG CHI NHÁNH','saigon'),(7,'KẾ TOÁN','saigon'),(8,'TRỰC PAGE','hanoi'),(9,'TRỢ LÝ','saigon'),(10,'Lái Xe','hanoi');
      INSERT INTO app_users(id,username,is_deleted,vai_tro,trang_thai,feature_permissions,hr_employee_id) VALUES ('${UID}','manager',false,'Quản lý','Đang hoạt động','{}',1);`);
    for (const f of ['0016_hr_leave_telegram.sql', '0029_hr_manager_telegram.sql', '0030_drop_leave_provisional_status.sql', '0031_hr_leave_approval_scope.sql', '0032_hr_department_groups.sql']) {
      await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    }
    await db.exec(`UPDATE app_users SET leave_approval_departments = ARRAY['KHO','SALE','HẬU CẦN - BẢO VỆ','BAN QUẢN TRỊ'];
      INSERT INTO hr_leave_requests(request_id,hr_employee_id,branch,start_date,start_session,end_date,end_session,tong_buoi_nghi) VALUES ('SG','2','saigon','2026-10-06','Sáng','2026-10-06','Chiều',2);`);
    const migration = fs.readFileSync(path.join(dir, '0073_hr_department_catalog.sql'), 'utf8');
    await db.exec(migration);
    const dept = async id => (await db.query('SELECT bo_phan FROM hr_employees WHERE id=$1', [id])).rows[0].bo_phan;
    assert.equal(await dept(1), 'Kho HN');
    assert.equal(await dept(2), 'Kho SG');
    assert.equal(await dept(3), 'Sale HN');
    assert.equal(await dept(4), 'Sale SG');
    assert.equal(await dept(5), 'Ban quản trị');
    assert.equal(await dept(6), 'Quản lý-KT SG');
    assert.equal(await dept(7), 'Quản lý-KT SG');
    assert.equal(await dept(8), 'TRỰC PAGE', 'bộ phận ngoài danh sách giữ nguyên');
    assert.equal(await dept(9), 'TRỢ LÝ', 'Trợ lý Sài Gòn không có trong file nên giữ nguyên');
    assert.equal(await dept(10), 'Lái xe HN');
    const grants = (await db.query('SELECT leave_approval_departments g FROM app_users')).rows[0].g;
    assert.deepEqual([...grants].sort(), ['Ban quản trị', 'HẬU CẦN - BẢO VỆ', 'Kho HN', 'Kho SG', 'Quản lý-KT SG', 'Sale HN', 'Sale SG'].sort());
    assert.equal((await db.query("SELECT bo_phan FROM hr_leave_requests WHERE request_id='SG'")).rows[0].bo_phan, 'Kho SG');
    await db.exec(migration);
    assert.equal(await dept(1), 'Kho HN', 'chạy lại không đổi thêm');
  } finally { await db.close(); }
});
