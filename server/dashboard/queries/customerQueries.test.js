'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withTestPool } = require('../../db/testPool');
const {
  getTopCustomersByRevenue,
  searchTopCustomersByProducts,
  getCustomerProductRevenueReport,
  getCustomerDebtSummary
} = require('./customerQueries');

async function insertCustomer(pool, branchId, { code, name }) {
  const { rows } = await pool.query(
    `INSERT INTO customers (branch_id, customer_code, name) VALUES ($1, $2, $3) RETURNING id`,
    [branchId, code, name]
  );
  return rows[0].id;
}

async function insertInvoice(pool, branchId, { code, customerId, dateIso, totalAmount, status }) {
  const { rows } = await pool.query(
    `INSERT INTO invoices (branch_id, invoice_code, purchase_date, customer_id, total_amount, total_payment, status)
     VALUES ($1, $2, $3, $4, $5, $5, $6) RETURNING id`,
    [branchId, code, dateIso, customerId, totalAmount, status]
  );
  return rows[0].id;
}

async function setCustomerDebt(pool, customerId, debt) {
  await pool.query(`UPDATE customers SET debt_amount = $1 WHERE id = $2`, [debt, customerId]);
}

async function insertReturn(pool, branchId, { code, customerId, dateIso, total, status }) {
  await pool.query(
    `INSERT INTO returns (branch_id, return_code, return_date, customer_id, return_total, status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [branchId, code, dateIso, customerId, total, status]
  );
}

test('getTopCustomersByRevenue: hoa don hoan thanh(3) tru tra hang hoan thanh(1), sap xep giam dan, tach top15/top50', async () => {
  await withTestPool('customers_top', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    const c1 = await insertCustomer(pool, branchId, { code: 'KH001', name: 'Nguyen Van A' });
    const c2 = await insertCustomer(pool, branchId, { code: 'KH002', name: 'Tran Thi B' });

    await insertInvoice(pool, branchId, { code: 'HD1', customerId: c1, dateIso: '2026-08-10T03:00:00Z', totalAmount: '200000', status: 3 });
    await insertInvoice(pool, branchId, { code: 'HD2', customerId: c1, dateIso: '2026-08-11T03:00:00Z', totalAmount: '999', status: 2 }); // Da huy, khong tinh
    await insertReturn(pool, branchId, { code: 'TH1', customerId: c1, dateIso: '2026-08-12T03:00:00Z', total: '50000', status: 1 }); // hoan thanh -> tru

    await insertInvoice(pool, branchId, { code: 'HD3', customerId: c2, dateIso: '2026-08-10T03:00:00Z', totalAmount: '300000', status: 3 });

    const range = { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59Z') };
    const result = await getTopCustomersByRevenue(pool, branchId, range);
    assert.equal(result.top15.length, 2);
    assert.equal(result.top15[0].code, 'KH002');
    assert.equal(result.top15[0].revenue, 300000);
    assert.equal(result.top15[1].code, 'KH001');
    assert.equal(result.top15[1].revenue, 150000);
    assert.ok(result.top50.length <= 50);
  });
});

test('searchTopCustomersByProducts: gom theo ma san pham yeu cau, gioi han top 3 khach/san pham', async () => {
  await withTestPool('customers_searchtop', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    const c1 = await insertCustomer(pool, branchId, { code: 'KH001', name: 'A' });
    const c2 = await insertCustomer(pool, branchId, { code: 'KH002', name: 'B' });
    const inv1 = await insertInvoice(pool, branchId, { code: 'HD1', customerId: c1, dateIso: '2026-08-10T03:00:00Z', totalAmount: '100000', status: 3 });
    const inv2 = await insertInvoice(pool, branchId, { code: 'HD2', customerId: c2, dateIso: '2026-08-11T03:00:00Z', totalAmount: '50000', status: 3 });

    await pool.query(
      `INSERT INTO invoice_line_items (invoice_id, branch_id, line_no, product_code_snapshot, product_name_snapshot, quantity, price, line_amount)
       VALUES ($1, $3, 0, 'SP001', 'San pham A', 5, 20000, 100000), ($2, $3, 0, 'SP001', 'San pham A', 2, 25000, 50000)`,
      [inv1, inv2, branchId]
    );

    const range = { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59Z') };
    const result = await searchTopCustomersByProducts(pool, branchId, ['SP001'], range, 10);
    assert.equal(result.length, 2);
    assert.equal(result[0].productCode, 'SP001');
    assert.equal(result[0].customerCode, 'KH001');
    assert.equal(result[0].purchasedQuantity, 5);
    assert.equal(result[0].purchaseRevenue, 100000);
    assert.equal(result[1].customerCode, 'KH002');
  });
});

test('getCustomerProductRevenueReport: doanh thu 90 ngay theo tung san pham, chia bucket thang', async () => {
  await withTestPool('customers_productrevenue', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    const c1 = await insertCustomer(pool, branchId, { code: 'KH001', name: 'Nguyen Van A' });
    const now = new Date('2026-08-30T10:00:00Z');

    // 5 ngay truoc (thang 1)
    const inv1 = await insertInvoice(pool, branchId, { code: 'HD1', customerId: c1, dateIso: '2026-08-25T03:00:00Z', totalAmount: '100000', status: 3 });
    // 40 ngay truoc (thang 2)
    const inv2 = await insertInvoice(pool, branchId, { code: 'HD2', customerId: c1, dateIso: '2026-07-21T03:00:00Z', totalAmount: '50000', status: 3 });

    await pool.query(
      `INSERT INTO invoice_line_items (invoice_id, branch_id, line_no, product_code_snapshot, product_name_snapshot, quantity, price, line_amount)
       VALUES ($1, $3, 0, 'SP001', 'San pham A', 2, 50000, 100000), ($2, $3, 0, 'SP001', 'San pham A', 1, 50000, 50000)`,
      [inv1, inv2, branchId]
    );

    const result = await getCustomerProductRevenueReport(pool, branchId, 'KH001', now);
    assert.equal(result.customer.code, 'KH001');
    assert.equal(result.totalRevenue, 150000);
    assert.equal(result.totalQuantity, 3);
    assert.equal(result.products.length, 1);
    assert.equal(result.products[0].code, 'SP001');
    assert.equal(result.products[0].month1Revenue, 100000);
    assert.equal(result.products[0].month2Revenue, 50000);
    assert.equal(result.products[0].month3Revenue, 0);
  });
});

test('getCustomerDebtSummary: tong hop no + topDebt (chi khach co no>0 VA co hoa don hoan thanh trong ky)', async () => {
  await withTestPool('customers_debtsummary', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    const c1 = await insertCustomer(pool, branchId, { code: 'KH001', name: 'Co no + co mua trong ky' });
    await setCustomerDebt(pool, c1, 300000);
    await insertInvoice(pool, branchId, { code: 'HD1', customerId: c1, dateIso: '2026-08-10T03:00:00Z', totalAmount: '50000', status: 3 });

    const c2 = await insertCustomer(pool, branchId, { code: 'KH002', name: 'Co no nhung KHONG mua trong ky' });
    await setCustomerDebt(pool, c2, 200000);

    const c3 = await insertCustomer(pool, branchId, { code: 'KH003', name: 'Khong no' });

    const range = { mode: 'days', from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59Z') };
    const result = await getCustomerDebtSummary(pool, branchId, range);

    assert.equal(result.totalCustomers, 3);
    assert.equal(result.customersWithDebt, 2);
    assert.equal(result.totalDebt, 500000);
    assert.equal(result.topDebt.length, 1);
    assert.equal(result.topDebt[0].code, 'KH001');
    assert.equal(result.topDebt[0].periodRevenue, 50000);
  });
});
