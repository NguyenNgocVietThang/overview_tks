'use strict';

const { getPool } = require('../db/pool');

function createDebtCollectionStatusRepository({ pool = getPool() } = {}) {
  async function listByBranch(branch) {
    const result = await pool.query(
      `SELECT branch, customer_key, status, alert_signature,
              updated_by_user_id, updated_by_name, updated_at
       FROM debt_collection_statuses
       WHERE branch = $1
       ORDER BY updated_at DESC`,
      [branch]
    );
    return result.rows;
  }

  async function upsertStatus({
    branch,
    customerKey,
    status,
    alertSignature,
    userId,
    userName
  }) {
    const result = await pool.query(
      `INSERT INTO debt_collection_statuses (
         branch, customer_key, status, alert_signature,
         updated_by_user_id, updated_by_name, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (branch, customer_key) DO UPDATE SET
         status = EXCLUDED.status,
         alert_signature = EXCLUDED.alert_signature,
         updated_by_user_id = EXCLUDED.updated_by_user_id,
         updated_by_name = EXCLUDED.updated_by_name,
         updated_at = now()
       RETURNING branch, customer_key, status, alert_signature,
                 updated_by_user_id, updated_by_name, updated_at`,
      [branch, customerKey, status, alertSignature, userId || null, userName || '']
    );
    return result.rows[0];
  }

  return { listByBranch, upsertStatus };
}

const repository = createDebtCollectionStatusRepository();

module.exports = {
  createDebtCollectionStatusRepository,
  listByBranch: (...args) => repository.listByBranch(...args),
  upsertStatus: (...args) => repository.upsertStatus(...args)
};
