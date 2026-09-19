'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCheckpointRepository } = require('./checkpointRepository');

const TEST_DB_URL = process.env.SUPABASE_TEST_DB_URL || '';

test('checkpoint repository round-trips on dedicated test database', {
  skip: TEST_DB_URL ? false : 'SUPABASE_TEST_DB_URL chưa cấu hình — bỏ qua test tích hợp'
}, async (t) => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: TEST_DB_URL });
  const repo = createCheckpointRepository({ pool });
  const client = await pool.connect();
  await client.query('BEGIN');
  t.after(async () => {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  });
  await repo.advanceCheckpoint('hanoi', 'integration_test', '2026-09-14T00:00:00Z', { client });
  const row = await repo.getCheckpoint('hanoi', 'integration_test');
  assert.equal(new Date(row.last_synced_at).toISOString(), '2026-09-14T00:00:00.000Z');
});
