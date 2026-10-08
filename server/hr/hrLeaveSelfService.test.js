'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const target = './hrLeaveSelfService';
const exists = fs.existsSync(require('node:path').join(__dirname, target + '.js'));
const create = exists ? require(target).createHrLeaveSelfService : undefined;
const account = { user_id: 'u-1', username: 'real-user', hr_employee_id: 42, ho_ten: 'Tên thật', bo_phan: 'KHO', branch: 'saigon', vai_tro: 'Khách' };
const body = { start_date: '2026-10-06', start_session: 'Sáng', end_date: '2026-10-07', end_session: 'Chiều', ly_do: '  Việc nhà  ', nguoi_ban_giao: '  An  ', user_id: 'victim', hr_employee_id: 99, ho_ten: 'Giả', bo_phan: 'SALE', co_so: 'Hà Nội', trang_thai: 'Đã duyệt', tong_buoi_nghi: 99, co_nghi_gap: false };
function service(profile = account, instant = '2026-10-05T15:00:00.000Z') {
  let persisted;
  const instance = create({ loadProfile: async () => profile, now: () => new Date(instant), schedules:{getSchedule:async()=>({morningStart:'07:45',afternoonStart:'12:30',version:'1'})}, repo: { createLeaveRequest: async (record, branch) => { persisted = { ...record, co_so: branch }; return persisted; } } });
  return { instance, record: () => persisted };
}
test('self submission snapshots trusted DB identity and calculates Vietnam overnight urgency', async () => {
  assert.equal(typeof create, 'function', 'self submission service exists');
  const { instance } = service();
  const row = await instance.submit({ id: 'u-1' }, body);
  assert.equal(row.user_id, 'u-1'); assert.equal(row.hr_employee_id, 42);
  assert.equal(row.ho_ten, 'Tên thật'); assert.equal(row.bo_phan, 'KHO'); assert.equal(row.co_so, 'Sài Gòn');
  assert.equal(row.web_username, 'real-user'); assert.equal(row.ly_do, 'Việc nhà'); assert.equal(row.nguoi_ban_giao, 'An');
  assert.equal(row.tong_buoi_nghi, 4); assert.equal(row.tong_ngay_nghi, 2);
  assert.equal(row.co_nghi_gap, true); assert.equal(row.trang_thai, 'Chưa duyệt'); assert.equal(row.co_tu_y_nghi, false);
});
test('self submission flags late morning by Vietnam time regardless of server timezone', async () => {
  assert.equal(typeof create, 'function');
  const { instance } = service(account, '2026-10-06T00:46:00.000Z');
  const row = await instance.submit({ id: 'u-1' }, { ...body, end_date: '2026-10-06' });
  assert.equal(row.trang_thai, 'Chưa duyệt'); assert.equal(row.timing_status,'Vi phạm'); assert.equal(row.co_nghi_gap, false);
});
test('self submission rejects missing active linkage without writing', async () => {
  assert.equal(typeof create, 'function');
  const { instance, record } = service(null);
  assert.deepEqual(await instance.context({ id: 'u-1' }), { eligible: false, profile: null });
  await assert.rejects(instance.submit({ id: 'u-1' }, body), { statusCode: 403, code: 'SELF_LEAVE_INELIGIBLE' });
  assert.equal(record(), undefined);
});
test('self submission validates reason, real calendar dates and session range before writing', async () => {
  assert.equal(typeof create, 'function');
  for (const patch of [{ ly_do: '  ' }, { ly_do: 12 }, { start_date: '2026-02-30' }, { start_session: 'đêm' }, { end_date: 123 }, { start_date: '2026-10-07', start_session: 'Chiều', end_session: 'Sáng' }, { nguoi_ban_giao: {} }]) {
    const { instance, record } = service();
    await assert.rejects(instance.submit({ id: 'u-1' }, { ...body, ...patch }), err => err.statusCode === 400);
    assert.equal(record(), undefined);
  }
});

test('stable DB FK lookup rejects inactive accounts and employees even when names match', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const { loadActiveProfile } = require('./hrLeaveSelfService');
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE app_users (id text PRIMARY KEY, username text, vai_tro text, hr_employee_id bigint, trang_thai text, is_deleted boolean, ho_ten text NOT NULL DEFAULT '', co_so text NOT NULL DEFAULT '');
      CREATE TABLE hr_employees (id bigint PRIMARY KEY, ho_ten text, bo_phan text, branch text, is_active boolean);
      INSERT INTO hr_employees VALUES (42,'Same name','KHO','saigon',true),(43,'Same name','SALE','hanoi',true),(44,'Inactive','KHO','saigon',false);
      INSERT INTO app_users VALUES ('active','staff','Khách',42,'Đang hoạt động',false),('inactive','old','Khách',42,'Không hoạt động',false),('locked','locked','Khách',42,'Khóa',false),('deleted','gone','Khách',42,'Đang hoạt động',true),('ex-employee','ex','Khách',44,'Đang hoạt động',false),('unlinked','none','Khách',NULL,'Đang hoạt động',false),('mgr-both','mgr1','Quản lý',NULL,'Đang hoạt động',false),('mgr-sg','mgr2','Quản lý',NULL,'Đang hoạt động',false),('mgr-gone','mgr3','Quản lý',NULL,'Đang hoạt động',true);
      UPDATE app_users SET ho_ten='Quản Lý Một', co_so='both' WHERE id='mgr-both'; UPDATE app_users SET ho_ten='Quản Lý Hai', co_so='saigon' WHERE id='mgr-sg';
      ALTER TABLE app_users ADD COLUMN telegram_id text NOT NULL DEFAULT '';
      UPDATE app_users SET telegram_id = '123456' WHERE id = 'active';`);
    const active = await loadActiveProfile('active', db);
    assert.equal(active.hr_employee_id, 42); assert.equal(active.bo_phan, 'KHO'); assert.equal(active.branch, 'saigon'); assert.equal(active.telegram_id, '123456');
    const both = await loadActiveProfile('mgr-both', db);
    assert.equal(both.hr_employee_id, null); assert.equal(both.ho_ten, 'Quản Lý Một'); assert.equal(both.bo_phan, 'Quản lý'); assert.equal(both.branch, 'hanoi');
    assert.equal((await loadActiveProfile('mgr-sg', db)).branch, 'saigon');
    for (const id of ['mgr-gone','inactive','locked','deleted','ex-employee','unlinked','missing']) assert.equal(await loadActiveProfile(id,db), null);
  } finally { await db.close(); }
});


test('self submission uses only trusted account Telegram ID and ignores forged body or session chat IDs', async () => {
  for (const [trusted, expected] of [['123456', '123456'], ['', '']]) {
    const { instance } = service({ ...account, telegram_id: trusted });
    const row = await instance.submit({ id: 'u-1', telegramId: 'forged-session-chat' }, { ...body, telegram_chat_id: 'forged-body-chat' });
    assert.equal(row.telegram_chat_id, expected);
  }
});
test('preview uses actual selections without writing, and missing employee schedule stops submission',async()=>{
 const {instance,record}=service();
 const preview=await instance.preview({id:'u-1'},{leave_sessions:[{date:'2026-10-09',session:'Chiều'},{date:'2026-10-06',session:'Sáng'}]});
 assert.equal(preview.totalSessions,2);assert.equal(preview.deadlineDate,'2026-10-04');assert.equal(record(),undefined);
 let writes=0;
 for(const profile of [account,{...account,hr_employee_id:null}]) {
  const missing=create({loadProfile:async()=>profile,schedules:{getSchedule:async()=>null},repo:{createLeaveRequest:async()=>{writes++;}}});
  await assert.rejects(missing.submit({id:'u-1'},body),{code:'LEAVE_SCHEDULE_REQUIRED',statusCode:409});
 }
 assert.equal(writes,0);
});
test('editable capability requires owner, web source, same active employee and same branch',async()=>{
 const {instance}=service();
 const request={source:'web',loai_yeu_cau:'Xin nghỉ phép',user_id:'u-1',hr_employee_id:'42',co_so:'Sài Gòn'};
 assert.equal(await instance.canEdit({id:'u-1'},request),true);
 for(const patch of [{source:'telegram'},{user_id:'other'},{hr_employee_id:'43'},{co_so:'Hà Nội'},{loai_yeu_cau:'Tự ý nghỉ (HR ghi nhận)'}]) assert.equal(await instance.canEdit({id:'u-1'},{...request,...patch}),false);
});
