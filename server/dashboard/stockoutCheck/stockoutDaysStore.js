'use strict';

// ==========================================
// LUU KET QUA "DUT HANG 30 NGAY" VAO DB cho cot Dut HN / Dut SG cua Bao cao hang hoa.
//
// Ket qua quet truoc day chi nam trong bo nho job (jobManager). Sau moi luot quet 30 ngay cua MOT co so, ham
// nay ghi tong so ngay dut (totalStockoutDays) vao product_stockout_days (migration 0067):
//   - Quet chi tra cac ma CO dut; ma vang mat = 0 ngay => truoc het dat 0 cho CA BANG roi moi ghi de ma co dut.
//   - Chi dung vao cot cua co so vua quet (days_<co so>, <co so>_scanned_at); cot co so kia giu nguyen.
//   - Bump product_report_state.version (neu bang ton tai) de cache cua bo doc Bao cao hang hoa thay ngay.
// ==========================================

const { getPool } = require('../../db/pool');
const { branchLabelToCode } = require('../../branch/branches');

// Khoa advisory rieng cho viec ghi bang nay (20531055 la khoa lam moi tang dan Bao cao hang hoa, xem
// kiotvietSync/productReportIncremental.js). Hai luot quet chong nhau (vd HN va SG) se ghi tuan tu, khong
// cho nay de len cho kia giua chung.
const ADVISORY_LOCK_KEY = 20531056;

// Ten cot lay tu bang ma co so co dinh (khong noi chuoi tu nguoi dung) nen an toan de ghep vao SQL.
const COLUMNS_BY_BRANCH = Object.freeze({
  hanoi: { days: 'days_hanoi', scannedAt: 'hanoi_scanned_at' },
  saigon: { days: 'days_saigon', scannedAt: 'saigon_scanned_at' }
});

function resolveBranchCode(branch) {
  // Chap nhan ca nhan 'Hà Nội'/'Sài Gòn' lan ma 'hanoi'/'saigon'.
  const code = COLUMNS_BY_BRANCH[branch] ? branch : branchLabelToCode(branch);
  if (!COLUMNS_BY_BRANCH[code]) {
    const err = new Error(`Cơ sở không hợp lệ để lưu số ngày đứt hàng: ${branch}`);
    err.code = 'STOCKOUT_DAYS_INVALID_BRANCH';
    throw err;
  }
  return code;
}

/**
 * Gom dong quet thanh danh sach duy nhat theo product_key = lower(btrim(ma)).
 * Ma trung key (khong ky vong xay ra) lay so ngay LON NHAT — khong cong don de khong thoi phong.
 */
function normalizeRows(rows) {
  const byKey = new Map();
  for (const row of rows || []) {
    const code = String((row && row.code) == null ? '' : row.code).trim();
    if (!code) continue;
    const key = code.toLowerCase();
    const days = Math.max(0, Math.round(Number(row.totalStockoutDays)) || 0);
    const existing = byKey.get(key);
    if (existing) {
      existing.days = Math.max(existing.days, days);
    } else {
      byKey.set(key, { key, code, days });
    }
  }
  return Array.from(byKey.values());
}

/**
 * @param {Object} params
 * @param {Object} [params.pool] mac dinh getPool()
 * @param {string} params.branch 'Hà Nội' | 'Sài Gòn' (hoac ma 'hanoi' | 'saigon')
 * @param {{code: string, totalStockoutDays: number}[]} params.rows ket qua quet 30 ngay cua co so do
 * @returns {Promise<{branch: string, written: number}>}
 */
async function persistStockoutDays({ pool = getPool(), branch, rows }) {
  const branchCode = resolveBranchCode(branch);
  const { days: daysCol, scannedAt: scannedCol } = COLUMNS_BY_BRANCH[branchCode];
  const items = normalizeRows(rows);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_KEY]);

    // (a) Reset ca bang cho co so nay: ma het dut (vang trong ket qua) ve 0.
    await client.query(`UPDATE product_stockout_days SET ${daysCol} = 0, ${scannedCol} = now()`);

    // (b) Ghi de cac ma co dut. Chi cot cua co so vua quet.
    if (items.length > 0) {
      await client.query(
        `INSERT INTO product_stockout_days (product_key, product_code, ${daysCol}, ${scannedCol})
         SELECT u.product_key, u.product_code, u.days, now()
         FROM UNNEST($1::text[], $2::text[], $3::int[]) AS u(product_key, product_code, days)
         ON CONFLICT (product_key) DO UPDATE
           SET product_code = EXCLUDED.product_code,
               ${daysCol} = EXCLUDED.${daysCol},
               ${scannedCol} = EXCLUDED.${scannedCol}`,
        [items.map((i) => i.key), items.map((i) => i.code), items.map((i) => i.days)]
      );
    }

    // (c) Bao cho cache bo doc bao cao biet du lieu doi. Bang state co the chua ton tai (migration 0055
    // chua ap) -> kiem tra bang to_regclass thay vi bat loi (loi trong transaction se lam hong ca giao dich).
    const state = await client.query(`SELECT to_regclass('product_report_state') AS rel`);
    if (state.rows[0] && state.rows[0].rel) {
      await client.query('UPDATE product_report_state SET version = version + 1');
    }

    await client.query('COMMIT');
    return { branch: branchCode, written: items.length };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* giu loi goc */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { persistStockoutDays, ADVISORY_LOCK_KEY, __normalizeRows: normalizeRows };
