'use strict';

// Test day-du cho THU MUC migrations/ that (khac migrate.test.js dung file
// .sql tong hop de test co che runner). Chay tren schema rieng cua Postgres
// that (Docker dev) — khong mock pg, dung nguyen tac PlanDB-Phase1-Spec.md §14.

const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const config = require('../config');
const { runMigrations } = require('./migrate');

function makeSchemaName() {
  return 'test_migrations_' + Math.random().toString(36).slice(2, 10);
}

async function withTestSchema(fn) {
  const schemaName = makeSchemaName();
  const client = new Client({
    connectionString: config.DATABASE_URL,
    ssl: config.PGSSL ? { rejectUnauthorized: false } : false
  });
  await client.connect();
  await client.query(`CREATE SCHEMA "${schemaName}"`);
  await client.query(`SET search_path TO "${schemaName}"`);
  try {
    await fn(client, schemaName);
  } finally {
    await client.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await client.end();
  }
}

test('migrations that: 0001_branches.sql tao bang branches va seed 2 chi nhanh', async () => {
  await withTestSchema(async (client) => {
    await runMigrations(client);

    const columns = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'branches'
      ORDER BY ordinal_position
    `);
    const columnNames = columns.rows.map((row) => row.column_name);
    assert.deepEqual(columnNames, [
      'id', 'code', 'name', 'kiotviet_retailer', 'is_active', 'created_at', 'updated_at'
    ]);

    const branches = await client.query('SELECT code, name, kiotviet_retailer, is_active FROM branches ORDER BY code');
    assert.deepEqual(branches.rows, [
      { code: 'hanoi', name: 'Hà Nội', kiotviet_retailer: 'CHhanoi', is_active: true },
      { code: 'saigon', name: 'Sài Gòn', kiotviet_retailer: 'CHsaigon', is_active: true }
    ]);
  });
});

test('migrations that: chay lan 2 khong tao trung dong seed branches (idempotent)', async () => {
  await withTestSchema(async (client) => {
    await runMigrations(client);
    await runMigrations(client);

    const count = await client.query('SELECT COUNT(*)::int AS count FROM branches');
    assert.equal(count.rows[0].count, 2);
  });
});

test('migrations that: 0012_sync_infra.sql tao bang sync_checkpoints va sync_run_log', async () => {
  await withTestSchema(async (client) => {
    await runMigrations(client);

    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name IN ('sync_checkpoints', 'sync_run_log')
      ORDER BY table_name
    `);
    assert.deepEqual(tables.rows.map((row) => row.table_name), ['sync_checkpoints', 'sync_run_log']);

    const [{ id: hanoiId }] = (await client.query(`SELECT id FROM branches WHERE code = 'hanoi'`)).rows;

    await client.query(
      `INSERT INTO sync_checkpoints (branch_id, entity_name, consecutive_error_count) VALUES ($1, 'categories', 0)`,
      [hanoiId]
    );
    await client.query(
      `INSERT INTO sync_run_log (branch_id, entity_name, started_at, status) VALUES ($1, 'categories', now(), 'success')`,
      [hanoiId]
    );

    const checkpoint = await client.query('SELECT * FROM sync_checkpoints WHERE branch_id = $1', [hanoiId]);
    assert.equal(checkpoint.rows.length, 1);
    const runLog = await client.query('SELECT * FROM sync_run_log WHERE branch_id = $1', [hanoiId]);
    assert.equal(runLog.rows.length, 1);
  });
});

test('migrations that: code cua branches la UNIQUE', async () => {
  await withTestSchema(async (client) => {
    await runMigrations(client);
    await assert.rejects(
      () => client.query(`INSERT INTO branches (code, name, kiotviet_retailer) VALUES ('hanoi', 'Trung lap', 'X')`),
      /duplicate key value violates unique constraint/
    );
  });
});
