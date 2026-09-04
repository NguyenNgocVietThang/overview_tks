'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const config = require('../config');
const { runMigrations } = require('../db/migrate');
const { getOffset, saveOffset, clearOffset } = require('./backfillProgressRepository');

function makeSchemaName() {
  return 'test_backfillprog_' + Math.random().toString(36).slice(2, 10);
}

async function withTestPool(fn) {
  const schemaName = makeSchemaName();
  const setupPool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 2,
    ssl: config.PGSSL ? { rejectUnauthorized: false } : false
  });
  await setupPool.query(`CREATE SCHEMA "${schemaName}"`);

  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 2,
    ssl: config.PGSSL ? { rejectUnauthorized: false } : false,
    options: `-c search_path="${schemaName}"`
  });

  try {
    const setupClient = await pool.connect();
    try {
      await runMigrations(setupClient);
    } finally {
      setupClient.release();
    }
    const hanoiRow = await pool.query(`SELECT id FROM branches WHERE code = 'hanoi'`);
    await fn(pool, hanoiRow.rows[0].id);
  } finally {
    await pool.end();
    await setupPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await setupPool.end();
  }
}

test('getOffset tra ve 0 khi chua co checkpoint nao', async () => {
  await withTestPool(async (pool, branchId) => {
    const offset = await getOffset(pool, branchId, 'products:backfill');
    assert.equal(offset, 0);
  });
});

test('saveOffset roi getOffset tra ve dung gia tri vua luu', async () => {
  await withTestPool(async (pool, branchId) => {
    await saveOffset(pool, branchId, 'products:backfill', 500);
    assert.equal(await getOffset(pool, branchId, 'products:backfill'), 500);
  });
});

test('saveOffset goi nhieu lan ghi de (upsert), khong tao them dong', async () => {
  await withTestPool(async (pool, branchId) => {
    await saveOffset(pool, branchId, 'products:backfill', 100);
    await saveOffset(pool, branchId, 'products:backfill', 200);
    await saveOffset(pool, branchId, 'products:backfill', 300);

    assert.equal(await getOffset(pool, branchId, 'products:backfill'), 300);
    const rows = await pool.query(
      'SELECT COUNT(*)::int AS count FROM backfill_progress WHERE branch_id = $1 AND log_name = $2',
      [branchId, 'products:backfill']
    );
    assert.equal(rows.rows[0].count, 1);
  });
});

test('clearOffset xoa checkpoint, getOffset tra ve lai 0', async () => {
  await withTestPool(async (pool, branchId) => {
    await saveOffset(pool, branchId, 'products:backfill', 400);
    await clearOffset(pool, branchId, 'products:backfill');
    assert.equal(await getOffset(pool, branchId, 'products:backfill'), 0);
  });
});

test('log_name khac nhau co offset doc lap tren cung 1 branch', async () => {
  await withTestPool(async (pool, branchId) => {
    await saveOffset(pool, branchId, 'invoices:backfill:2026-01', 100);
    await saveOffset(pool, branchId, 'invoices:backfill:2026-02', 700);

    assert.equal(await getOffset(pool, branchId, 'invoices:backfill:2026-01'), 100);
    assert.equal(await getOffset(pool, branchId, 'invoices:backfill:2026-02'), 700);
  });
});
