'use strict';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{}';
process.env.JWT_SECRET = 'test-jwt-secret';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const repo = require('./appUsersRepository');
const store = require('./localUserStore');
const router = require('./adminUserRoutes');
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const manager = { id: 'manager', username: 'manager', vaiTro: 'Quản lý' };
const layer = (method, route) => router.stack.find(l => l.route?.path === route && l.route.methods[method]).route;
const handler = (method, route) => layer(method, route).stack.at(-1).handle;
const response = () => ({ statusCode: null, body: null,
  status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('manager Telegram edits respect account policy and persist the actual bot link', async t => {
  const db = new PGlite();
  const pool = { async connect() { return { query: (sql, args) => db.query(sql, args), release() {} }; } };
  const put = async (body, id = A, actor = manager) => {
    const res = response();
    await handler('put', '/api/admin/users/:id')({ user: actor, params: { id }, body }, res);
    return res;
  };
  try {
    await db.exec('CREATE ROLE reporting_readonly;');
    for (const name of ['0009_app_users_hr_employees.sql', '0015_app_users_telegram_id.sql', '0016_hr_leave_telegram.sql', '0020_app_users_feature_permissions.sql']) {
      await db.exec(fs.readFileSync(path.join(__dirname, '../db/migrations', name), 'utf8'));
    }
    await db.exec("ALTER TABLE app_users ADD COLUMN leave_approval_departments TEXT[] NOT NULL DEFAULT '{}';");
    await db.exec(`INSERT INTO hr_employees(id, branch) VALUES (1, 'hanoi'), (2, 'saigon');
      INSERT INTO app_users(id, username, ho_ten, email, vai_tro, hr_employee_id) VALUES
      ('${A}', 'employee', 'Employee', 'employee@example.com', 'Nhân viên kho', 1),
      ('${B}', 'other-manager', 'Other manager', 'manager@example.com', 'Quản lý', 2);`);
    store.initStore(null, { repository: {
      selectAllRows: async () => (await db.query('SELECT * FROM app_users')).rows.map(repo.rowToUser),
      updateProfileRow: (id, fields) => repo.updateProfileRow(id, fields, pool),
      updateUserRow: (id, fields) => repo.updateProfileRow(id, fields, pool)
    } });
    await t.test('unauthorized users are stopped by the manage-permission middleware', async () => {
      const res = response();
      let passed = false;
      layer('put', '/api/admin/users/:id').stack[1].handle({ user: { id: A, vaiTro: 'Nhân viên kho' } }, res, () => { passed = true; });
      assert.equal(res.statusCode, 403);
      assert.equal(passed, false);
    });
    await t.test('malformed Telegram ID cannot change any employee information', async () => {
      for (const telegramId of ['@name', '-12', '0', '1.2', '1'.repeat(21), 123, null]) {
        const res = await put({ hoTen: 'Wrong', telegramId });
        assert.equal(res.statusCode, 400, JSON.stringify(telegramId));
        assert.equal((await store.getUserById(A)).hoTen, 'Employee');
      }
    });
    await t.test('a manager can save employee information and a long Telegram ID together', async () => {
      const res = await put({ hoTen: 'New employee', soDienThoai: '0912345678', coSo: 'Sài Gòn', telegramId: ' 9007199254740993 ' });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.user.telegramId, '9007199254740993');
      assert.equal(res.body.user.soDienThoai, '0912345678');
      assert.equal(res.body.user.coSo, 'Sài Gòn');
      assert.equal((await db.query('SELECT telegram_id FROM hr_employees WHERE id = 1')).rows[0].telegram_id, '9007199254740993');
      assert.equal((await db.query("SELECT telegram_chat_id FROM hr_telegram_links WHERE user_id = $1 AND status = 'linked'", [A])).rows[0].telegram_chat_id, '9007199254740993');
    });
    await t.test('user list exposes the persisted ID for the edit form', async () => {
      const res = response();
      await handler('get', '/api/admin/users')({ user: manager }, res);
      assert.equal(res.body.users.find(u => u.id === A).telegramId, '9007199254740993');
    });
    await t.test('an ordinary manager cannot change another manager Telegram ID', async () => {
      const res = await put({ telegramId: '123' }, B);
      assert.equal(res.statusCode, 403);
      assert.equal((await store.getUserById(B)).telegramId, '');
    });
    await t.test('a senior manager can edit another manager Telegram ID', async () => {
      const res = await put({ telegramId: '456' }, B, { id: 'senior', username: 'admin', vaiTro: 'Quản lý' });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.user.telegramId, '456');
    });
    await t.test('duplicate ID returns 409 and preserves the entire employee update', async () => {
      const res = await put({ hoTen: 'Wrong', coSo: 'Hà Nội', telegramId: '456' });
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.code, 'TELEGRAM_ID_EXISTS');
      const current = await store.getUserById(A);
      assert.equal(current.hoTen, 'New employee');
      assert.equal(current.coSo, 'Sài Gòn');
      assert.equal(current.telegramId, '9007199254740993');
    });
    await t.test('an omitted ID stays intact; a blank ID revokes the employee link', async () => {
      const unchanged = await put({ hoTen: 'New employee' });
      assert.equal(unchanged.body.user.telegramId, '9007199254740993');
      const cleared = await put({ telegramId: '' });
      assert.equal(cleared.statusCode, 200);
      assert.equal(cleared.body.user.telegramId, '');
      assert.equal((await db.query('SELECT telegram_id FROM hr_employees WHERE id = 1')).rows[0].telegram_id, '');
      assert.equal((await db.query("SELECT count(*)::int AS n FROM hr_telegram_links WHERE user_id = $1 AND status = 'linked'", [A])).rows[0].n, 0);
    });
    await t.test('an ordinary manager may change their own Telegram ID', async () => {
      const res = await put({ telegramId: '789' }, B, { id: B, username: 'other-manager', vaiTro: 'Quản lý' });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.user.telegramId, '789');
    });
  } finally { await db.close(); }
});
