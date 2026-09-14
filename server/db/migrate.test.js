'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runMigrations } = require('./migrate');

function createMigrationDir(t, files) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tks-migrations-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  for (const [filename, sql] of Object.entries(files)) {
    fs.writeFileSync(path.join(directory, filename), sql, 'utf8');
  }

  return directory;
}

function createFakePool({ applied = [], failOn } = {}) {
  const calls = [];
  const client = {
    async query(sql, params) {
      const normalized = String(sql).trim();
      calls.push({ sql: normalized, params });

      if (normalized.startsWith('SELECT filename FROM schema_migrations')) {
        return { rows: applied.map((filename) => ({ filename })) };
      }
      if (failOn && normalized.includes(failOn)) {
        throw new Error(`SQL failed: ${failOn}`);
      }
      return { rows: [] };
    },
    release() {
      calls.push({ sql: 'RELEASE' });
    }
  };

  return {
    calls,
    pool: { connect: async () => client }
  };
}

test('runMigrations applies SQL files in filename order and skips applied files', async (t) => {
  const migrationsDir = createMigrationDir(t, {
    '0002_second.sql': 'SELECT 2;',
    '0001_first.sql': 'SELECT 1;',
    'notes.md': 'ignored'
  });
  const fake = createFakePool({ applied: ['0001_first.sql'] });

  const result = await runMigrations({
    pool: fake.pool,
    migrationsDir,
    logger: { log() {} }
  });

  assert.deepEqual(result, {
    applied: ['0002_second.sql'],
    skipped: ['0001_first.sql']
  });
  assert.deepEqual(
    fake.calls.filter((call) => call.sql === 'SELECT 1;' || call.sql === 'SELECT 2;').map((call) => call.sql),
    ['SELECT 2;']
  );
  assert.deepEqual(
    fake.calls.filter((call) => call.sql.startsWith('INSERT INTO schema_migrations')).map((call) => call.params),
    [['0002_second.sql']]
  );
});

test('runMigrations rolls back the failing file and does not run later files', async (t) => {
  const migrationsDir = createMigrationDir(t, {
    '0001_ok.sql': 'CREATE TABLE ok_table(id INT);',
    '0002_broken.sql': 'CREATE TABLE partial_table(id INT); BROKEN;',
    '0003_never.sql': 'CREATE TABLE never_table(id INT);'
  });
  const fake = createFakePool({ failOn: 'BROKEN' });

  await assert.rejects(
    runMigrations({ pool: fake.pool, migrationsDir, logger: { log() {} } }),
    /SQL failed: BROKEN/
  );

  const sqlCalls = fake.calls.map((call) => call.sql);
  assert.deepEqual(sqlCalls.filter((sql) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)), [
    'BEGIN',
    'COMMIT',
    'BEGIN',
    'ROLLBACK'
  ]);
  assert.equal(sqlCalls.includes('CREATE TABLE never_table(id INT);'), false);
  assert.equal(sqlCalls.at(-1), 'RELEASE');
});
