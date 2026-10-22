'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SQL = fs.readFileSync(path.join(__dirname, 'migrations', '0080_customer_notes.sql'), 'utf8');
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const SHA = 'a'.repeat(64);

async function open() {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(SQL);
  return db;
}

test('migration 0080 tao 5 bang ghi chu khach voi khoa chinh dung va chay lai duoc (idempotent)', async () => {
  const db = await open();
  try {
    await db.exec(SQL);
    const { rows } = await db.query(`
      SELECT tc.table_name, string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS pk
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_name = tc.table_name
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name LIKE 'customer\\_%'
      GROUP BY tc.table_name ORDER BY tc.table_name`);
    assert.deepEqual(rows, [
      { table_name: 'customer_editors', pk: 'customer_key,user_id' },
      { table_name: 'customer_notes', pk: 'id' },
      { table_name: 'customer_profile_images', pk: 'id' },
      { table_name: 'customer_profiles', pk: 'customer_key' },
      { table_name: 'customer_visit_days', pk: 'customer_key,visit_date' }
    ]);
  } finally { await db.close(); }
});

test('customer_profiles: mac dinh, CHECK quy mo kho / kenh ban / so luong', async () => {
  const db = await open();
  try {
    await db.query(`INSERT INTO customer_profiles (customer_key) VALUES ('chị a')`);
    const { rows } = await db.query(`SELECT warehouse_scale, sales_channels, warehouse_location, competitor, warehouse_count FROM customer_profiles`);
    assert.deepEqual(rows[0], { warehouse_scale: 'none', sales_channels: [], warehouse_location: '', competitor: '', warehouse_count: null });
    await db.query(`UPDATE customer_profiles SET sales_channels = ARRAY['san','kho_buon','fb_live']`);
    await assert.rejects(db.query(`UPDATE customer_profiles SET warehouse_scale = 'huge'`), /check/i);
    await assert.rejects(db.query(`UPDATE customer_profiles SET sales_channels = ARRAY['san','khac']`), /check/i);
    await assert.rejects(db.query(`UPDATE customer_profiles SET warehouse_count = -1`), /check/i);
  } finally { await db.close(); }
});

test('customer_notes: UNIQUE(customer_key, note_date), khac khach hoac khac ngay thi duoc; note rong bi chan', async () => {
  const db = await open();
  try {
    const ins = (id, key, date, body = 'x') => db.query(`INSERT INTO customer_notes (id, customer_key, note_date, body) VALUES ($1, $2, $3::date, $4)`, [id, key, date, body]);
    await ins(UUID_A, 'a', '2026-10-22');
    await assert.rejects(ins(UUID_B, 'a', '2026-10-22'), /unique|duplicate/i);
    await ins(UUID_B, 'a', '2026-10-23');
    await ins('33333333-3333-4333-8333-333333333333', 'b', '2026-10-22');
    await assert.rejects(ins('44444444-4444-4444-8444-444444444444', 'c', '2026-10-22', '   '), /check/i);
  } finally { await db.close(); }
});

test('customer_profile_images: chi nhan png/jpeg/gif/webp, <= 5MB, sha256 hop le', async () => {
  const db = await open();
  try {
    const ins = (type, size, sha = SHA) => db.query(
      `INSERT INTO customer_profile_images (id, customer_key, content_type, byte_size, sha256, data) VALUES ($1, 'a', $2, $3, $4, '\\x89504e47')`,
      [UUID_A, type, size, sha]);
    await assert.rejects(ins('image/svg+xml', 10), /check/i);
    await assert.rejects(ins('image/png', 5242881), /check/i);
    await assert.rejects(ins('image/png', 0), /check/i);
    await assert.rejects(ins('image/png', 10, 'XYZ'.padEnd(64, 'x')), /check/i);
    await ins('image/webp', 5242880);
  } finally { await db.close(); }
});

test('customer_visit_days va customer_editors: khoa chinh chan trung', async () => {
  const db = await open();
  try {
    await db.query(`INSERT INTO customer_visit_days (customer_key, visit_date) VALUES ('a', '2026-10-01')`);
    await assert.rejects(db.query(`INSERT INTO customer_visit_days (customer_key, visit_date) VALUES ('a', '2026-10-01')`), /unique|duplicate/i);
    await db.query(`INSERT INTO customer_editors (customer_key, user_id) VALUES ('a', 'u1'), ('a', 'u2'), ('b', 'u1')`);
    await assert.rejects(db.query(`INSERT INTO customer_editors (customer_key, user_id) VALUES ('a', 'u1')`), /unique|duplicate/i);
  } finally { await db.close(); }
});

test('migration 0080 thu hoi quyen reporting_readonly neu role ton tai', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE reporting_readonly`);
    await db.exec(SQL);
    await db.exec(`GRANT SELECT ON customer_notes TO reporting_readonly`);
    await db.exec(SQL);
    const { rows } = await db.query(`SELECT has_table_privilege('reporting_readonly', 'customer_notes', 'SELECT') AS ok`);
    assert.equal(rows[0].ok, false);
  } finally { await db.close(); }
});
