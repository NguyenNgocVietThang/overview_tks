'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CONFIG = require('../config');
const { getPool } = require('../db/pool');
const { createCheckpointRepository } = require('./checkpointRepository');

test('checkpoint repository round-trips on configured Supabase', {
  skip: CONFIG.SUPABASE_DB_URL ? false : 'SUPABASE_DB_URL chưa cấu hình — bỏ qua test tích hợp'
}, async (t) => {
  const pool = getPool();
  t.after(() => pool.end());
  const repo = createCheckpointRepository({ pool });
  const client = await pool.connect();
  t.after(() => client.release());
  await client.query('BEGIN');
  t.after(() => client.query('ROLLBACK'));
  await repo.advanceCheckpoint('hanoi', 'integration_test', '2026-09-14T00:00:00Z', { client });
  const row = await repo.getCheckpoint('hanoi', 'integration_test');
  assert.equal(new Date(row.last_synced_at).toISOString(), '2026-09-14T00:00:00.000Z');
});
