'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CONFIG = require('../config');
const { getPool } = require('./pool');
const { runMigrations } = require('./migrate');

const EXPECTED_TABLES = [
  'cash_flows',
  'categories',
  'customers',
  'invoice_details',
  'invoice_payments',
  'invoices',
  'order_details',
  'orders',
  'products',
  'purchase_details',
  'purchases',
  'return_details',
  'returns',
  'staff',
  'suppliers',
  'sync_checkpoints'
];

test('migrations create the complete KiotViet schema on configured Supabase', {
  skip: CONFIG.SUPABASE_DB_URL ? false : 'SUPABASE_DB_URL chưa cấu hình — bỏ qua test tích hợp'
}, async (t) => {
  const pool = getPool();
  t.after(() => pool.end());

  await runMigrations({ pool, logger: { log() {} } });

  const tables = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY($1::text[])
    ORDER BY table_name
  `, [EXPECTED_TABLES]);
  assert.deepEqual(tables.rows.map((row) => row.table_name), EXPECTED_TABLES);

  const productPrimaryKey = await pool.query(`
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.constraint_schema = kcu.constraint_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'products'
      AND tc.constraint_type = 'PRIMARY KEY'
    ORDER BY kcu.ordinal_position
  `);
  assert.deepEqual(productPrimaryKey.rows.map((row) => row.column_name), ['branch', 'id']);

  const invoiceDetailsForeignKey = await pool.query(`
    SELECT ccu.table_name AS referenced_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
     AND tc.constraint_schema = ccu.constraint_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'invoice_details'
      AND tc.constraint_type = 'FOREIGN KEY'
  `);
  assert.deepEqual(
    [...new Set(invoiceDetailsForeignKey.rows.map((row) => row.referenced_table))],
    ['invoices']
  );
});
