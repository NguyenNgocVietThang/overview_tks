'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withTestPool } = require('../../db/testPool');
const {
  getRevenueToday,
  getRevenueByDay,
  getRecentInvoices,
  getTopSellingProducts,
  getTopSellingParentCategories,
  getCancelledCount
} = require('./overviewQueries');

async function insertInvoice(pool, branchId, { code, purchaseDateIso, totalAmount, status, customer = 'Khach le' }) {
  const { rows } = await pool.query(
    `INSERT INTO invoices (branch_id, invoice_code, purchase_date, total_amount, total_payment, status, customer_name_snapshot)
     VALUES ($1, $2, $3, $4, $4, $5, $6) RETURNING id`,
    [branchId, code, purchaseDateIso, totalAmount, status, customer]
  );
  return rows[0].id;
}

test('getRevenueToday: chi tinh hoa don status=3 (Hoan thanh) trong ngay hom nay theo gio Viet Nam, dung total_amount', async () => {
  await withTestPool('overview_today', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    // 2026-08-30T10:00:00+07:00 => 03:00:00Z, van la ngay 2026-08-30 gio VN
    await insertInvoice(pool, branchId, { code: 'HD001', purchaseDateIso: '2026-08-30T03:00:00Z', totalAmount: '100000', status: 3 });
    await insertInvoice(pool, branchId, { code: 'HD002', purchaseDateIso: '2026-08-30T10:00:00Z', totalAmount: '50000', status: 3 });
    // Da huy trong ngay hom nay -> khong cong vao revenue, nhung tinh vao cancelledToday
    await insertInvoice(pool, branchId, { code: 'HD003', purchaseDateIso: '2026-08-30T05:00:00Z', totalAmount: '20000', status: 2 });
    // Phieu tam trong ngay -> khong tinh vao revenue lan cancelled
    await insertInvoice(pool, branchId, { code: 'HD004', purchaseDateIso: '2026-08-30T05:00:00Z', totalAmount: '20000', status: 1 });
    // Ngay khac (VN) -> khong tinh. 2026-08-29T10:00:00Z = 17:00 gio VN ngay 29, khong phai 30.
    await insertInvoice(pool, branchId, { code: 'HD005', purchaseDateIso: '2026-08-29T10:00:00Z', totalAmount: '999999', status: 3 });

    const result = await getRevenueToday(pool, branchId, '2026-08-30');
    assert.deepEqual(result, { revenueToday: 150000, invoicesToday: 2, cancelledToday: 1 });
  });
});

test('getRevenueByDay: gom nhom theo ngay VN, chi status=3, tong total_amount', async () => {
  await withTestPool('overview_byday', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    await insertInvoice(pool, branchId, { code: 'A1', purchaseDateIso: '2026-08-01T03:00:00Z', totalAmount: '10000', status: 3 });
    await insertInvoice(pool, branchId, { code: 'A2', purchaseDateIso: '2026-08-01T10:00:00Z', totalAmount: '5000', status: 3 });
    await insertInvoice(pool, branchId, { code: 'A3', purchaseDateIso: '2026-08-02T03:00:00Z', totalAmount: '7000', status: 3 });
    await insertInvoice(pool, branchId, { code: 'A4', purchaseDateIso: '2026-08-02T03:00:00Z', totalAmount: '999', status: 2 });

    const rows = await getRevenueByDay(pool, branchId, { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59Z') });
    assert.deepEqual(rows, [
      { date: '2026-08-01', revenue: 15000, count: 2 },
      { date: '2026-08-02', revenue: 7000, count: 1 }
    ]);
  });
});

test('getRecentInvoices: sap xep giam dan theo purchase_date, gioi han limit', async () => {
  await withTestPool('overview_recent', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    await insertInvoice(pool, branchId, { code: 'OLD', purchaseDateIso: '2026-08-01T03:00:00Z', totalAmount: '1000', status: 3, customer: 'A' });
    await insertInvoice(pool, branchId, { code: 'NEW', purchaseDateIso: '2026-08-05T03:00:00Z', totalAmount: '2000', status: 3, customer: 'B' });
    await insertInvoice(pool, branchId, { code: 'MID', purchaseDateIso: '2026-08-03T03:00:00Z', totalAmount: '1500', status: 2, customer: 'C' });

    const rows = await getRecentInvoices(pool, branchId, { from: null, to: null }, 2);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].code, 'NEW');
    assert.equal(rows[1].code, 'MID');
    assert.equal(rows[0].total, 2000);
    assert.equal(rows[1].status, 2);
  });
});

test('getCancelledCount: chi dem status=2 (Da huy) trong khoang, khong dem Phieu tam', async () => {
  await withTestPool('overview_cancelled', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    await insertInvoice(pool, branchId, { code: 'C1', purchaseDateIso: '2026-08-10T03:00:00Z', totalAmount: '1', status: 2 });
    await insertInvoice(pool, branchId, { code: 'C2', purchaseDateIso: '2026-08-11T03:00:00Z', totalAmount: '1', status: 2 });
    await insertInvoice(pool, branchId, { code: 'C3', purchaseDateIso: '2026-08-11T03:00:00Z', totalAmount: '1', status: 1 });
    await insertInvoice(pool, branchId, { code: 'C4', purchaseDateIso: '2026-08-11T03:00:00Z', totalAmount: '1', status: 3 });

    const count = await getCancelledCount(pool, branchId, { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59Z') });
    assert.equal(count, 2);
  });
});

test('getTopSellingProducts: tinh tu invoice_line_items, loai tru hoa don Da huy nhung GIU Phieu tam, sap xep theo revenue giam dan', async () => {
  await withTestPool('overview_topproducts', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    const completedId = await insertInvoice(pool, branchId, { code: 'P1', purchaseDateIso: '2026-08-10T03:00:00Z', totalAmount: '100000', status: 3 });
    const draftId = await insertInvoice(pool, branchId, { code: 'P2', purchaseDateIso: '2026-08-10T03:00:00Z', totalAmount: '50000', status: 1 });
    const cancelledId = await insertInvoice(pool, branchId, { code: 'P3', purchaseDateIso: '2026-08-10T03:00:00Z', totalAmount: '999999', status: 2 });

    await pool.query(
      `INSERT INTO invoice_line_items (invoice_id, branch_id, line_no, product_code_snapshot, product_name_snapshot, quantity, price, line_amount)
       VALUES
       ($1, $4, 0, 'SP001', 'San pham A', 2, 30000, 60000),
       ($2, $4, 0, 'SP001', 'San pham A', 1, 30000, 30000),
       ($3, $4, 0, 'SP999', 'San pham bi huy', 100, 9999, 999900)`,
      [completedId, draftId, cancelledId, branchId]
    );

    const rows = await getTopSellingProducts(pool, branchId, { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59Z') }, 10);
    assert.deepEqual(rows, [{ code: 'SP001', name: 'San pham A', qty: 3, revenue: 90000 }]);
  });
});

test('getTopSellingParentCategories: quy ve nhom cha goc (đi lên chuoi parent_category_id), gom doanh thu', async () => {
  await withTestPool('overview_topcats', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    const rootCat = (await pool.query(
      `INSERT INTO categories (branch_id, name) VALUES ($1, 'Do gia dung') RETURNING id`,
      [branchId]
    )).rows[0].id;
    const childCat = (await pool.query(
      `INSERT INTO categories (branch_id, name, parent_category_id) VALUES ($1, 'Noi nieu', $2) RETURNING id`,
      [branchId, rootCat]
    )).rows[0].id;
    const productId = (await pool.query(
      `INSERT INTO products (branch_id, category_id, product_code, name) VALUES ($1, $2, 'SP001', 'Noi com dien') RETURNING id`,
      [branchId, childCat]
    )).rows[0].id;

    const invoiceId = await insertInvoice(pool, branchId, { code: 'CAT1', purchaseDateIso: '2026-08-10T03:00:00Z', totalAmount: '80000', status: 3 });
    await pool.query(
      `INSERT INTO invoice_line_items (invoice_id, branch_id, line_no, product_id, product_code_snapshot, product_name_snapshot, quantity, price, line_amount)
       VALUES ($1, $2, 0, $3, 'SP001', 'Noi com dien', 2, 40000, 80000)`,
      [invoiceId, branchId, productId]
    );

    const rows = await getTopSellingParentCategories(pool, branchId, { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59Z') }, 10);
    assert.deepEqual(rows, [{ name: 'Do gia dung', qty: 2, revenue: 80000, productCount: 1 }]);
  });
});
