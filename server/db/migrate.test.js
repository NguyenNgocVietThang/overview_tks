'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');
const config = require('../config');
const { runMigrations } = require('./migrate');

function makeSchemaName() {
  return 'test_migrate_' + Math.random().toString(36).slice(2, 10);
}

function makeTempMigrationsDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kv-migrations-'));
  for (const [filename, sql] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, filename), sql, 'utf8');
  }
  return dir;
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

test('runMigrations tao bang schema_migrations va ap dung migration dau tien', async () => {
  await withTestSchema(async (client) => {
    const migrationsDir = makeTempMigrationsDir({
      '0001_widgets.sql': 'CREATE TABLE widgets (id BIGINT PRIMARY KEY);'
    });

    const result = await runMigrations(client, migrationsDir);

    assert.equal(result.totalFiles, 1);
    assert.equal(result.appliedCount, 1);

    const tables = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`
    );
    const tableNames = tables.rows.map((row) => row.table_name).sort();
    assert.deepEqual(tableNames, ['schema_migrations', 'widgets']);

    const applied = await client.query('SELECT filename FROM schema_migrations');
    assert.deepEqual(applied.rows.map((row) => row.filename), ['0001_widgets.sql']);
  });
});

test('runMigrations chay lan 2 khong ap lai file da chay', async () => {
  await withTestSchema(async (client) => {
    const migrationsDir = makeTempMigrationsDir({
      '0001_widgets.sql': 'CREATE TABLE widgets (id BIGINT PRIMARY KEY);'
    });

    const first = await runMigrations(client, migrationsDir);
    assert.equal(first.appliedCount, 1);

    const second = await runMigrations(client, migrationsDir);
    assert.equal(second.appliedCount, 0);
    assert.equal(second.totalFiles, 1);

    const applied = await client.query('SELECT filename FROM schema_migrations');
    assert.equal(applied.rows.length, 1);
  });
});

test('runMigrations chi ap dung file moi khi them file sau lan chay dau', async () => {
  await withTestSchema(async (client) => {
    const migrationsDir = makeTempMigrationsDir({
      '0001_widgets.sql': 'CREATE TABLE widgets (id BIGINT PRIMARY KEY);'
    });
    await runMigrations(client, migrationsDir);

    fs.writeFileSync(
      path.join(migrationsDir, '0002_gadgets.sql'),
      'CREATE TABLE gadgets (id BIGINT PRIMARY KEY);',
      'utf8'
    );

    const result = await runMigrations(client, migrationsDir);
    assert.equal(result.appliedCount, 1);
    assert.equal(result.totalFiles, 2);

    const applied = await client.query('SELECT filename FROM schema_migrations ORDER BY filename');
    assert.deepEqual(applied.rows.map((row) => row.filename), ['0001_widgets.sql', '0002_gadgets.sql']);
  });
});

test('runMigrations rollback toan bo file neu loi giua chung, khong ghi schema_migrations', async () => {
  await withTestSchema(async (client) => {
    const migrationsDir = makeTempMigrationsDir({
      '0001_broken.sql': 'CREATE TABLE broken (id BIGINT PRIMARY KEY); SELECT this_column_does_not_exist FROM broken;'
    });

    await assert.rejects(() => runMigrations(client, migrationsDir));

    const tables = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'broken'`
    );
    assert.equal(tables.rows.length, 0, 'bang "broken" khong duoc ton tai vi transaction phai rollback');

    const applied = await client.query('SELECT filename FROM schema_migrations');
    assert.deepEqual(applied.rows, []);
  });
});
