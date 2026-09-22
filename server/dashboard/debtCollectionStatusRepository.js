'use strict';

const { getPool } = require('../db/pool');

// Cot `branch` cua debt_collection_statuses chi chap nhan 2 ma co so VAT LY
// (xem server/db/SCHEMA.md). "Cả hai" la mot lua chon giao dien, khong bao gio
// duoc phep xuong toi day — chan ngay o repository de khong phu thuoc vao
// viec moi route goi deu nho quy doi truoc.
const BRANCH_CODES = Object.freeze(['hanoi', 'saigon']);

const UPSERT_STATUS_SQL = `INSERT INTO debt_collection_statuses (
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
                 updated_by_user_id, updated_by_name, updated_at`;

function assertBranchCode(branch) {
  if (!BRANCH_CODES.includes(branch)) {
    throw new Error(`Mã cơ sở không hợp lệ: ${branch === null || branch === undefined ? String(branch) : `"${branch}"`}`);
  }
  return branch;
}

function upsertParams({ branch, customerKey, status, alertSignature, userId, userName }) {
  return [assertBranchCode(branch), customerKey, status, alertSignature, userId || null, userName || ''];
}

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

  async function upsertStatus(payload) {
    const result = await pool.query(UPSERT_STATUS_SQL, upsertParams(payload));
    return result.rows[0];
  }

  /**
   * Ghi cung mot trang thai cho NHIEU co so vat ly trong DUNG MOT transaction:
   * o pham vi "Cả hai", mot khach hang la mot dong da gop tu 2 co so nen
   * khong duoc phep ton tai trang thai ghi mot nua (HN da doi, SG chua).
   * Bat ky loi nao cung ROLLBACK toan bo.
   *
   * `targets` la mang `{ branch, alertSignature }` — MOI co so mang chu ky
   * canh bao cua chinh no (xem dashboardData.findDebtCustomerBranches); dung
   * chung mot chu ky cho ca hai co so se lam trang thai ket thuc cua co so
   * con lai bi coi la het hieu luc ngay lan doc sau.
   */
  async function upsertStatusForBranches({ targets, ...payload }) {
    const writes = (Array.isArray(targets) ? targets : []).map(target => ({
      branch: assertBranchCode(target?.branch),
      alertSignature: target?.alertSignature || payload.alertSignature
    }));
    if (!writes.length) throw new Error('Danh sách cơ sở cần ghi đang rỗng.');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const rows = [];
      for (const { branch, alertSignature } of writes) {
        const result = await client.query(UPSERT_STATUS_SQL, upsertParams({ ...payload, branch, alertSignature }));
        rows.push(result.rows[0]);
      }
      await client.query('COMMIT');
      return rows;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return { listByBranch, upsertStatus, upsertStatusForBranches };
}

const repository = createDebtCollectionStatusRepository();

module.exports = {
  BRANCH_CODES,
  createDebtCollectionStatusRepository,
  listByBranch: (...args) => repository.listByBranch(...args),
  upsertStatus: (...args) => repository.upsertStatus(...args),
  upsertStatusForBranches: (...args) => repository.upsertStatusForBranches(...args)
};
