'use strict';

// Chay SQL THAT cua migration 0074 + job expectedRefresh + expectedRepository tren PGlite.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { refreshExpected, requestExpectedRefresh } = require('./expectedRefresh');
const { createExpectedRepository } = require('./expectedRepository');

const migration = file => fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', file), 'utf8');
const MIGRATIONS = ['0018_product_report.sql', '0053_product_containers.sql', '0072_product_container_unit_price_cny.sql', '0074_product_container_expected.sql'];
const quiet = () => {};

async function setup() {
  const db = new PGlite();
  for (const file of MIGRATIONS) await db.exec(migration(file));
  const pool = {
    query: (sql, params) => db.query(sql, params),
    connect: async () => ({ query: (sql, params) => db.query(sql, params), release() {} })
  };
  return { db, pool };
}

const LINE = `INSERT INTO product_container_lines
  (sheet_name, sheet_order, container_row, source_row, product_code, product_key, container_name, status, status_label, eta, color, sale_note, ordered_by, units_per_package, package_count, quantity)
  VALUES `;

async function seed(db) {
  await db.exec(`
    INSERT INTO product_report (product_code, product_name) VALUES ('SKU1', 'Ao thun'), ('Sku2', 'Quan jean');
    ${LINE}
      ('YIWU', 0, 1, 2, 'SKU1', 'sku1', 'CONT A', 1, '1.Chưa có lịch', 'DK THÁNG 10 BỐC', 'Đỏ', 'Gấp', 'An', 10, 5, 50),
      ('YIWU', 0, 1, 3, 'SKU2', 'sku2', 'CONT A', 1, '1.Chưa có lịch', 'DK THÁNG 10 BỐC', '', '', 'Bình', NULL, NULL, 7),
      ('SD', 1, 1, 2, 'NONAME', 'noname', 'CONT B', 3, '3.Đã bốc', '', '', '', '', 2, 4, 8.5);`);
}

test('lan dau ghi du dong, ghep Lich = B + 1 dau cach + C (C rong khong thua dau cach), ten SP tu product_report', async () => {
  const { db, pool } = await setup();
  try {
    await seed(db);
    const result = await refreshExpected(pool, { log: quiet });
    assert.equal(result.status, 'updated');
    assert.equal(result.written, 3);
    const { rows } = await db.query('SELECT source_row, sheet_name, schedule_label, product_name FROM product_container_expected ORDER BY sheet_order, source_row');
    assert.deepEqual(rows.map(r => r.schedule_label), ['1.Chưa có lịch DK THÁNG 10 BỐC', '1.Chưa có lịch DK THÁNG 10 BỐC', '3.Đã bốc']);
    assert.deepEqual(rows.map(r => r.product_name), ['Ao thun', 'Quan jean', '']);
    const state = (await db.query('SELECT version::int AS version, row_count FROM product_container_expected_state')).rows[0];
    assert.deepEqual(state, { version: 1, row_count: 3 });
  } finally { await db.close(); }
});

test('lan hai ghi 0 dong, version giu nguyen; doi nguon thi chi ghi dong doi / them / xoa dong mat', async () => {
  const { db, pool } = await setup();
  try {
    await seed(db);
    await refreshExpected(pool, { log: quiet });
    const second = await refreshExpected(pool, { log: quiet });
    assert.equal(second.status, 'unchanged');
    assert.equal(second.written, 0);
    assert.equal(second.deleted, 0);
    assert.equal(second.version, 1);

    await db.exec(`UPDATE product_container_lines SET quantity = 60 WHERE source_row = 2 AND sheet_name = 'YIWU'`);
    const third = await refreshExpected(pool, { log: quiet });
    assert.equal(third.written, 1);
    assert.equal(third.version, 2);

    await db.exec(`DELETE FROM product_container_lines WHERE sheet_name = 'SD'; ${LINE} ('YIWU', 0, 4, 9, 'SKU1', 'sku1', 'CONT C', 2, '2.Chưa bốc', '', '', '', '', NULL, NULL, 1);`);
    const fourth = await refreshExpected(pool, { log: quiet });
    assert.equal(fourth.deleted, 1);
    assert.equal(fourth.written, 1);
    assert.equal(fourth.version, 3);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM product_container_expected')).rows[0].n, 3);

    // Doi ten SP trong product_report cung duoc bat kip.
    await db.exec(`UPDATE product_report SET product_name = 'Ao thun moi' WHERE product_code = 'SKU1'`);
    const fifth = await refreshExpected(pool, { log: quiet });
    assert.equal(fifth.written, 3 - 1); // 2 dong SKU1 (YIWU 2 va 9)
    assert.equal(fifth.version, 4);
  } finally { await db.close(); }
});

test('chot an toan: nguon rong thi giu nguyen bang dang co; bang rong + nguon rong thi khong loi', async () => {
  const { db, pool } = await setup();
  try {
    const first = await refreshExpected(pool, { log: quiet });
    assert.equal(first.status, 'unchanged');
    await seed(db);
    await refreshExpected(pool, { log: quiet });
    await db.exec('DELETE FROM product_container_lines');
    const result = await refreshExpected(pool, { log: quiet });
    assert.equal(result.status, 'empty-source');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM product_container_expected')).rows[0].n, 3);
  } finally { await db.close(); }
});

test('thieu migration 0074: requestExpectedRefresh nuot loi 42P01, loi khac cung khong nem ra', async () => {
  const CONFIG = require('../config');
  const previous = CONFIG.SUPABASE_DB_URL;
  CONFIG.SUPABASE_DB_URL = 'postgres://fixture';
  const db = new PGlite();
  try {
    const pool = { query: (s, p) => db.query(s, p), connect: async () => ({ query: (s, p) => db.query(s, p), release() {} }) };
    assert.equal(await requestExpectedRefresh(pool, { log: quiet }), null);
    const broken = { query() {}, connect: async () => ({ query: async () => { throw Object.assign(new Error('boom'), { code: 'XX000' }); }, release() {} }) };
    const originalError = console.error;
    console.error = quiet;
    try { assert.equal(await requestExpectedRefresh(broken, { log: quiet }), null); } finally { console.error = originalError; }
  } finally { CONFIG.SUPABASE_DB_URL = previous; await db.close(); }
});

test('repository: doc theo thu tu sheet, so la number, filters theo thu tu xuat hien, cache theo version, thieu bang => rong', async () => {
  const { db, pool } = await setup();
  try {
    const repo = createExpectedRepository({ pool });
    assert.deepEqual((await repo.getExpected()).rows, []);
    await seed(db);
    await refreshExpected(pool, { log: quiet });
    const data = await repo.getExpected();
    assert.equal(data.rows.length, 3);
    assert.equal(data.rows[0].productName, 'Ao thun');
    assert.equal(data.rows[0].quantity, 50);
    assert.equal(data.rows[1].unitsPerPackage, null);
    assert.equal(data.rows[2].quantity, 8.5);
    assert.deepEqual(data.filters, { containers: ['CONT A', 'CONT B'], statuses: ['1.Chưa có lịch', '3.Đã bốc'] });
    assert.equal(data.meta.rowCount, 3);
    assert.equal(data.meta.version, '1');
    assert.ok(data.meta.computedAt);
    // Cache: cung phien ban => cung doi tuong dong.
    assert.equal((await repo.getExpected()).rows, data.rows);
  } finally { await db.close(); }

  const bare = new PGlite();
  try {
    assert.deepEqual((await createExpectedRepository({ pool: bare }).getExpected()).meta, { computedAt: null, version: null, rowCount: 0 });
  } finally { await bare.close(); }
});
