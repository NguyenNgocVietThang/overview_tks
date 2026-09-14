'use strict';

const { getPool } = require('../db/pool');

function createCheckpointRepository({ pool = getPool() } = {}) {
  async function getCheckpoint(branch, entity) {
    const result = await pool.query(
      `SELECT branch, entity, last_synced_at, last_success_at, note
       FROM sync_checkpoints WHERE branch = $1 AND entity = $2`,
      [branch, entity]
    );
    return result.rows[0] || null;
  }

  async function advanceCheckpoint(branch, entity, syncedAt, { client, note = null } = {}) {
    if (!client) throw new Error('advanceCheckpoint yêu cầu transaction client');
    await client.query(
      `INSERT INTO sync_checkpoints (branch, entity, last_synced_at, last_success_at, note)
       VALUES ($1, $2, $3, now(), $4)
       ON CONFLICT (branch, entity) DO UPDATE SET
         last_synced_at = EXCLUDED.last_synced_at,
         last_success_at = now(),
         note = EXCLUDED.note`,
      [branch, entity, syncedAt, note]
    );
  }

  async function recordFailure(branch, entity, errorMessage) {
    await pool.query(
      `INSERT INTO sync_checkpoints (branch, entity, note)
       VALUES ($1, $2, $3)
       ON CONFLICT (branch, entity) DO UPDATE SET note = EXCLUDED.note`,
      [branch, entity, String(errorMessage)]
    );
  }

  return { getCheckpoint, advanceCheckpoint, recordFailure };
}

const repository = createCheckpointRepository();
module.exports = { ...repository, createCheckpointRepository };
