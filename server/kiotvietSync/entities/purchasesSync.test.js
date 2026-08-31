'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const config = require('../../config');
const { runMigrations } = require('../../db/migrate');
const { syncPurchases } = require('./purchasesSync');

function makeSchemaName() {
  return 'test_purchases_' + Math.random().toString(36).slice(2, 10);
}

async function withTestPool(fn) {
  const schemaName = makeSchemaName();
  const setupPool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 2,
    ssl: config.PGSSL ? { rejectUnauthorized: false } : false
  });
  await setupPool.query(`CREATE SCHEMA "${schemaName}"`);

  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 2,
    ssl: config.PGSSL ? { rejectUnauthorized: false } : false,
    options: `-c search_path="${schemaName}"`
  });

  try {
    const setupClient = await pool.connect();
    try {
      await runMigrations(setupClient);
    } finally {
      setupClient.release();
    }
    const hanoi = (await pool.query(`SELECT id, code FROM branches WHERE code = 'hanoi'`)).rows[0];
    await fn(pool, { id: hanoi.id, code: hanoi.code });
  } finally {
    await pool.end();
    await setupPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await setupPool.end();
  }
}

function fakeClient(pages) {
  return {
    async fetchAllPages(endpoint, query, onPage) {
      for (const page of pages) {
        if (page instanceof Error) throw page;
        await onPage(page, {});
      }
    }
  };
}

function samplePurchase(overrides = {}) {
  return {
    id: 14735192,
    code: 'PN000001',
    purchaseDate: '2026-02-05T13:39:09.8870000',
    branchId: 1325349,
    discount: 0,
    total: 300000,
    totalPayment: 100000,
    status: 4,
    supplierId: 1823528,
    supplierName: 'NCC A',
    supplierCode: 'NCC000002',
    purchaseById: 1494936,
    purchaseName: 'Nguyen Duc Thang',
    purchaseOrderDetails: [
      { productId: 48045199, productCode: 'KCMTO', productName: 'Kim cat', quantity: 3, price: 100000, discount: 0 }
    ],
    ...overrides
  };
}

test('syncPurchases: upsert lan dau tao header + line items dung field mapping', async () => {
  await withTestPool(async (pool, branch) => {
    const result = await syncPurchases(pool, fakeClient([[samplePurchase()]]), branch, null);
    assert.deepEqual(result, { fetched: 1, upserted: 1 });

    const purchase = (await pool.query('SELECT * FROM purchases WHERE branch_id = $1', [branch.id])).rows[0];
    assert.equal(Number(purchase.kiotviet_id), 14735192);
    assert.equal(purchase.purchase_code, 'PN000001');
    assert.equal(Number(purchase.total_amount), 300000);
    assert.equal(Number(purchase.paid_amount), 100000);
    assert.equal(purchase.supplier_id, null);
    assert.equal(purchase.supplier_code_snapshot, 'NCC000002');

    const staff = (await pool.query('SELECT * FROM staff WHERE branch_id = $1 AND kiotviet_id = 1494936', [branch.id])).rows[0];
    assert.ok(staff);
    assert.equal(purchase.created_by_staff_id, staff.id);

    const lines = (await pool.query('SELECT * FROM purchase_line_items WHERE purchase_id = $1 ORDER BY line_no', [purchase.id])).rows;
    assert.equal(lines.length, 1);
    assert.equal(lines[0].product_code_snapshot, 'KCMTO');
    assert.equal(Number(lines[0].quantity), 3);
    assert.equal(Number(lines[0].line_amount), 300000);
  });
});

test('syncPurchases: supplier_id duoc resolve dung khi supplier da ton tai', async () => {
  await withTestPool(async (pool, branch) => {
    const supplier = await pool.query(
      `INSERT INTO suppliers (branch_id, kiotviet_id, supplier_code, name) VALUES ($1, 1823528, 'NCC000002', 'NCC A') RETURNING id`,
      [branch.id]
    );
    await syncPurchases(pool, fakeClient([[samplePurchase()]]), branch, null);
    const purchase = (await pool.query('SELECT supplier_id FROM purchases WHERE branch_id = $1', [branch.id])).rows[0];
    assert.equal(purchase.supplier_id, supplier.rows[0].id);
  });
});

test('syncPurchases: phieu nhap sua doi line item -> xoa-chen-lai dung', async () => {
  await withTestPool(async (pool, branch) => {
    await syncPurchases(pool, fakeClient([[samplePurchase({
      purchaseOrderDetails: [
        { productId: 1, productCode: 'SP1', quantity: 1, price: 1000 },
        { productId: 2, productCode: 'SP2', quantity: 1, price: 2000 }
      ]
    })]]), branch, null);

    await syncPurchases(pool, fakeClient([[samplePurchase({
      purchaseOrderDetails: [{ productId: 1, productCode: 'SP1', quantity: 9, price: 1000 }]
    })]]), branch, null);

    const purchase = (await pool.query('SELECT id FROM purchases WHERE branch_id = $1', [branch.id])).rows[0];
    const lines = (await pool.query('SELECT * FROM purchase_line_items WHERE purchase_id = $1', [purchase.id])).rows;
    assert.equal(lines.length, 1);
    assert.equal(Number(lines[0].quantity), 9);
  });
});

test('syncPurchases: khong tao trung header khi sync lai cung kiotviet_id', async () => {
  await withTestPool(async (pool, branch) => {
    await syncPurchases(pool, fakeClient([[samplePurchase()]]), branch, null);
    await syncPurchases(pool, fakeClient([[samplePurchase({ total: 999 })]]), branch, null);
    const rows = (await pool.query('SELECT * FROM purchases WHERE branch_id = $1 AND kiotviet_id = 14735192', [branch.id])).rows;
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].total_amount), 999);
  });
});

test('syncPurchases: loi giua chung thi rejects, giu nguyen du lieu trang truoc', async () => {
  await withTestPool(async (pool, branch) => {
    const client = fakeClient([[samplePurchase()], new Error('KiotViet 500')]);
    await assert.rejects(() => syncPurchases(pool, client, branch, null), /KiotViet 500/);
    const rows = (await pool.query('SELECT * FROM purchases WHERE branch_id = $1', [branch.id])).rows;
    assert.equal(rows.length, 1);
  });
});
