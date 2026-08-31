'use strict';

// Hop dong theo PlanDB-Phase1-Spec.md §10. checkpointAt truyen vao
// recordSuccess la THOI DIEM BAT DAU REQUEST (doc truoc khi goi KiotViet),
// khong phai gia tri lon nhat cua ModifiedDate trong ket qua — dung nguyen
// tac "khong tin tuong mu quang vao ModifiedDate" (PlanDB.md §7.2).

async function getCheckpoint(pool, branchId, entityName) {
  const result = await pool.query(
    'SELECT last_checkpoint_at, consecutive_error_count FROM sync_checkpoints WHERE branch_id = $1 AND entity_name = $2',
    [branchId, entityName]
  );
  if (result.rows.length === 0) return null;
  return {
    lastCheckpointAt: result.rows[0].last_checkpoint_at,
    consecutiveErrorCount: result.rows[0].consecutive_error_count
  };
}

async function recordSuccess(pool, branchId, entityName, { checkpointAt, fetched, upserted, startedAt, finishedAt }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO sync_checkpoints (branch_id, entity_name, last_checkpoint_at, last_success_at, consecutive_error_count, updated_at)
       VALUES ($1, $2, $3, now(), 0, now())
       ON CONFLICT (branch_id, entity_name) DO UPDATE SET
         last_checkpoint_at = EXCLUDED.last_checkpoint_at,
         last_success_at = now(),
         consecutive_error_count = 0,
         updated_at = now()`,
      [branchId, entityName, checkpointAt]
    );
    await client.query(
      `INSERT INTO sync_run_log (branch_id, entity_name, started_at, finished_at, status, records_fetched, records_upserted)
       VALUES ($1, $2, $3, $4, 'success', $5, $6)`,
      [branchId, entityName, startedAt, finishedAt, fetched, upserted]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function recordError(pool, branchId, entityName, { error, startedAt, finishedAt }) {
  const errorMessage = error && error.message ? error.message : String(error);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO sync_checkpoints (branch_id, entity_name, last_error, last_error_at, consecutive_error_count, updated_at)
       VALUES ($1, $2, $3, now(), 1, now())
       ON CONFLICT (branch_id, entity_name) DO UPDATE SET
         last_error = EXCLUDED.last_error,
         last_error_at = now(),
         consecutive_error_count = sync_checkpoints.consecutive_error_count + 1,
         updated_at = now()`,
      [branchId, entityName, errorMessage]
    );
    await client.query(
      `INSERT INTO sync_run_log (branch_id, entity_name, started_at, finished_at, status, error_message)
       VALUES ($1, $2, $3, $4, 'error', $5)`,
      [branchId, entityName, startedAt, finishedAt, errorMessage]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { getCheckpoint, recordSuccess, recordError };
