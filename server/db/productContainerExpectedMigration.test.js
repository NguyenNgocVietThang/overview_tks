'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SQL = fs.readFileSync(path.join(__dirname, 'migrations', '0073_product_container_expected.sql'), 'utf8');

test('migration 0073 tao 2 bang voi khoa chinh dung, chay lai duoc, state chi 1 dong', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(SQL);
    await db.exec(SQL);
    const { rows } = await db.query(`
      SELECT tc.table_name, string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS pk
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name LIKE 'product_container_expected%'
      GROUP BY tc.table_name ORDER BY tc.table_name`);
    assert.deepEqual(rows, [
      { table_name: 'product_container_expected', pk: 'sheet_name,source_row' },
      { table_name: 'product_container_expected_state', pk: 'id' }
    ]);
    await db.query(`INSERT INTO product_container_expected_state (id) VALUES (1)`);
    await assert.rejects(db.query(`INSERT INTO product_container_expected_state (id) VALUES (2)`), /check/i);
    const numeric = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'product_container_expected' AND data_type = 'numeric' ORDER BY 1`);
    assert.deepEqual(numeric.rows.map(r => r.column_name), ['package_count', 'quantity', 'units_per_package']);
  } finally { await db.close(); }
});

test('migration 0073 khong dung CONCURRENTLY, chi tao bang moi (IF NOT EXISTS) va thu hoi quyen reporting_readonly', () => {
  assert.doesNotMatch(SQL, /CONCURRENTLY/i);
  assert.deepEqual([...SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\S+)/g)].map(m => m[1]), ['product_container_expected', 'product_container_expected_state']);
  assert.equal([...SQL.matchAll(/CREATE (?:TABLE|INDEX) (?!IF NOT EXISTS)/g)].length, 0);
  assert.match(SQL, /REVOKE ALL ON product_container_expected, product_container_expected_state FROM reporting_readonly/);
});
