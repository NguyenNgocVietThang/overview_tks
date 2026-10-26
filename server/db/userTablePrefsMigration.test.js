'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const sql = fs.readFileSync(path.join(__dirname, 'migrations', '0085_user_table_prefs.sql'), 'utf8')
  .replace(/REVOKE SELECT[^;]*;/g, '');

test('migration 0085 tạo user_table_prefs với khóa chính (tài khoản, bảng, chế độ màn hình)', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(sql);
  await db.exec(`INSERT INTO user_table_prefs(user_id,table_key,screen_mode,prefs) VALUES ('u1','orders','desktop','{"columns":{}}'),('u1','orders','mobile','{}'),('u2','orders','desktop','{}')`);
  await assert.rejects(() => db.exec(`INSERT INTO user_table_prefs(user_id,table_key,screen_mode) VALUES ('u1','orders','desktop')`));
  await assert.rejects(() => db.exec(`INSERT INTO user_table_prefs(user_id,table_key,screen_mode) VALUES ('u1','x','tablet')`));
  await assert.rejects(() => db.exec(`INSERT INTO user_table_prefs(user_id,table_key,screen_mode,prefs) VALUES ('u1','x','desktop','[]')`));
});

test('migration 0085 không FK tới app_users và thu hồi SELECT của reporting_readonly', () => {
  const raw = fs.readFileSync(path.join(__dirname, 'migrations', '0085_user_table_prefs.sql'), 'utf8');
  assert.doesNotMatch(raw, /REFERENCES app_users/);
  assert.match(raw, /REVOKE SELECT ON user_table_prefs FROM reporting_readonly/);
});
