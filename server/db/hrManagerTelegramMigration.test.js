'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const migrationPath = path.join(__dirname, 'migrations', '0029_hr_manager_telegram.sql');

async function createTestDatabase({ managerMigration = true } = {}) {
  const db = new PGlite();
  try {
  await db.exec(`CREATE ROLE reporting_readonly;
    CREATE TABLE hr_employees (id BIGINT PRIMARY KEY, bo_phan TEXT);
    CREATE TABLE app_users (id UUID PRIMARY KEY, username TEXT, is_deleted BOOLEAN DEFAULT false,
      telegram_id TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ DEFAULT now(), hr_employee_id BIGINT);
    INSERT INTO app_users(id, username) VALUES ('11111111-1111-1111-1111-111111111111', 'manager');`);
  await db.exec(fs.readFileSync(path.join(__dirname, 'migrations', '0016_hr_leave_telegram.sql'), 'utf8'));
  if (managerMigration) await db.exec(fs.readFileSync(migrationPath, 'utf8'));
  return db;
  } catch (error) { await db.close(); throw error; }
}

async function insertRequest(db, overrides = {}) {
  const data = { id: 'NP-TEST', status: 'Chưa duyệt', type: 'Xin nghỉ phép', ...overrides };
  return (await db.query(`INSERT INTO hr_leave_requests(request_id, branch, start_date, start_session,
    end_date, end_session, tong_buoi_nghi, trang_thai, loai_yeu_cau)
    VALUES ($1, 'hanoi', '2026-10-02', 'Sáng', '2026-10-02', 'Chiều', 2, $2, $3) RETURNING *`,
  [data.id, data.status, data.type])).rows[0];
}

test('decision version changes only with the decision tuple and preserves employee notification reset', async () => {
  const db = await createTestDatabase();
  try {
    await insertRequest(db);
    await db.exec(`UPDATE hr_leave_requests SET decision_notified_at = '2026-10-01';
      UPDATE hr_leave_requests SET ly_do = 'Edited reason', decision_version = 999;`);
    let row = (await db.query('SELECT * FROM hr_leave_requests')).rows[0];
    assert.equal(String(row.decision_version), '0');
    assert.ok(row.decision_notified_at);
    await db.exec(`UPDATE hr_leave_requests SET ghi_chu_duyet = 'reviewing';`);
    row = (await db.query('SELECT * FROM hr_leave_requests')).rows[0];
    assert.equal(String(row.decision_version), '1');
    assert.ok(row.decision_notified_at, 'same-status note edits retain the existing notification rule');
    await db.exec(`UPDATE hr_leave_requests SET trang_thai = 'Đã duyệt', nguoi_duyet = 'Manager',
      approver_user_id = '11111111-1111-1111-1111-111111111111', thoi_diem_duyet = now();`);
    row = (await db.query('SELECT * FROM hr_leave_requests')).rows[0];
    assert.equal(String(row.decision_version), '2');
    assert.equal(row.decision_notified_at, null);
    assert.deepEqual((await db.query('SELECT event_type, decision_version::text FROM hr_leave_change_events ORDER BY id')).rows,
      [{ event_type: 'CREATE', decision_version: '0' }, { event_type: 'DECISION', decision_version: '1' }, { event_type: 'DECISION', decision_version: '2' }]);
    await db.exec(`UPDATE hr_leave_requests SET decision_notified_at = now();
      UPDATE hr_leave_requests SET trang_thai = 'Từ chối', decision_notified_at = now() + interval '1 second';`);
    assert.ok((await db.query('SELECT decision_notified_at FROM hr_leave_requests')).rows[0].decision_notified_at,
      'explicit notification timestamp changes remain respected');
  } finally { await db.close(); }
});

test('migration seeds only open leave requests and keeps manager data private', async () => {
  const db = await createTestDatabase({ managerMigration: false });
  try {
    await insertRequest(db, { id: 'PENDING' });
    await insertRequest(db, { id: 'PROVISIONAL', status: 'Tạm duyệt' });
    await insertRequest(db, { id: 'APPROVED', status: 'Đã duyệt' });
    await insertRequest(db, { id: 'REJECTED', status: 'Từ chối' });
    await insertRequest(db, { id: 'MANUAL', type: 'Tự ý nghỉ (HR ghi nhận)' });
    await db.exec(fs.readFileSync(migrationPath, 'utf8'));
    assert.deepEqual((await db.query('SELECT request_id, event_type FROM hr_leave_change_events ORDER BY request_id')).rows,
      [{ request_id: 'PENDING', event_type: 'CREATE' }, { request_id: 'PROVISIONAL', event_type: 'CREATE' }]);
    await assert.rejects(db.exec(`INSERT INTO hr_leave_change_events(request_id, decision_version, event_type) VALUES ('PENDING', 0, 'CREATE')`), /unique/i);
    for (const name of ['hr_leave_change_events', 'hr_leave_manager_messages', 'hr_manager_telegram_sessions', 'hr_manager_telegram_updates', 'hr_manager_telegram_state']) {
      const result = await db.query(`SELECT has_table_privilege('reporting_readonly', $1, 'SELECT') AS allowed`, [name]);
      assert.equal(result.rows[0].allowed, false);
    }
  } finally { await db.close(); }
});

test('each decision field independently increments once while unchanged values do not enqueue events', async () => {
  const db = await createTestDatabase();
  try {
    await insertRequest(db);
    const changes = [
      "nguoi_duyet = 'Manager'",
      "approver_user_id = '11111111-1111-1111-1111-111111111111'",
      "thoi_diem_duyet = '2026-10-02T01:00:00Z'",
      "ghi_chu_duyet = 'Accepted'",
      "trang_thai = 'Tạm duyệt'"
    ];
    for (let i = 0; i < changes.length; i += 1) {
      await db.exec(`UPDATE hr_leave_requests SET ${changes[i]}`);
      await db.exec(`UPDATE hr_leave_requests SET ${changes[i]}`);
      const row = (await db.query('SELECT decision_version::text FROM hr_leave_requests')).rows[0];
      assert.equal(row.decision_version, String(i + 1));
    }
    assert.equal((await db.query('SELECT count(*)::int AS total FROM hr_leave_change_events')).rows[0].total, 6);
  } finally { await db.close(); }
});
