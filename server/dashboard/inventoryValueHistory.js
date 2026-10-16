'use strict';

// Doc bang inventory_value_snapshots (migration 0025) cho bieu do cot "Gia tri ton kho
// theo ngay" (tab Tong quan, muc 1 Xu huong). Bang do job
// server/kiotvietSync/inventoryValueSnapshot.js chup 1 lan/ngay luc 23:59 VN nen ngay
// chua co ban chup thi VANG MAT trong ket qua (khong bia so 0).
const { getPool } = require('../db/pool');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UNDEFINED_TABLE = '42P01';

function normalizeDate(value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !DATE_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    const error = new Error(`Ngày "${label}" không hợp lệ (định dạng YYYY-MM-DD).`);
    error.statusCode = 400;
    throw error;
  }
  return value;
}

/**
 * branchCodes: cac co so vat ly duoc xem ('hanoi' | 'saigon'). Tra ve
 * { rows: [{ date, hanoi?, saigon? }] } theo thu tu ngay tang dan, chi kem co so nam
 * trong branchCodes. from/to ('YYYY-MM-DD', gom ca 2 dau) bo trong = khong gioi han.
 * Migration chua ap (bang chua co) => rows rong de dashboard van hien thi.
 */
async function getInventoryValueHistory({ branchCodes, from, to, pool = getPool() } = {}) {
  const fromDate = normalizeDate(from, 'từ');
  const toDate = normalizeDate(to, 'đến');
  if (!Array.isArray(branchCodes) || !branchCodes.length) return { rows: [] };

  let result;
  try {
    result = await pool.query(
      `SELECT snapshot_date::text AS date, branch, stock_value
       FROM inventory_value_snapshots
       WHERE branch = ANY($1::text[])
         AND ($2::date IS NULL OR snapshot_date >= $2::date)
         AND ($3::date IS NULL OR snapshot_date <= $3::date)
       ORDER BY snapshot_date, branch`,
      [branchCodes, fromDate, toDate]
    );
  } catch (error) {
    if (error && error.code === UNDEFINED_TABLE) return { rows: [] };
    throw error;
  }

  const byDate = new Map();
  for (const row of result.rows) {
    if (!byDate.has(row.date)) byDate.set(row.date, { date: row.date });
    byDate.get(row.date)[row.branch] = Number(row.stock_value) || 0;
  }
  return { rows: Array.from(byDate.values()) };
}

module.exports = { getInventoryValueHistory };
