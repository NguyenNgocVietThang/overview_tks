'use strict';

// Test "duong noi": syncDriver.pollEntityOnce + entities/products.js THAT + Postgres that (PGlite).
// Muc tieu: poll tang dan cua products khong du (sua hang loat / sua Mo ta khong bump
// modifiedDate) nen moi 24 gio phai quet TOAN BO; quet chi dung khi snapshot day du.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSyncDriver } = require('./syncDriver');
const { createCheckpointRepository } = require('./checkpointRepository');
const products = require('./entities/products');

const DAY = 24 * 60 * 60 * 1000;
const item = (id, extra = {}) => ({
  Id: id, Code: `SP${id}`, Name: `Hang ${id}`, CategoryId: 5, BasePrice: 1000, Unit: 'hop', IsActive: true,
  CreatedDate: '2026-01-01T00:00:00', ModifiedDate: '2026-01-02T00:00:00', description: 'T1 # 1T-100', ...extra
});

async function setup(t, seed = []) {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(fs.readFileSync(path.join(__dirname, '../db/migrations/0001_core_master_data.sql'), 'utf8'));
  await db.exec('ALTER TABLE products ALTER COLUMN base_price TYPE NUMERIC USING base_price::numeric');
  await products.upsertPage(db, 'hanoi', seed);
  await db.query("UPDATE products SET synced_at = '2020-01-01T00:00:00Z'");
  const pool = { query: (...args) => db.query(...args), connect: async () => ({ query: (...args) => db.query(...args), release() {} }) };
  const checkpoints = createCheckpointRepository({ pool });
  const state = { clock: Date.parse('2026-10-15T01:00:00Z'), events: [] };
  const driver = createSyncDriver({ pool, checkpointRepository: checkpoints, now: () => state.clock, events: { emit: (...args) => state.events.push(args) } });
  const activeOf = async () => Object.fromEntries((await db.query("SELECT id, is_active FROM products WHERE branch = 'hanoi' ORDER BY id")).rows.map(r => [Number(r.id), r.is_active]));
  return { db, checkpoints, driver, state, activeOf };
}

function fakeApi(pages, calls = []) {
  return { calls, fetchAllPages: async (endpoint, query, cb, options) => {
    calls.push({ endpoint, query, options });
    const total = pages.reduce((n, p) => n + p.length, 0);
    for (const page of pages) await cb(page, { total });
  } };
}

test('lan dau quet toan bo (sap theo id, requireComplete), ghi Mo ta moi va danh dau hang vang mat; sau do poll tang dan giu moc; du 24h thi quet lai', async t => {
  const { db, checkpoints, driver, state, activeOf } = await setup(t, [item(1), item(2), item(3)]);
  const api = fakeApi([[item(1, { description: 'T1 # 1T-200' })], [item(2)]]);

  await driver.pollEntityOnce(api, 'hanoi', products);
  assert.equal(api.calls[0].endpoint, 'products');
  assert.equal(api.calls[0].query.lastModifiedFrom, undefined);
  assert.equal(api.calls[0].query.orderBy, 'id');
  assert.equal(api.calls[0].query.orderDirection, 'ASC');
  assert.equal(api.calls[0].options.requireComplete, true);
  assert.equal(api.calls[0].query.includeInventory, 'true', 'giu nguyen listQuery cua products');
  assert.equal((await db.query('SELECT raw FROM products WHERE id = 1')).rows[0].raw.description, 'T1 # 1T-200');
  assert.deepEqual(await activeOf(), { 1: true, 2: true, 3: false }, 'id 3 vang mat o snapshot day du -> danh dau, khong xoa');
  const first = await checkpoints.getCheckpoint('hanoi', 'products');
  assert.equal(JSON.parse(first.note).productsReconciledAt, '2026-10-15T01:00:00.000Z');
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM products')).rows[0].n, 3);

  // Poll tang dan: dung lastModifiedFrom, khong sap xep, khong danh dau, giu moc doi soat.
  await db.query("INSERT INTO products(branch,id,code,name,raw,synced_at) VALUES ('hanoi',4,'SP4','Hang 4','{}','2020-01-01')");
  state.clock += 20 * 60 * 1000;
  const incr = fakeApi([[item(2)]]);
  await driver.pollEntityOnce(incr, 'hanoi', products);
  assert.equal(incr.calls[0].query.lastModifiedFrom, '2026-10-15T01:00:00.000Z');
  assert.equal(incr.calls[0].query.orderBy, undefined);
  assert.notEqual(incr.calls[0].options?.requireComplete, true);
  assert.equal((await activeOf())[4], null, 'poll tang dan khong danh dau hang vang mat');
  const second = await checkpoints.getCheckpoint('hanoi', 'products');
  assert.equal(JSON.parse(second.note).productsReconciledAt, '2026-10-15T01:00:00.000Z', 'moc doi soat khong bi poll tang dan xoa');
  assert.equal(new Date(second.last_synced_at).toISOString(), '2026-10-15T01:20:00.000Z');

  // Du 24 gio: quet toan bo lai, danh dau id 4 va doi moc.
  state.clock += DAY;
  const full = fakeApi([[item(1), item(2)]]);
  await driver.pollEntityOnce(full, 'hanoi', products);
  assert.equal(full.calls[0].query.lastModifiedFrom, undefined);
  assert.equal(full.calls[0].options.requireComplete, true);
  assert.equal((await activeOf())[4], false);
  assert.equal(JSON.parse((await checkpoints.getCheckpoint('hanoi', 'products')).note).productsReconciledAt, new Date(state.clock).toISOString());
  assert.deepEqual(state.events, [], 'products khong phat su kien khach hang');
});

test('snapshot thieu/trung ID, total lech hoac bi ngat giua chung: nem loi, KHONG danh dau hang vang mat, KHONG tien checkpoint', async t => {
  const cases = [
    [async cb => { await cb([item(1)], { total: 2 }); }, /Incomplete product snapshot.*1\/2/],
    [async cb => { await cb([item(1), item(1)], { total: 2 }); }, /Incomplete product snapshot.*missing\/duplicate ID/],
    [async cb => { await cb([item(1)], { total: 1 }); throw new Error('interrupted'); }, /interrupted/],
    [async cb => { await cb([], { total: 0 }); }, /Incomplete product snapshot.*invalid or empty/],
    [async cb => { await cb([item(1)]); }, /Incomplete product snapshot.*invalid or empty/],
    [async cb => { await cb([item(1)], { total: 2 }); await cb([item(2)], { total: 3 }); }, /Incomplete product snapshot.*invalid or empty/],
    [async cb => { await cb([{ Code: 'KHONG_ID', Name: 'x' }], { total: 1 }); }, /Incomplete product snapshot.*missing\/duplicate ID/]
  ];
  for (const [stream, expected] of cases) {
    const { checkpoints, driver, activeOf } = await setup(t, [item(1), item(2), item(3)]);
    await assert.rejects(driver.pollEntityOnce({ fetchAllPages: async (_e, _q, cb) => stream(cb) }, 'hanoi', products), expected);
    assert.deepEqual(await activeOf(), { 1: true, 2: true, 3: true }, 'khong danh dau khi snapshot khong day du');
    assert.equal(await checkpoints.getCheckpoint('hanoi', 'products'), null, 'khong danh dau hoan tat -> lan sau quet lai');
  }
});

test('danh dau hang vang mat va checkpoint hoan tat rollback cung nhau; thanh cong o lan thu hai', async t => {
  const { checkpoints, db, state, activeOf } = await setup(t, [item(1), item(2)]);
  const pool = { query: (...args) => db.query(...args), connect: async () => ({ query: (...args) => db.query(...args), release() {} }) };
  let fail = true;
  const driver = createSyncDriver({ pool, now: () => state.clock, events: { emit() {} }, checkpointRepository: { ...checkpoints,
    advanceCheckpoint: async (...args) => { await checkpoints.advanceCheckpoint(...args); if (fail) throw new Error('checkpoint failed'); }
  } });
  const api = fakeApi([[item(1)]]);
  await assert.rejects(driver.pollEntityOnce(api, 'hanoi', products), /checkpoint failed/);
  assert.deepEqual(await activeOf(), { 1: true, 2: true });
  assert.equal(await checkpoints.getCheckpoint('hanoi', 'products'), null);
  fail = false;
  await driver.pollEntityOnce(api, 'hanoi', products);
  assert.deepEqual(await activeOf(), { 1: true, 2: false });
  assert.ok(JSON.parse((await checkpoints.getCheckpoint('hanoi', 'products')).note).productsReconciledAt);
});

test('checkpoint bi recordFailure ghi de (note la thong bao loi) thi lan sau quet day du lai', async t => {
  const { checkpoints, driver, state } = await setup(t, [item(1)]);
  await driver.pollEntityOnce(fakeApi([[item(1)]]), 'hanoi', products);
  await checkpoints.recordFailure('hanoi', 'products', 'source unavailable');
  state.clock += 60 * 1000;
  const api = fakeApi([[item(1)]]);
  await driver.pollEntityOnce(api, 'hanoi', products);
  assert.equal(api.calls[0].query.lastModifiedFrom, undefined);
  assert.equal(api.calls[0].query.orderBy, 'id');
});

test('hai lan goi dong thoi cho cung co so chia se 1 lan quet products', async t => {
  const { driver } = await setup(t, [item(1)]);
  let release, calls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const api = { fetchAllPages: async (_e, _q, cb) => { calls++; await pending; await cb([item(1)], { total: 1 }); } };
  const first = driver.pollEntityOnce(api, 'hanoi', products);
  await new Promise(resolve => setImmediate(resolve));
  const second = driver.pollEntityOnce(api, 'hanoi', products);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});
