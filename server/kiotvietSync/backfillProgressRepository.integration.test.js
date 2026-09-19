'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CONFIG = require('../config');
const { getPool } = require('../db/pool');
const repo = require('./backfillProgressRepository');

test('backfill progress repository round-trips on configured Supabase', {
  skip: CONFIG.SUPABASE_DB_URL ? false : 'SUPABASE_DB_URL chưa cấu hình — bỏ qua test tích hợp'
}, async (t) => {
  const pool = getPool();
  const client = await pool.connect();
  await client.query('BEGIN');
  t.after(async () => {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  });

  await repo.markChunkStarted(client, 'hanoi', 'integration_test', '2026-01');
  await repo.advanceChunkProgress(client, 'hanoi', 'integration_test', '2026-01', { nextItem: 100, recordsInPage: 40 });
  const row = await repo.getChunkProgress(client, 'hanoi', 'integration_test', '2026-01');
  assert.equal(row.status, 'running');
  assert.equal(row.next_item, 100);
  assert.equal(row.records_synced, 40);

  await repo.markChunkDone(client, 'hanoi', 'integration_test', '2026-01');
  const done = await repo.getChunkProgress(client, 'hanoi', 'integration_test', '2026-01');
  assert.equal(done.status, 'done');
});
