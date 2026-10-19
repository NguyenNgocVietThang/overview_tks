'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MONTHLY = fs.readFileSync(path.join(__dirname, 'migrations', '0036_business_monthly_sales.sql'), 'utf8');
const CURRENT = fs.readFileSync(path.join(__dirname, 'migrations', '0068_business_current_month.sql'), 'utf8');

async function database() {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(MONTHLY);
  await db.exec(CURRENT);
  return db;
}

const columns = (db, table) => db.query(`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [table]).then(r => r.rows);

test('migration 0068 tao 3 bang thang hien tai voi khoa chinh dung va chay lai duoc (IF NOT EXISTS)', async () => {
  const db = await database();
  try {
    await db.exec(CURRENT);
    const { rows } = await db.query(`
      SELECT tc.table_name, string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS pk
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name LIKE 'business_current_month_%'
      GROUP BY tc.table_name ORDER BY tc.table_name`);
    assert.deepEqual(rows, [
      { table_name: 'business_current_month_customer_product_sales', pk: 'month,branch,customer_code,product_code' },
      { table_name: 'business_current_month_customer_sales', pk: 'month,branch,customer_code' },
      { table_name: 'business_current_month_state', pk: 'id' }
    ]);
    const { rows: idx } = await db.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'business_current_month_customer_product_sales' ORDER BY 1`);
    assert.ok(idx.some(r => r.indexname === 'business_current_month_cps_product_idx'));
  } finally { await db.close(); }
});

test('2 bang du lieu phan chieu y het bang chot thang (cot, kieu, rang buoc) de doc code cu gan nhu khong doi', async () => {
  const db = await database();
  try {
    assert.deepEqual(await columns(db, 'business_current_month_customer_sales'), await columns(db, 'business_monthly_customer_sales'));
    assert.deepEqual(await columns(db, 'business_current_month_customer_product_sales'), await columns(db, 'business_monthly_customer_product_sales'));
  } finally { await db.close(); }
});

test('rang buoc: month la ngay 1, branch hop le, state chi 1 dong (id = 1)', async () => {
  const db = await database();
  try {
    await assert.rejects(db.query(`INSERT INTO business_current_month_customer_sales (month, branch, customer_code) VALUES ('2026-10-02', 'hanoi', 'KH1')`), /check/i);
    await assert.rejects(db.query(`INSERT INTO business_current_month_customer_sales (month, branch, customer_code) VALUES ('2026-10-01', 'other', 'KH1')`), /check/i);
    await assert.rejects(db.query(`INSERT INTO business_current_month_state (id, month) VALUES (2, '2026-10-01')`), /check/i);
    await db.query(`INSERT INTO business_current_month_state (id, month) VALUES (1, '2026-10-01')`);
    const state = (await db.query('SELECT version::int AS version, last_full_at, cutoff, customers_synced_at FROM business_current_month_state')).rows[0];
    assert.deepEqual(state, { version: 0, last_full_at: null, cutoff: null, customers_synced_at: null });
    await assert.rejects(db.query(`INSERT INTO business_current_month_state (id, month) VALUES (1, '2026-11-01')`), /duplicate|unique/i);
  } finally { await db.close(); }
});

test('migration 0068 khong dung CONCURRENTLY va chi tao bang bao cao thang hien tai', () => {
  assert.doesNotMatch(CURRENT, /CONCURRENTLY/i);
  const created = [...CURRENT.matchAll(/CREATE (?:TABLE|INDEX)(?: IF NOT EXISTS)? (\S+)/g)].map(m => m[1]);
  assert.deepEqual(created, ['business_current_month_customer_sales', 'business_current_month_customer_product_sales',
    'business_current_month_cps_product_idx', 'business_current_month_state']);
  assert.equal([...CURRENT.matchAll(/CREATE (?:TABLE|INDEX) (?!IF NOT EXISTS)/g)].length, 0);
});
