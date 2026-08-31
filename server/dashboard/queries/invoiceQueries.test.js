'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withTestPool } = require('../../db/testPool');
const { getOrdersSummary, getReturnsSummary } = require('./invoiceQueries');

async function insertOrder(pool, branchId, { code, dateIso, total, status, customer = 'Khach le' }) {
  await pool.query(
    `INSERT INTO orders (branch_id, order_code, order_date, total_amount, status, customer_name_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [branchId, code, dateIso, total, status, customer]
  );
}

async function insertReturn(pool, branchId, { code, dateIso, total, status, customer = 'Khach le' }) {
  await pool.query(
    `INSERT INTO returns (branch_id, return_code, return_date, return_total, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [branchId, code, dateIso, total, status]
  );
}

test('getOrdersSummary: pending = Phieu tam(1)/Dang xu ly(2)/Da xac nhan(3), khong tinh Da huy(4)/Hoan thanh(5)', async () => {
  await withTestPool('invoices_orders', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    await insertOrder(pool, branchId, { code: 'DH1', dateIso: '2026-08-10T03:00:00Z', total: '100000', status: 1 });
    await insertOrder(pool, branchId, { code: 'DH2', dateIso: '2026-08-11T03:00:00Z', total: '50000', status: 3 });
    await insertOrder(pool, branchId, { code: 'DH3', dateIso: '2026-08-12T03:00:00Z', total: '999', status: 5 });
    await insertOrder(pool, branchId, { code: 'DH4', dateIso: '2026-08-13T03:00:00Z', total: '999', status: 4 });

    const range = { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59Z') };
    const result = await getOrdersSummary(pool, branchId, range, 8);
    assert.equal(result.pendingCount, 2);
    assert.equal(result.pendingTotal, 150000);
    assert.equal(result.recent.length, 4);
    assert.equal(result.recent[0].code, 'DH4');
  });
});

test('getReturnsSummary: dem va tong return_total trong khoang, sap xep gan nhat truoc', async () => {
  await withTestPool('invoices_returns', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    await insertReturn(pool, branchId, { code: 'TH1', dateIso: '2026-08-10T03:00:00Z', total: '20000', status: 1 });
    await insertReturn(pool, branchId, { code: 'TH2', dateIso: '2026-08-15T03:00:00Z', total: '30000', status: 2 });
    await insertReturn(pool, branchId, { code: 'OLD', dateIso: '2026-07-01T03:00:00Z', total: '999999', status: 1 });

    const range = { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59Z') };
    const result = await getReturnsSummary(pool, branchId, range, 8);
    assert.equal(result.count, 2);
    assert.equal(result.total, 50000);
    assert.equal(result.recent[0].code, 'TH2');
    assert.equal(result.recent.length, 2);
  });
});
