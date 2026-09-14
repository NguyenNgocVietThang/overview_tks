'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getPool } = require('./pool');

const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function runMigrations({
  pool = getPool(),
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
  logger = console
} = {}) {
  const client = await pool.connect();
  const result = { applied: [], skipped: [] };

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const appliedResult = await client.query(
      'SELECT filename FROM schema_migrations ORDER BY filename'
    );
    const alreadyApplied = new Set(appliedResult.rows.map((row) => row.filename));
    const files = fs.readdirSync(migrationsDir)
      .filter((filename) => filename.endsWith('.sql'))
      .sort((left, right) => left.localeCompare(right));

    for (const filename of files) {
      if (alreadyApplied.has(filename)) {
        result.skipped.push(filename);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }

      result.applied.push(filename);
      logger.log(`[db:migrate] Applied ${filename}`);
    }

    logger.log(`[db:migrate] ${result.applied.length} migration(s) applied`);
    return result;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runMigrations().catch((error) => {
    console.error(`[db:migrate] Failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { runMigrations };
