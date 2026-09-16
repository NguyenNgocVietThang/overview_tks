'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const POOL_MODULE = require.resolve('./pool');
const CONFIG_MODULE = require.resolve('../config');

function loadPoolModule(databaseUrl) {
  if (databaseUrl === undefined) {
    process.env.SUPABASE_DB_URL = '';
  } else {
    process.env.SUPABASE_DB_URL = databaseUrl;
  }

  delete require.cache[POOL_MODULE];
  delete require.cache[CONFIG_MODULE];
  return require('./pool');
}

test('pool module loads without SUPABASE_DB_URL and reports a clear error only on query', async () => {
  const { getPool } = loadPoolModule(undefined);
  const pool = getPool();

  await assert.rejects(
    pool.query('SELECT 1'),
    /SUPABASE_DB_URL chưa được cấu hình/
  );
});

test('getPool returns one lazy pg Pool instance when SUPABASE_DB_URL is configured', () => {
  const { getPool } = loadPoolModule('postgresql://user:password@localhost:5432/test');

  const first = getPool();
  const second = getPool();

  assert.equal(first, second);
  assert.equal(typeof first.query, 'function');
});

test.after(() => {
  delete process.env.SUPABASE_DB_URL;
  delete require.cache[POOL_MODULE];
  delete require.cache[CONFIG_MODULE];
});
