'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SQL = fs.readFileSync(path.join(__dirname, 'migrations', '0036_business_monthly_sales.sql'), 'utf8');

test('migration 0036 tao 5 bang bao cao kinh doanh voi khoa chinh dung', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(SQL);
    const { rows } = await db.query(`
      SELECT tc.table_name, string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS pk
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name LIKE 'business_monthly_%'
      GROUP BY tc.table_name ORDER BY tc.table_name`);
    assert.deepEqual(rows, [
      { table_name: 'business_monthly_customer_product_sales', pk: 'month,branch,customer_code,product_code' },
      { table_name: 'business_monthly_customer_sales', pk: 'month,branch,customer_code' },
      { table_name: 'business_monthly_product_sales', pk: 'month,product_code' },
      { table_name: 'business_monthly_sale_sales', pk: 'month,sale_name' },
      { table_name: 'business_monthly_state', pk: 'month' }
    ]);
    await assert.rejects(db.query(`INSERT INTO business_monthly_customer_sales (month, branch, customer_code) VALUES ('2026-03-02', 'hanoi', 'KH1')`), /check/i,
      'month phai la ngay 1');
  } finally { await db.close(); }
});
