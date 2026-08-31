'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withTestPool } = require('../db/testPool');
const {
  getDashboardData,
  getDashboardExportSnapshot,
  searchDashboardRecords,
  searchTopCustomersByProducts,
  getCustomerProductRevenueReport
} = require('./dashboardDataPg');

async function seedBasicData(pool, branchId) {
  const cust = (await pool.query(
    `INSERT INTO customers (branch_id, customer_code, name, debt_amount) VALUES ($1, 'KH001', 'Nguyen Van A', 100000) RETURNING id`,
    [branchId]
  )).rows[0].id;
  await pool.query(
    `INSERT INTO invoices (branch_id, invoice_code, purchase_date, customer_id, total_amount, total_payment, status)
     VALUES ($1, 'HD1', '2026-08-30T03:00:00Z', $2, 100000, 100000, 3)`,
    [branchId, cust]
  );
  await pool.query(`INSERT INTO products (branch_id, product_code, name) VALUES ($1, 'SP001', 'San pham A')`, [branchId]);
  await pool.query(`INSERT INTO suppliers (branch_id, supplier_code, name, debt_amount) VALUES ($1, 'NCC001', 'NCC A', 0)`, [branchId]);
  return cust;
}

test('getDashboardData: nhan branch dang ten Tieng Viet ("Ha Noi"), tra ve du cac khoa top-level chinh', async () => {
  await withTestPool('dashpg_shape', async (pool, branches) => {
    await seedBasicData(pool, branches.hanoi.id);
    const filters = {
      overview: { mode: 'days', days: 7 },
      products: { mode: 'days', days: 7, status: 'all' },
      invoices: { mode: 'days', days: 7 },
      customers: { mode: 'all' },
      newPurchases: { mode: 'days', days: 7 }
    };
    const data = await getDashboardData(filters, branches.hanoi.name, pool);

    assert.ok(data.kpi, 'phai co kpi');
    assert.ok(data.overview, 'phai co overview');
    assert.ok(data.invoices, 'phai co invoices');
    assert.ok(data.customers, 'phai co customers');
    assert.ok(Array.isArray(data.lowStock));
    assert.ok(Array.isArray(data.stockByCategory));
    assert.ok(Array.isArray(data.allProducts));
    assert.ok(Array.isArray(data.suppliers));
    assert.ok(data.newPurchases);
    assert.ok(data.debt && data.debt[1] && data.debt[3] && data.debt[7], 'debt phai co 3 ky 1/3/7');
    assert.equal(data.kpi.revenueToday, 100000);
  });
});

test('getDashboardData: 2 chi nhanh doc lap hoan toan (Ha Noi khong thay du lieu Sai Gon)', async () => {
  await withTestPool('dashpg_isolation', async (pool, branches) => {
    await seedBasicData(pool, branches.hanoi.id);
    await pool.query(
      `INSERT INTO customers (branch_id, customer_code, name) VALUES ($1, 'KH_SG', 'Khach Sai Gon')`,
      [branches.saigon.id]
    );

    const filters = { overview: {}, products: {}, invoices: {}, customers: { mode: 'all' }, newPurchases: {} };
    const hanoiData = await getDashboardData(filters, branches.hanoi.name, pool);
    const saigonData = await getDashboardData(filters, branches.saigon.name, pool);

    assert.equal(hanoiData.kpi.revenueToday, 100000);
    assert.equal(saigonData.kpi.revenueToday, 0);
  });
});

test('getDashboardExportSnapshot: tra ve wrapper { dashboard } dung cho exportService dung sau nay', async () => {
  await withTestPool('dashpg_export', async (pool, branches) => {
    await seedBasicData(pool, branches.hanoi.id);
    const filters = { overview: {}, products: {}, invoices: {}, customers: { mode: 'all' }, newPurchases: {} };
    const snapshot = await getDashboardExportSnapshot(filters, branches.hanoi.name, pool);
    assert.ok(snapshot.dashboard);
    assert.ok(snapshot.dashboard.kpi);
  });
});

test('searchDashboardRecords: che do codes tra dung shape requestedCount/matchedCount/missingCount', async () => {
  await withTestPool('dashpg_search', async (pool, branches) => {
    await seedBasicData(pool, branches.hanoi.id);
    const result = await searchDashboardRecords('products', 'SP001 SP999', 8, 'codes', undefined, branches.hanoi.name, pool);
    assert.equal(result.requestedCount, 2);
    assert.equal(result.matchedCount, 1);
    assert.equal(result.missingCount, 1);
  });
});

test('searchTopCustomersByProducts: uy quyen dung xuong queries/customerQueries', async () => {
  await withTestPool('dashpg_topbyproducts', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    const cust = await seedBasicData(pool, branchId);
    await pool.query(
      `INSERT INTO invoice_line_items (invoice_id, branch_id, line_no, product_code_snapshot, product_name_snapshot, quantity, price, line_amount)
       SELECT id, branch_id, 0, 'SP001', 'San pham A', 2, 50000, 100000 FROM invoices WHERE invoice_code = 'HD1'`
    );
    const result = await searchTopCustomersByProducts('SP001', { mode: 'days', days: 7 }, new Date('2026-08-30T10:00:00Z'), branches.hanoi.name, pool);
    assert.equal(result.total, 1);
    assert.equal(result.results[0].customerCode, 'KH001');
  });
});

test('getCustomerProductRevenueReport: uy quyen dung xuong queries/customerQueries', async () => {
  await withTestPool('dashpg_customerrevenue', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    await seedBasicData(pool, branchId);
    await pool.query(
      `INSERT INTO invoice_line_items (invoice_id, branch_id, line_no, product_code_snapshot, product_name_snapshot, quantity, price, line_amount)
       SELECT id, branch_id, 0, 'SP001', 'San pham A', 2, 50000, 100000 FROM invoices WHERE invoice_code = 'HD1'`
    );
    const result = await getCustomerProductRevenueReport('KH001', 'Nguyen Van A', branches.hanoi.name, new Date('2026-08-30T10:00:00Z'), pool);
    assert.equal(result.customer.code, 'KH001');
    assert.equal(result.totalRevenue, 100000);
  });
});
