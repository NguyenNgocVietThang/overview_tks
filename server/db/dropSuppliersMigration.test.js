'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, 'migrations', '0026_drop_suppliers_and_purchase_summary.sql'), 'utf8');

test('migration 0026 xoa bang suppliers va daily_purchase_summary, don moc sync cua entity suppliers', () => {
  assert.match(sql, /DROP TABLE IF EXISTS daily_purchase_summary;/);
  assert.match(sql, /DROP TABLE IF EXISTS suppliers;/);
  assert.match(sql, /DELETE FROM sync_checkpoints WHERE entity = 'suppliers';/);
  assert.match(sql, /DELETE FROM backfill_progress WHERE entity = 'suppliers';/);
});

test('migration 0026 KHONG dong toi purchases/purchase_details/product_first_purchase/order_suppliers (van dung cho dut hang, Hang moi nhap, Hang dang van chuyen)', () => {
  const statements = sql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(statements, /purchases|purchase_details|product_first_purchase|order_supplier/);
});
