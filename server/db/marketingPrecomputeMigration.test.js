'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb, migration } = require('../marketingReport/precomputeFixture');

test('migration 0069 chay lai an toan, khong CONCURRENTLY, tao du bang/view/ham', async () => {
  const sql = migration('0069_marketing_precompute.sql');
  assert.ok(!/concurrently/i.test(sql.replace(/^--.*$/gm, '')));
  const db = await createDb();
  try {
    await db.exec(sql); // lan 2: IF NOT EXISTS / CREATE OR REPLACE
    const { rows } = await db.query(`
      SELECT tc.table_name, string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS pk
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name IN ('marketing_ads_costs', 'marketing_ads_sync_state', 'marketing_phone_summary', 'marketing_phone_summary_state')
      GROUP BY tc.table_name ORDER BY tc.table_name`);
    assert.deepEqual(rows, [
      { table_name: 'marketing_ads_costs', pk: 'row_key' },
      { table_name: 'marketing_ads_sync_state', pk: 'id' },
      { table_name: 'marketing_phone_summary', pk: 'page_id,phone_key' },
      { table_name: 'marketing_phone_summary_state', pk: 'id' }
    ]);
    const view = await db.query('SELECT * FROM v_marketing_customer_revenue');
    assert.deepEqual(view.fields.map(f => f.name), ['month', 'name_key', 'net_revenue', 'known']);
    await assert.rejects(db.query(`INSERT INTO marketing_ads_costs (row_key, sheet_order, block, source_row, kind, sheet, page) VALUES ('k', 0, 0, 2, 'bad', 's', 'p')`), /check/i);
  } finally { await db.close(); }
});
