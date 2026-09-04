'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const config = require('../config');
const { runMigrations } = require('../db/migrate');
const { getCheckpoint, recordSuccess, recordError } = require('./syncCheckpointRepository');

function makeSchemaName() {
  return 'test_checkpoint_' + Math.random().toString(36).slice(2, 10);
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
    const branchId = hanoiRow.rows[0].id;

    await fn(pool, branchId);
  } finally {
    await pool.end();
    await setupPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await setupPool.end();
  }
}

test('getCheckpoint tra ve null khi chua co dong nao', async () => {
  await withTestPool(async (pool, branchId) => {
    const checkpoint = await getCheckpoint(pool, branchId, 'categories');
    assert.equal(checkpoint, null);
  });
});

test('recordSuccess tao moi checkpoint va ghi sync_run_log status=success', async () => {
  await withTestPool(async (pool, branchId) => {
    const startedAt = new Date('2026-08-30T01:00:00Z');
    const finishedAt = new Date('2026-08-30T01:00:05Z');
    const checkpointAt = new Date('2026-08-30T00:55:00Z');

    await recordSuccess(pool, branchId, 'categories', {
      checkpointAt, fetched: 10, upserted: 10, startedAt, finishedAt
    });

    const checkpoint = await getCheckpoint(pool, branchId, 'categories');
    assert.equal(checkpoint.lastCheckpointAt.toISOString(), checkpointAt.toISOString());
    assert.equal(checkpoint.consecutiveErrorCount, 0);

    const log = await pool.query(
      `SELECT status, records_fetched, records_upserted FROM sync_run_log WHERE branch_id = $1 AND entity_name = 'categories'`,
      [branchId]
    );
    assert.equal(log.rows.length, 1);
    assert.equal(log.rows[0].status, 'success');
    assert.equal(log.rows[0].records_fetched, 10);
    assert.equal(log.rows[0].records_upserted, 10);
  });
});

test('recordError tao moi checkpoint voi consecutive_error_count=1, khong dat last_checkpoint_at', async () => {
  await withTestPool(async (pool, branchId) => {
    const startedAt = new Date('2026-08-30T01:00:00Z');
    const finishedAt = new Date('2026-08-30T01:00:05Z');

    await recordError(pool, branchId, 'categories', {
      error: new Error('KiotViet 500'), startedAt, finishedAt
    });

    const checkpoint = await getCheckpoint(pool, branchId, 'categories');
    assert.equal(checkpoint.lastCheckpointAt, null);
    assert.equal(checkpoint.consecutiveErrorCount, 1);

    const log = await pool.query(
      `SELECT status, error_message FROM sync_run_log WHERE branch_id = $1 AND entity_name = 'categories'`,
      [branchId]
    );
    assert.equal(log.rows.length, 1);
    assert.equal(log.rows[0].status, 'error');
    assert.match(log.rows[0].error_message, /KiotViet 500/);
  });
});

test('recordError tang dan consecutive_error_count qua nhieu lan goi lien tiep', async () => {
  await withTestPool(async (pool, branchId) => {
    const startedAt = new Date();
    const finishedAt = new Date();

    await recordError(pool, branchId, 'categories', { error: new Error('e1'), startedAt, finishedAt });
    await recordError(pool, branchId, 'categories', { error: new Error('e2'), startedAt, finishedAt });
    await recordError(pool, branchId, 'categories', { error: new Error('e3'), startedAt, finishedAt });

    const checkpoint = await getCheckpoint(pool, branchId, 'categories');
    assert.equal(checkpoint.consecutiveErrorCount, 3);

    const log = await pool.query(
      `SELECT COUNT(*)::int AS count FROM sync_run_log WHERE branch_id = $1 AND entity_name = 'categories'`,
      [branchId]
    );
    assert.equal(log.rows[0].count, 3, 'moi lan goi phai ghi 1 dong sync_run_log rieng, khong upsert');
  });
});

test('recordSuccess sau nhieu loi se reset consecutive_error_count ve 0 va day checkpoint tien len', async () => {
  await withTestPool(async (pool, branchId) => {
    const t = new Date();
    await recordError(pool, branchId, 'categories', { error: new Error('e1'), startedAt: t, finishedAt: t });
    await recordError(pool, branchId, 'categories', { error: new Error('e2'), startedAt: t, finishedAt: t });

    const checkpointAt = new Date('2026-08-30T02:00:00Z');
    await recordSuccess(pool, branchId, 'categories', {
      checkpointAt, fetched: 5, upserted: 5, startedAt: t, finishedAt: t
    });

    const checkpoint = await getCheckpoint(pool, branchId, 'categories');
    assert.equal(checkpoint.consecutiveErrorCount, 0);
    assert.equal(checkpoint.lastCheckpointAt.toISOString(), checkpointAt.toISOString());
  });
});

test('recordError sau recordSuccess KHONG duoc doi last_checkpoint_at da co', async () => {
  await withTestPool(async (pool, branchId) => {
    const t = new Date();
    const checkpointAt = new Date('2026-08-30T02:00:00Z');
    await recordSuccess(pool, branchId, 'categories', {
      checkpointAt, fetched: 5, upserted: 5, startedAt: t, finishedAt: t
    });

    await recordError(pool, branchId, 'categories', { error: new Error('loi giua chung'), startedAt: t, finishedAt: t });

    const checkpoint = await getCheckpoint(pool, branchId, 'categories');
    assert.equal(checkpoint.lastCheckpointAt.toISOString(), checkpointAt.toISOString());
    assert.equal(checkpoint.consecutiveErrorCount, 1);
  });
});

test('recordSuccess la mot transaction: neu that bai thi khong tao checkpoint mo coi', async () => {
  await withTestPool(async (pool) => {
    const invalidBranchId = 999999;
    const t = new Date();

    await assert.rejects(() =>
      recordSuccess(pool, invalidBranchId, 'categories', {
        checkpointAt: t, fetched: 1, upserted: 1, startedAt: t, finishedAt: t
      })
    );

    const checkpoint = await pool.query('SELECT * FROM sync_checkpoints WHERE branch_id = $1', [invalidBranchId]);
    assert.equal(checkpoint.rows.length, 0);
    const log = await pool.query('SELECT * FROM sync_run_log WHERE branch_id = $1', [invalidBranchId]);
    assert.equal(log.rows.length, 0);
  });
});

test('entity_name khac nhau co checkpoint doc lap tren cung 1 branch', async () => {
  await withTestPool(async (pool, branchId) => {
    const t = new Date();
    await recordSuccess(pool, branchId, 'categories', { checkpointAt: t, fetched: 1, upserted: 1, startedAt: t, finishedAt: t });
    await recordError(pool, branchId, 'products', { error: new Error('loi products'), startedAt: t, finishedAt: t });

    const categoriesCheckpoint = await getCheckpoint(pool, branchId, 'categories');
    const productsCheckpoint = await getCheckpoint(pool, branchId, 'products');

    assert.equal(categoriesCheckpoint.consecutiveErrorCount, 0);
    assert.equal(productsCheckpoint.consecutiveErrorCount, 1);
  });
});
