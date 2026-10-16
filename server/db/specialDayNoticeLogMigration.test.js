'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SQL = fs.readFileSync(path.join(__dirname, 'migrations', '0043_special_day_notice_log.sql'), 'utf8');

test('migration 0043 tạo special_day_notice_log với khóa chính (day_key, event_key)', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(SQL);
    const { rows } = await db.query(`
      SELECT string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS pk
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = 'special_day_notice_log'`);
    assert.equal(rows[0].pk, 'day_key,event_key');
  } finally { await db.close(); }
});
