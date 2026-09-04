'use strict';

// dashboardData.js:1991-2009: doc "No can tra" -> suppliers.debt_amount.
async function getSuppliersList(pool, branchId) {
  const { rows } = await pool.query(
    `SELECT supplier_code AS code, name, contact_number AS phone, address, debt_amount AS debt
     FROM suppliers
     WHERE branch_id = $1
     ORDER BY debt_amount DESC`,
    [branchId]
  );
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    phone: r.phone,
    email: '',
    address: r.address,
    debt: Number(r.debt)
  }));
}

// dashboardData.js:2023-2047: dem/tong TOAN BO phieu nhap, KHONG loc theo
// khoang thoi gian (khac voi getNewPurchases ben duoi).
async function getPurchasesSummaryAllTime(pool, branchId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0) AS total
     FROM purchases
     WHERE branch_id = $1`,
    [branchId]
  );
  return {
    purchaseOrdersCount: Number(rows[0].cnt),
    totalPurchaseSpend: Number(rows[0].total)
  };
}

// dashboardData.js:2056-2075: phieu nhap trong khoang loc rieng, gom theo ten NCC.
async function getNewPurchases(pool, branchId, range, supplierLimit, orderLimit) {
  const { rows } = await pool.query(
    `SELECT purchase_code AS code, purchase_date, supplier_name_snapshot AS supplier, total_amount AS total
     FROM purchases
     WHERE branch_id = $1
       AND ($2::timestamptz IS NULL OR purchase_date >= $2)
       AND ($3::timestamptz IS NULL OR purchase_date <= $3)
     ORDER BY purchase_date DESC`,
    [branchId, range.from, range.to]
  );

  const orders = rows.map((r) => ({
    code: r.code,
    date: r.purchase_date.toISOString(),
    supplier: r.supplier || '(Không xác định)',
    total: Number(r.total)
  }));

  const bySupplierMap = new Map();
  orders.forEach((o) => {
    if (!bySupplierMap.has(o.supplier)) {
      bySupplierMap.set(o.supplier, { name: o.supplier, orderCount: 0, total: 0 });
    }
    const entry = bySupplierMap.get(o.supplier);
    entry.orderCount += 1;
    entry.total += o.total;
  });
  const bySupplier = Array.from(bySupplierMap.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, supplierLimit);

  return {
    orderCount: orders.length,
    totalAmount: orders.reduce((sum, o) => sum + o.total, 0),
    supplierCount: bySupplierMap.size,
    bySupplier,
    orders: orders.slice(0, orderLimit)
  };
}

module.exports = { getSuppliersList, getPurchasesSummaryAllTime, getNewPurchases };
