'use strict';

// src-dashboard/kiotviet/SheetSchemas.gs:407-412 (kiotVietStatus_ fallback map):
// { 1: 'Phiếu tạm', 2: 'Đang xử lý', 3: 'Đã xác nhận', 4: 'Đã hủy', 5: 'Hoàn thành' }
const ORDER_STATUS = { DRAFT: 1, PROCESSING: 2, CONFIRMED: 3, CANCELLED: 4, COMPLETED: 5 };
// dashboardData.js:20 PENDING_ORDER_STATUSES = {'Phieu tam','Dang xu ly','Da xac nhan'}
const PENDING_ORDER_STATUSES = [ORDER_STATUS.DRAFT, ORDER_STATUS.PROCESSING, ORDER_STATUS.CONFIRMED];

// SheetSchemas.gs:437 returns: { 1: 'Hoàn thành', 2: 'Đã hủy' }
const RETURN_STATUS = { COMPLETED: 1, CANCELLED: 2 };

async function getOrdersSummary(pool, branchId, range, recentLimit) {
  const { rows: pendingRows } = await pool.query(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0) AS total
     FROM orders
     WHERE branch_id = $1 AND status = ANY($2::smallint[])
       AND ($3::timestamptz IS NULL OR order_date >= $3)
       AND ($4::timestamptz IS NULL OR order_date <= $4)`,
    [branchId, PENDING_ORDER_STATUSES, range.from, range.to]
  );

  const { rows: recentRows } = await pool.query(
    `SELECT order_code AS code, customer_name_snapshot AS customer, total_amount AS total, status, order_date
     FROM orders
     WHERE branch_id = $1
       AND ($2::timestamptz IS NULL OR order_date >= $2)
       AND ($3::timestamptz IS NULL OR order_date <= $3)
     ORDER BY order_date DESC
     LIMIT $4`,
    [branchId, range.from, range.to, recentLimit]
  );

  return {
    pendingCount: Number(pendingRows[0].cnt),
    pendingTotal: Number(pendingRows[0].total),
    recent: recentRows.map((r) => ({
      code: r.code,
      customer: r.customer,
      total: Number(r.total),
      status: r.status,
      time: r.order_date.toISOString()
    }))
  };
}

async function getReturnsSummary(pool, branchId, range, recentLimit) {
  const { rows: summaryRows } = await pool.query(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(return_total), 0) AS total
     FROM returns
     WHERE branch_id = $1
       AND ($2::timestamptz IS NULL OR return_date >= $2)
       AND ($3::timestamptz IS NULL OR return_date <= $3)`,
    [branchId, range.from, range.to]
  );

  const { rows: recentRows } = await pool.query(
    `SELECT return_code AS code, return_total AS total, status, return_date
     FROM returns
     WHERE branch_id = $1
       AND ($2::timestamptz IS NULL OR return_date >= $2)
       AND ($3::timestamptz IS NULL OR return_date <= $3)
     ORDER BY return_date DESC
     LIMIT $4`,
    [branchId, range.from, range.to, recentLimit]
  );

  return {
    count: Number(summaryRows[0].cnt),
    total: Number(summaryRows[0].total),
    recent: recentRows.map((r) => ({
      code: r.code,
      total: Number(r.total),
      status: r.status,
      time: r.return_date.toISOString()
    }))
  };
}

module.exports = { ORDER_STATUS, PENDING_ORDER_STATUSES, RETURN_STATUS, getOrdersSummary, getReturnsSummary };
