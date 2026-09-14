'use strict';

const express = require('express');
const CONFIG = require('../config');
const { getPool } = require('../db/pool');

// Allowlist CO DINH cac bang nghiep vu (bang cha, khong tinh *_details/*_payments)
// dung cho counts/samples. KHONG BAO GIO duoc thay bang ten lay tu request -
// day la danh sach hard-code duy nhat duoc phep dua vao cau SQL nhu 1 dinh danh.
const BUSINESS_TABLES = Object.freeze([
  { table: 'categories', orderColumn: 'modified_date' },
  { table: 'products', orderColumn: 'modified_date' },
  { table: 'customers', orderColumn: 'modified_date' },
  { table: 'suppliers', orderColumn: 'modified_date' },
  { table: 'staff', orderColumn: 'last_seen_at' },
  { table: 'invoices', orderColumn: 'modified_date' },
  { table: 'orders', orderColumn: 'modified_date' },
  { table: 'returns', orderColumn: 'modified_date' },
  { table: 'purchases', orderColumn: 'modified_date' },
  { table: 'cash_flows', orderColumn: 'synced_at' }
]);

const BRANCHES = Object.freeze(['hanoi', 'saigon']);

// Cot khong tra ve trong samples: `raw` (toan bo payload JSONB - qua nhieu du
// lieu khong can thiet cho doi chieu thu cong) va `phone` (du lieu ca nhan
// khach hang/nha cung cap - route nay dung de debug bang mat, khong can SDT).
const SAMPLE_EXCLUDED_COLUMNS = Object.freeze(['raw', 'phone']);

function stripExcludedColumns(row) {
  const copy = { ...row };
  for (const column of SAMPLE_EXCLUDED_COLUMNS) delete copy[column];
  return copy;
}

async function loadCounts(pool) {
  const counts = {};
  for (const { table } of BUSINESS_TABLES) {
    const result = await pool.query(`SELECT branch, COUNT(*)::int AS count FROM ${table} GROUP BY branch`);
    const byBranch = { hanoi: 0, saigon: 0 };
    for (const row of result.rows) byBranch[row.branch] = row.count;
    counts[table] = byBranch;
  }
  return counts;
}

async function loadSamples(pool) {
  const samples = {};
  for (const { table, orderColumn } of BUSINESS_TABLES) {
    const byBranch = {};
    for (const branch of BRANCHES) {
      const result = await pool.query(
        `SELECT * FROM ${table} WHERE branch = $1 ORDER BY ${orderColumn} DESC NULLS LAST LIMIT 3`,
        [branch]
      );
      byBranch[branch] = result.rows.map(stripExcludedColumns);
    }
    samples[table] = byBranch;
  }
  return samples;
}

async function loadBackfillProgress(pool) {
  try {
    const result = await pool.query(
      'SELECT branch, entity, status, COUNT(*)::int AS count FROM backfill_progress GROUP BY branch, entity, status'
    );
    const progress = {};
    for (const row of result.rows) {
      progress[row.branch] = progress[row.branch] || {};
      progress[row.branch][row.entity] = progress[row.branch][row.entity] || { pending: 0, running: 0, done: 0, error: 0 };
      progress[row.branch][row.entity][row.status] = row.count;
    }
    return progress;
  } catch (error) {
    if (error.code === '42P01') return null; // bang backfill_progress chua ton tai (Giai doan 3 chua chay o moi truong nay)
    throw error;
  }
}

function createKiotVietSyncStatusRouter({ databaseUrl = CONFIG.SUPABASE_DB_URL, pool = getPool(), logger = console } = {}) {
  const router = express.Router();
  router.get('/api/internal/kiotviet-sync/status', async (_req, res) => {
    if (!databaseUrl) {
      return res.status(503).json({
        error: 'SUPABASE_DB_URL chưa được cấu hình.',
        code: 'SUPABASE_DB_NOT_CONFIGURED'
      });
    }
    try {
      const checkpointsResult = await pool.query(
        `SELECT branch, entity, last_synced_at, last_success_at, note
         FROM sync_checkpoints ORDER BY branch, entity`
      );
      const [counts, samples, backfillProgress] = await Promise.all([
        loadCounts(pool),
        loadSamples(pool),
        loadBackfillProgress(pool)
      ]);
      return res.status(200).json({
        checkpoints: checkpointsResult.rows,
        counts,
        samples,
        backfillProgress
      });
    } catch (error) {
      logger.error(`[KiotViet Sync] Không đọc được trạng thái: ${error.message}`);
      return res.status(503).json({
        error: 'Không đọc được trạng thái đồng bộ KiotViet.',
        code: 'KIOTVIET_SYNC_STATUS_UNAVAILABLE'
      });
    }
  });
  return router;
}

const router = createKiotVietSyncStatusRouter();
module.exports = router;
module.exports.createKiotVietSyncStatusRouter = createKiotVietSyncStatusRouter;
