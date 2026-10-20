'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'db', 'migrations');
const SHEET_SQL = fs.readFileSync(path.join(dir, '0064_sheet_snapshots.sql'), 'utf8');
const SQL = fs.readFileSync(path.join(dir, '0077_invoice_price_audit.sql'), 'utf8');

async function newDb() {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(SHEET_SQL);
  return db;
}

const marker = (branch = 'hanoi', id = 1) => [
  'INSERT INTO invoice_price_audit_invoices (branch, invoice_id, invoice_code, sold_day, captured_at, run_day) VALUES ($1,$2,$3,$4,now(),$4)',
  [branch, id, `HD${id}`, '2026-10-20']
];
const line = (branch = 'hanoi', id = 1, no = 1) => [
  `INSERT INTO invoice_price_audit_lines (branch, invoice_id, source_line_no, invoice_code, sold_at, sold_day, product_code, original_status)
   VALUES ($1,$2,$3,'HD','2026-10-20 10:00:00+00','2026-10-20','T100','wrong')`,
  [branch, id, no]
];

test('migration 0077 chay tren DB moi va chay lai duoc, PK dung, state chi 1 dong', async () => {
  const db = await newDb();
  try {
    await db.exec(SQL);
    await db.exec(SQL);
    const { rows } = await db.query(`
      SELECT tc.table_name, string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS pk
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name LIKE 'invoice_price_audit%'
      GROUP BY tc.table_name ORDER BY tc.table_name`);
    assert.deepEqual(rows, [
      { table_name: 'invoice_price_audit_changes', pk: 'id' },
      { table_name: 'invoice_price_audit_invoices', pk: 'branch,invoice_id' },
      { table_name: 'invoice_price_audit_lines', pk: 'branch,invoice_id,source_line_no' },
      { table_name: 'invoice_price_audit_state', pk: 'id' }
    ]);
    await db.query('INSERT INTO invoice_price_audit_state (id) VALUES (TRUE)');
    await assert.rejects(db.query('INSERT INTO invoice_price_audit_state (id) VALUES (FALSE)'), /check|duplicate|violates/i);
    const state = await db.query('SELECT version FROM invoice_price_audit_state');
    assert.equal(state.rows[0].version, 1);
  } finally { await db.close(); }
});

test('migration 0077 them freight_per_unit NUMERIC NULL, giu nguyen dong shipping_measures cu', async () => {
  const db = await newDb();
  try {
    await db.query("INSERT INTO shipping_measures (code_key, per_carton, m3_per_unit, kg_per_unit) VALUES ('t100', 10, 0.5, 1.5)");
    await db.exec(SQL);
    const col = await db.query("SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name='shipping_measures' AND column_name='freight_per_unit'");
    assert.deepEqual(col.rows, [{ data_type: 'numeric', is_nullable: 'YES' }]);
    const old = await db.query("SELECT per_carton, m3_per_unit, kg_per_unit, freight_per_unit FROM shipping_measures WHERE code_key='t100'");
    assert.deepEqual(old.rows[0], { per_carton: '10', m3_per_unit: '0.5', kg_per_unit: '1.5', freight_per_unit: null });
  } finally { await db.close(); }
});

test('rang buoc: branch, decision, original_status, version mac dinh, tien la NUMERIC', async () => {
  const db = await newDb();
  try {
    await db.exec(SQL);
    await assert.rejects(db.query(...marker('danang', 1)), /check/i);
    await db.query(...marker('hanoi', 1));
    await db.query(...line('hanoi', 1, 1));
    const row = (await db.query('SELECT decision, version, original_status FROM invoice_price_audit_lines')).rows[0];
    assert.deepEqual(row, { decision: null, version: 1, original_status: 'wrong' });
    await db.query("UPDATE invoice_price_audit_lines SET decision = 'ok'");
    await db.query("UPDATE invoice_price_audit_lines SET decision = 'penalty'");
    await db.query('UPDATE invoice_price_audit_lines SET decision = NULL');
    await assert.rejects(db.query("UPDATE invoice_price_audit_lines SET decision = 'maybe'"), /check/i);
    await assert.rejects(db.query("UPDATE invoice_price_audit_lines SET original_status = 'x'"), /check/i);
    await assert.rejects(db.query(...line('hanoi', 1, 1)), /duplicate|unique|primary/i);
    await assert.rejects(db.query(...line('hanoi', 99, 1)), /foreign key/i);
    await assert.rejects(db.query(...line('hue', 1, 2)), /check/i);
    const money = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='invoice_price_audit_lines' AND data_type='numeric' ORDER BY 1`);
    for (const name of ['quantity', 'total_code_quantity', 'original_unit_price', 'unit_discount', 'net_unit_price', 'minimum_unit_price', 'unit_shortfall', 'original_amount', 'freight_per_unit', 'carton_size_hn', 'minimum_hn', 'minimum_sg']) {
      assert.ok(money.rows.some(r => r.column_name === name), `${name} phai la NUMERIC`);
    }
    const inv = await db.query(`SELECT data_type FROM information_schema.columns WHERE table_name='invoice_price_audit_invoices' AND column_name='invoice_id'`);
    assert.equal(inv.rows[0].data_type, 'bigint');
  } finally { await db.close(); }
});

test('xoa dong danh dau thi xoa dong chup va nhat ky; khong co FK sang invoices/invoice_details nguon', async () => {
  const db = await newDb();
  try {
    await db.exec(SQL);
    await db.query(...marker('saigon', 7));
    await db.query(...line('saigon', 7, 1));
    await db.query("INSERT INTO invoice_price_audit_changes (branch, invoice_id, source_line_no, actor, action) VALUES ('saigon', 7, 1, 'u', 'decide')");
    await db.query("DELETE FROM invoice_price_audit_invoices WHERE branch = 'saigon' AND invoice_id = 7");
    assert.equal((await db.query('SELECT count(*)::int AS n FROM invoice_price_audit_lines')).rows[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM invoice_price_audit_changes')).rows[0].n, 0);
    const fks = await db.query(`
      SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
      FROM pg_constraint c WHERE c.contype = 'f' AND c.conrelid::regclass::text LIKE 'invoice_price_audit%' ORDER BY 1, 2`);
    assert.deepEqual(fks.rows, [
      { child: 'invoice_price_audit_changes', parent: 'invoice_price_audit_lines' },
      { child: 'invoice_price_audit_lines', parent: 'invoice_price_audit_invoices' }
    ]);
  } finally { await db.close(); }
});

test('doi nguon invoices khong anh huong ban ghi nhan (khong cascade)', async () => {
  const db = await newDb();
  try {
    await db.exec(fs.readFileSync(path.join(dir, '0002_invoices.sql'), 'utf8'));
    await db.exec(SQL);
    await db.query("INSERT INTO invoices (branch, id, code, raw) VALUES ('hanoi', 1, 'HD1', '{}')");
    await db.query(...marker('hanoi', 1));
    await db.query(...line('hanoi', 1, 1));
    await db.query('DELETE FROM invoices');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM invoice_price_audit_lines')).rows[0].n, 1);
  } finally { await db.close(); }
});

test('migration 0077 idempotent, khong CONCURRENTLY, thu hoi quyen reporting_readonly cho 4 bang', () => {
  assert.doesNotMatch(SQL, /CONCURRENTLY/i);
  assert.equal([...SQL.matchAll(/CREATE (?:TABLE|INDEX) (?!IF NOT EXISTS)/g)].length, 0);
  assert.match(SQL, /ADD COLUMN IF NOT EXISTS freight_per_unit NUMERIC/);
  assert.match(SQL, /REVOKE ALL ON[\s\S]*invoice_price_audit_invoices[\s\S]*invoice_price_audit_lines[\s\S]*invoice_price_audit_state[\s\S]*invoice_price_audit_changes[\s\S]*FROM reporting_readonly/);
  assert.match(SQL, /pg_roles WHERE rolname = 'reporting_readonly'/);
});
