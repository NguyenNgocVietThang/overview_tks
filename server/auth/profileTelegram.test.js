'use strict';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{}';
process.env.JWT_SECRET = 'test-jwt-secret';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const repository = require('./appUsersRepository');
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const CHAT = '9007199254740993';

test('profile Telegram changes persist atomically with the bot link and employee directory', async t => {
  const db = new PGlite();
  let releases = 0;
  const pool = { async connect() { return {
    query: (sql, values) => db.query(sql, values), release() { releases++; }
  }; } };
  try {
    await db.exec('CREATE ROLE reporting_readonly;');
    for (const name of ['0009_app_users_hr_employees.sql', '0015_app_users_telegram_id.sql', '0016_hr_leave_telegram.sql', '0020_app_users_feature_permissions.sql']) {
      await db.exec(fs.readFileSync(path.join(__dirname, '../db/migrations', name), 'utf8'));
    }
    await db.exec(`INSERT INTO hr_employees(id, branch, ho_ten) VALUES (1, 'hanoi', 'A'), (2, 'hanoi', 'B');
      INSERT INTO app_users(id, username, ho_ten, email, hr_employee_id) VALUES
      ('${A}', 'a', 'A', 'a@example.com', 1), ('${B}', 'b', 'B', 'b@example.com', 2);`);
    await t.test('saving a long ID retains all digits in DB and creates a manual bot link', async () => {
      const user = await repository.updateProfileRow(A, { hoTen: 'New A', email: 'a@example.com', telegramId: CHAT }, pool);
      assert.equal(user.telegramId, CHAT);
      assert.equal(user.hoTen, 'New A');
      assert.equal((await db.query('SELECT telegram_id FROM hr_employees WHERE id = 1')).rows[0].telegram_id, CHAT);
      assert.deepEqual((await db.query("SELECT telegram_chat_id, link_method FROM hr_telegram_links WHERE status = 'linked'")).rows,
        [{ telegram_chat_id: CHAT, link_method: 'manual' }]);
    });
    await t.test('duplicate IDs roll back name, directory and existing bot link', async () => {
      await repository.updateProfileRow(B, { hoTen: 'B', email: 'b@example.com', telegramId: '456' }, pool);
      await assert.rejects(repository.updateProfileRow(A, { hoTen: 'Wrong', email: 'changed@example.com', telegramId: '456' }, pool),
        err => err.statusCode === 409 && err.code === 'TELEGRAM_ID_EXISTS');
      const user = (await db.query('SELECT ho_ten, email, telegram_id FROM app_users WHERE id = $1', [A])).rows[0];
      assert.deepEqual(user, { ho_ten: 'New A', email: 'a@example.com', telegram_id: CHAT });
      assert.equal((await db.query("SELECT telegram_chat_id FROM hr_telegram_links WHERE user_id = $1 AND status = 'linked'", [A])).rows[0].telegram_chat_id, CHAT);
    });
    await t.test('IDs belonging to an unregistered employee cannot be taken', async () => {
      await db.exec("INSERT INTO hr_employees(id, branch, telegram_id) VALUES (3, 'saigon', '789');");
      await assert.rejects(repository.updateProfileRow(A, { hoTen: 'Wrong', email: 'a@example.com', telegramId: '789' }, pool),
        err => err.statusCode === 409);
    });
    await t.test('omitting Telegram keeps the existing link; resaving it creates no extra history', async () => {
      await repository.updateProfileRow(A, { hoTen: 'A', email: 'a@example.com' }, pool);
      await repository.updateProfileRow(A, { hoTen: 'A', email: 'a@example.com', telegramId: CHAT }, pool);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM hr_telegram_links WHERE user_id = $1', [A])).rows[0].n, 1);
    });
    await t.test('replacing the ID revokes old and pending links before making the new link', async () => {
      await db.query("INSERT INTO hr_telegram_links(user_id, link_code, code_expires_at) VALUES ($1, 'OLD-CODE', now() + interval '1 hour')", [A]);
      await repository.updateProfileRow(A, { hoTen: 'A', email: 'a@example.com', telegramId: '123' }, pool);
      assert.deepEqual((await db.query('SELECT status FROM hr_telegram_links WHERE user_id = $1 ORDER BY id', [A])).rows.map(r => r.status),
        ['revoked', 'revoked', 'linked']);
      assert.equal((await db.query('SELECT telegram_id FROM app_users WHERE id = $1', [A])).rows[0].telegram_id, '123');
    });
    await t.test('clearing the ID clears both DB fields and revokes the bot link', async () => {
      const user = await repository.updateProfileRow(A, { hoTen: 'A', email: 'a@example.com', telegramId: '' }, pool);
      assert.equal(user.telegramId, '');
      assert.equal((await db.query('SELECT telegram_id FROM hr_employees WHERE id = 1')).rows[0].telegram_id, '');
      assert.equal((await db.query("SELECT count(*)::int AS n FROM hr_telegram_links WHERE user_id = $1 AND status = 'linked'", [A])).rows[0].n, 0);
    });
    await t.test('clearing an already blank ID cancels pending codes too', async () => {
      await db.query("INSERT INTO hr_telegram_links(user_id, link_code, code_expires_at) VALUES ($1, 'PENDING-CODE', now() + interval '1 hour')", [A]);
      await repository.updateProfileRow(A, { hoTen: 'A', email: 'a@example.com', telegramId: '' }, pool);
      assert.equal((await db.query("SELECT status FROM hr_telegram_links WHERE link_code = 'PENDING-CODE'")).rows[0].status, 'revoked');
    });
    await t.test('a deleted account cannot update its profile', async () => {
      await db.query('UPDATE app_users SET is_deleted = true WHERE id = $1', [B]);
      await assert.rejects(repository.updateProfileRow(B, { hoTen: 'Wrong', email: 'b@example.com', telegramId: '100' }, pool),
        err => err.statusCode === 404);
    });
    await t.test('saving through the user store invalidates the cached old profile', async () => {
      const store = require('./localUserStore');
      store.initStore(null, { repository: {
        selectAllRows: async () => (await db.query('SELECT * FROM app_users')).rows.map(repository.rowToUser),
        updateProfileRow: (id, fields) => repository.updateProfileRow(id, fields, pool)
      } });
      assert.equal((await store.getUserById(A)).telegramId, '');
      await require('./userWriteRepository').updateUserProfile(A, { hoTen: 'A', email: 'a@example.com', telegramId: '654' });
      assert.equal((await store.getUserById(A)).telegramId, '654');
      const edited = await store.updateUser(A, { hoTen: 'Edited by manager', soDienThoai: '0912345678', coSo: 'Sài Gòn', telegramId: '987' });
      assert.equal(edited.telegramId, '987');
      assert.equal(edited.soDienThoai, '0912345678');
      assert.equal(edited.coSo, 'Sài Gòn');
      const persisted = (await db.query('SELECT ho_ten, so_dien_thoai, co_so, telegram_id FROM app_users WHERE id = $1', [A])).rows[0];
      assert.deepEqual(persisted, { ho_ten: 'Edited by manager', so_dien_thoai: '0912345678', co_so: 'saigon', telegram_id: '987' });
      assert.equal((await db.query("SELECT telegram_chat_id FROM hr_telegram_links WHERE user_id = $1 AND status = 'linked'", [A])).rows[0].telegram_chat_id, '987');
    });
    assert.equal(releases, 12);
  } finally { await db.close(); }
});
