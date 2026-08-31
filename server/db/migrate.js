'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const config = require('../config');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureSchemaMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

function listMigrationFiles(migrationsDir) {
  return fs.readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

async function getAppliedMigrations(client) {
  const result = await client.query('SELECT filename FROM schema_migrations');
  return new Set(result.rows.map((row) => row.filename));
}

async function applyMigration(client, migrationsDir, filename) {
  const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function runMigrations(client, migrationsDir = MIGRATIONS_DIR) {
  await ensureSchemaMigrationsTable(client);
  const applied = await getAppliedMigrations(client);
  const files = listMigrationFiles(migrationsDir);
  let appliedCount = 0;

  for (const filename of files) {
    if (applied.has(filename)) continue;
    console.log(`[migrate] applying ${filename}...`);
    await applyMigration(client, migrationsDir, filename);
    appliedCount++;
  }

  console.log(
    appliedCount === 0
      ? `[migrate] up to date (${files.length}/${files.length})`
      : `[migrate] applied ${appliedCount} migration(s), up to date (${files.length}/${files.length})`
  );

  return { totalFiles: files.length, appliedCount };
}

async function main() {
  const client = new Client({
    connectionString: config.DATABASE_URL,
    ssl: config.PGSSL ? { rejectUnauthorized: false } : false
  });
  await client.connect();
  try {
    await runMigrations(client);
  } finally {
    await client.end();
  }
}

module.exports = { runMigrations, listMigrationFiles };

if (require.main === module) {
  main().catch((err) => {
    console.error('[migrate] failed:', err.message);
    process.exit(1);
  });
}
