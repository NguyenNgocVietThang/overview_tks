'use strict';

// Doc/ghi bang backfill_progress (migration 0008). Doc lap hoan toan voi
// checkpointRepository.js (sync_checkpoints cua Giai doan 2) - khong duoc goi
// lan nhau. Moi ham nhan truc tiep 1 pg client/pool (co ham .query) do noi goi
// (backfill.js) truyen vao, giong cach backfillPlan.js duoc goi tu do.

async function getChunkProgress(pgClient, branch, entity, chunkKey) {
  const result = await pgClient.query(
    `SELECT branch, entity, chunk_key, status, next_item, records_synced, last_error, started_at, finished_at, updated_at
     FROM backfill_progress WHERE branch = $1 AND entity = $2 AND chunk_key = $3`,
    [branch, entity, chunkKey]
  );
  return result.rows[0] || null;
}

async function markChunkStarted(pgClient, branch, entity, chunkKey) {
  await pgClient.query(
    `INSERT INTO backfill_progress (branch, entity, chunk_key, status, started_at, updated_at)
     VALUES ($1, $2, $3, 'running', now(), now())
     ON CONFLICT (branch, entity, chunk_key) DO UPDATE SET
       status = 'running',
       started_at = COALESCE(backfill_progress.started_at, EXCLUDED.started_at),
       updated_at = now()`,
    [branch, entity, chunkKey]
  );
}

async function advanceChunkProgress(pgClient, branch, entity, chunkKey, { nextItem, recordsInPage }) {
  await pgClient.query(
    `INSERT INTO backfill_progress (branch, entity, chunk_key, status, next_item, records_synced, updated_at)
     VALUES ($1, $2, $3, 'running', $4, $5, now())
     ON CONFLICT (branch, entity, chunk_key) DO UPDATE SET
       next_item = EXCLUDED.next_item,
       records_synced = backfill_progress.records_synced + $5,
       status = 'running',
       updated_at = now()`,
    [branch, entity, chunkKey, nextItem, recordsInPage]
  );
}

async function markChunkDone(pgClient, branch, entity, chunkKey) {
  await pgClient.query(
    `UPDATE backfill_progress SET status = 'done', finished_at = now(), updated_at = now()
     WHERE branch = $1 AND entity = $2 AND chunk_key = $3`,
    [branch, entity, chunkKey]
  );
}

async function markChunkError(pgClient, branch, entity, chunkKey, errorMessage) {
  await pgClient.query(
    `UPDATE backfill_progress SET status = 'error', last_error = $4, updated_at = now()
     WHERE branch = $1 AND entity = $2 AND chunk_key = $3`,
    [branch, entity, chunkKey, String(errorMessage)]
  );
}

module.exports = {
  getChunkProgress,
  markChunkStarted,
  advanceChunkProgress,
  markChunkDone,
  markChunkError
};
