'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withTestPool } = require('../../db/testPool');
const { searchByCodes, searchByText } = require('./searchQueries');

test('searchByCodes: view=products, tra ve requestedCount/matchedCount/missingCount dung chuan searchDashboardRecords', async () => {
  await withTestPool('search_codes', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    await pool.query(`INSERT INTO products (branch_id, product_code, name) VALUES ($1, 'SP001', 'San pham A'), ($1, 'SP002', 'San pham B')`, [branchId]);

    const result = await searchByCodes(pool, branchId, 'products', ['SP001', 'SP999']);
    assert.equal(result.requestedCount, 2);
    assert.equal(result.matchedCount, 1);
    assert.equal(result.missingCount, 1);
    assert.equal(result.total, 1);
    assert.equal(result.results[0].code, 'SP001');
    assert.equal(result.results[0].source, 'products');
  });
});

test('searchByText: view=customers, tim theo prefix ma hoac ten, gioi han limit', async () => {
  await withTestPool('search_text', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    await pool.query(
      `INSERT INTO customers (branch_id, customer_code, name) VALUES ($1, 'KH001', 'Nguyen Van A'), ($1, 'KH002', 'Nguyen Thi B'), ($1, 'KH010', 'Tran Van C')`,
      [branchId]
    );

    const result = await searchByText(pool, branchId, 'customers', 'KH00', 10);
    assert.equal(result.total, 2);
    assert.ok(result.results.every((r) => r.code.startsWith('KH00')));
  });
});

test('searchByCodes: view khong hop le fallback ve overview scope (nhieu bang)', async () => {
  await withTestPool('search_overview', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    await pool.query(`INSERT INTO products (branch_id, product_code, name) VALUES ($1, 'SP001', 'San pham A')`, [branchId]);
    await pool.query(`INSERT INTO customers (branch_id, customer_code, name) VALUES ($1, 'KH001', 'Khach A')`, [branchId]);

    const result = await searchByCodes(pool, branchId, 'khong_ton_tai', ['SP001', 'KH001']);
    assert.equal(result.matchedCount, 2);
  });
});
