'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { createCustomerPriceLevelRepository } = require('./customerPriceLevelRepository');
const { mapLevel, consolidate, runImport } = require('./customerLevelExcelImport');
const { serviceSnapshot } = require('./testFixtures');

const migDir = path.join(__dirname, '../db/migrations');
async function setup() {
  const db = new PGlite();
  await db.exec('CREATE TABLE customers(branch text, id bigint, code text, name text, raw jsonb)');
  for (const prefix of ['0087', '0088', '0089', '0080', '0084', '0090']) {
    const f = fs.readdirSync(migDir).find(x => x.startsWith(prefix));
    await db.exec(fs.readFileSync(path.join(migDir, f), 'utf8'));
  }
  const pool = { query: (q, p) => db.query(q, p), connect: async () => ({ query: (q, p) => db.query(q, p), release() {} }) };
  return { db, pool, repo: createCustomerPriceLevelRepository({ pool }) };
}
const row = (n, name, lv, tag = '', phone = '', address = '') => ({ rowNumber: n, name, levelLabel: lv, newCustomer: tag, phone, address });

test('level mapping and duplicate handling (conflicting duplicates are held back)', () => {
  assert.deepEqual(['Vừa', 'Mới', 'Lớn', 'VIP', 'vip', 'x'].map(mapLevel), ['medium', 'new', 'large', 'vip', 'vip', null]);
  const r = consolidate([row(2, 'Chị A', 'Vừa'), row(3, 'chị  a', 'VIP', 'T10/26'), row(4, 'B', 'zzz'), row(5, '', 'Lớn')]);
  assert.equal(r.entries.length, 0);
  assert.deepEqual(r.heldBack, ['chị  a']);
  const same = consolidate([row(2, 'Chị A', 'Vừa'), row(3, 'chị  a', 'Vừa')]);
  assert.equal(same.entries.length, 1);
  assert.equal(same.duplicates[0].conflict, false);
  assert.equal(r.duplicates[0].conflict, true);
  assert.equal(r.invalid.length, 2);
});

test('refuses apply when uninitialized; preview, apply, idempotent rerun; unmatched never created', async () => {
  const { db, pool, repo } = await setup();
  try {
    await db.query(`INSERT INTO customers VALUES ('hanoi',1,'KH1','Chị A','{}'),('hanoi',2,'KH2','Anh B','{}')`);
    const rows = [row(2, 'Chị A', 'VIP', 'T10/26', '0901', 'HN'), row(3, 'Anh B', 'Vừa', 'Cũ'), row(4, 'Lạ hoắc', 'Lớn')];
    await assert.rejects(runImport({ rows, pool, repo, apply: true }), /initialized_at/);
    await repo.initialize(serviceSnapshot());
    const prev = await runImport({ rows, pool, repo, apply: false });
    assert.equal(prev.matched, 2);
    assert.equal(prev.unmatched, 1);
    assert.equal(prev.wouldChange, 2);
    assert.equal((await db.query('SELECT count(*)::int n FROM customer_profiles')).rows[0].n, 0);
    const ap = await runImport({ rows, pool, repo, apply: true });
    assert.equal(ap.changed, 2);
    const lv = await repo.getLevels(['chị a', 'anh b']);
    assert.deepEqual([lv['chị a'].level, lv['chị a'].newCustomer, lv['anh b'].level, lv['anh b'].newCustomer], ['vip', 'T10/26', 'medium', 'Cũ']);
    assert.equal((await db.query("SELECT count(*)::int n FROM customer_price_levels WHERE customer_key='lạ hoắc'")).rows[0].n, 0);
    const hist = (await db.query('SELECT count(*)::int n FROM customer_price_level_history')).rows[0].n;
    const again = await runImport({ rows, pool, repo, apply: true });
    assert.equal(again.changed, 0);
    assert.equal(again.wouldChange, 0);
    assert.equal((await db.query('SELECT count(*)::int n FROM customer_price_level_history')).rows[0].n, hist);
  } finally { await db.close(); }
});

test('phone/address only fill empty values and never overwrite hand-entered ones', async () => {
  const { db, pool, repo } = await setup();
  try {
    await db.query(`INSERT INTO customers VALUES ('hanoi',1,'KH1','Chị A','{}'),('hanoi',2,'KH2','Anh B','{}')`);
    await repo.initialize(serviceSnapshot());
    await db.query(`INSERT INTO customer_profiles(customer_key, customer_name, phone, address, updated_by_name) VALUES ('chị a','Chị A','0999','','Tay')`);
    const rows = [row(2, 'Chị A', 'VIP', '', '0901', 'Hà Nội'), row(3, 'Anh B', 'Vừa', '', '0902', 'SG')];
    await runImport({ rows, pool, repo, apply: true });
    const p = Object.fromEntries((await db.query('SELECT customer_key, phone, address FROM customer_profiles')).rows.map(r => [r.customer_key, r]));
    assert.deepEqual([p['chị a'].phone, p['chị a'].address, p['anh b'].phone, p['anh b'].address], ['0999', 'Hà Nội', '0902', 'SG']);
  } finally { await db.close(); }
});
