'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withTestPool } = require('../../db/testPool');
const { getProductsSection } = require('./productQueries');

async function insertProduct(pool, branchId, { code, name, categoryId = null, isActive = true }) {
  const { rows } = await pool.query(
    `INSERT INTO products (branch_id, category_id, product_code, name, is_active)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [branchId, categoryId, code, name, isActive]
  );
  return rows[0].id;
}

async function insertInventory(pool, productId, { kiotvietBranchId = 0, onHand, cost }) {
  await pool.query(
    `INSERT INTO product_inventory (product_id, kiotviet_branch_id, on_hand, cost) VALUES ($1, $2, $3, $4)`,
    [productId, kiotvietBranchId, onHand, cost]
  );
}

test('getProductsSection: tong hop stock/status/lowStock voi statusFilter=all', async () => {
  await withTestPool('products_all', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    const catRoot = (await pool.query(`INSERT INTO categories (branch_id, name) VALUES ($1, 'Do gia dung') RETURNING id`, [branchId])).rows[0].id;

    const p1 = await insertProduct(pool, branchId, { code: 'SP001', name: 'Noi com', categoryId: catRoot, isActive: true });
    await insertInventory(pool, p1, { onHand: 10, cost: 50000 });

    const p2 = await insertProduct(pool, branchId, { code: 'SP002', name: 'Het hang', categoryId: catRoot, isActive: true });
    await insertInventory(pool, p2, { onHand: 0, cost: 20000 });

    const p3 = await insertProduct(pool, branchId, { code: 'SP003', name: 'Ngung KD', categoryId: catRoot, isActive: false });
    await insertInventory(pool, p3, { onHand: 5, cost: 10000 });

    const result = await getProductsSection(pool, branchId, 'all');
    assert.equal(result.totalProducts, 3);
    assert.equal(result.activeProducts, 2);
    assert.equal(result.inactiveProducts, 1);
    assert.equal(result.totalStock, 15);
    assert.equal(result.inStockCodes, 2);
    assert.equal(result.lowStock.length, 1);
    assert.equal(result.lowStock[0].code, 'SP002');

    const cat = result.stockByCategory.find((c) => c.name === 'Do gia dung');
    assert.equal(cat.stock, 15);
    assert.equal(cat.productCount, 3);
    assert.equal(cat.stockValue, 10 * 50000 + 0 * 20000 + 5 * 10000);
  });
});

test('getProductsSection: statusFilter=true chi lay san pham dang kinh doanh', async () => {
  await withTestPool('products_filter', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    const p1 = await insertProduct(pool, branchId, { code: 'A', name: 'Active', isActive: true });
    await insertInventory(pool, p1, { onHand: 3, cost: 1000 });
    const p2 = await insertProduct(pool, branchId, { code: 'B', name: 'Inactive', isActive: false });
    await insertInventory(pool, p2, { onHand: 3, cost: 1000 });

    const result = await getProductsSection(pool, branchId, true);
    assert.equal(result.totalProducts, 1);
    assert.equal(result.allProducts[0].code, 'A');
  });
});

test('getProductsSection: cong don ton kho tren nhieu dong kiotviet_branch_id cua cung 1 san pham', async () => {
  await withTestPool('products_multibranch', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    const p1 = await insertProduct(pool, branchId, { code: 'MULTI', name: 'Nhieu chi nhanh noi bo' });
    await insertInventory(pool, p1, { kiotvietBranchId: 1, onHand: 4, cost: 1000 });
    await insertInventory(pool, p1, { kiotvietBranchId: 2, onHand: 6, cost: 1000 });

    const result = await getProductsSection(pool, branchId, 'all');
    assert.equal(result.totalStock, 10);
    assert.equal(result.allProducts[0].stock, 10);
  });
});
