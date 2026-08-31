'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withTestPool } = require('../../db/testPool');
const { getSuppliersList, getPurchasesSummaryAllTime, getNewPurchases } = require('./supplierQueries');

async function insertSupplier(pool, branchId, { code, name, phone = null, address = null, debt = 0 }) {
  const { rows } = await pool.query(
    `INSERT INTO suppliers (branch_id, supplier_code, name, contact_number, address, debt_amount)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [branchId, code, name, phone, address, debt]
  );
  return rows[0].id;
}

async function insertPurchase(pool, branchId, { code, supplierId, dateIso, total, supplierName = 'NCC' }) {
  await pool.query(
    `INSERT INTO purchases (branch_id, purchase_code, purchase_date, supplier_id, supplier_name_snapshot, total_amount)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [branchId, code, dateIso, supplierId, supplierName, total]
  );
}

test('getSuppliersList: doc truc tiep debt_amount, sap xep giam dan theo no', async () => {
  await withTestPool('suppliers_list', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    await insertSupplier(pool, branchId, { code: 'NCC001', name: 'Cong ty A', debt: 5000000 });
    await insertSupplier(pool, branchId, { code: 'NCC002', name: 'Cong ty B', debt: 10000000 });

    const rows = await getSuppliersList(pool, branchId);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].code, 'NCC002');
    assert.equal(rows[0].debt, 10000000);
  });
});

test('getPurchasesSummaryAllTime: dem va tong tat ca phieu nhap, khong loc theo ngay', async () => {
  await withTestPool('suppliers_purchases_alltime', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    const s1 = await insertSupplier(pool, branchId, { code: 'NCC001', name: 'A' });
    await insertPurchase(pool, branchId, { code: 'PN1', supplierId: s1, dateIso: '2026-01-01T03:00:00Z', total: '1000000' });
    await insertPurchase(pool, branchId, { code: 'PN2', supplierId: s1, dateIso: '2026-08-01T03:00:00Z', total: '2000000' });

    const result = await getPurchasesSummaryAllTime(pool, branchId);
    assert.equal(result.purchaseOrdersCount, 2);
    assert.equal(result.totalPurchaseSpend, 3000000);
  });
});

test('getNewPurchases: loc theo khoang, gom theo ten NCC, gioi han bySupplier', async () => {
  await withTestPool('suppliers_new_purchases', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    const s1 = await insertSupplier(pool, branchId, { code: 'NCC001', name: 'A' });
    await insertPurchase(pool, branchId, { code: 'PN1', supplierId: s1, dateIso: '2026-08-10T03:00:00Z', total: '1000000', supplierName: 'Cong ty A' });
    await insertPurchase(pool, branchId, { code: 'PN2', supplierId: s1, dateIso: '2026-08-11T03:00:00Z', total: '500000', supplierName: 'Cong ty A' });
    await insertPurchase(pool, branchId, { code: 'OLD', supplierId: s1, dateIso: '2026-01-01T03:00:00Z', total: '999999', supplierName: 'Cong ty A' });

    const range = { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59Z') };
    const result = await getNewPurchases(pool, branchId, range, 10, 10);
    assert.equal(result.orderCount, 2);
    assert.equal(result.totalAmount, 1500000);
    assert.equal(result.supplierCount, 1);
    assert.equal(result.bySupplier[0].name, 'Cong ty A');
    assert.equal(result.bySupplier[0].total, 1500000);
    assert.equal(result.orders.length, 2);
  });
});
