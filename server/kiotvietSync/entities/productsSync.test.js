'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const config = require('../../config');
const { runMigrations } = require('../../db/migrate');
const { syncProducts } = require('./productsSync');

function makeSchemaName() {
  return 'test_products_' + Math.random().toString(36).slice(2, 10);
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

function sampleProduct(overrides = {}) {
  return {
    id: 48039386,
    code: 'ADN3L',
    name: 'Am dun nuoc 3L',
    categoryId: 2510401,
    allowsSale: true,
    type: 2,
    hasVariants: false,
    basePrice: 100000,
    unit: 'Cai',
    conversionValue: 1,
    description: 'Mo ta',
    isActive: true,
    modifiedDate: '2026-08-30T10:00:00.0000000',
    inventories: [
      { productId: 48039386, branchId: 1325349, branchName: 'Chi nhanh trung tam', cost: 24500, onHand: 5, reserved: 0, minQuantity: 0, maxQuantity: 100 }
    ],
    ...overrides
  };
}

test('syncProducts: upsert lan dau tao dong moi + product_inventory + inventory_daily_snapshot', async () => {
  await withTestPool(async (pool, branch) => {
    const result = await syncProducts(pool, fakeClient([[sampleProduct()]]), branch, null);
    assert.deepEqual(result, { fetched: 1, upserted: 1 });

    const product = (await pool.query('SELECT * FROM products WHERE branch_id = $1', [branch.id])).rows[0];
    assert.equal(Number(product.kiotviet_id), 48039386);
    assert.equal(product.product_code, 'ADN3L');
    assert.equal(product.name, 'Am dun nuoc 3L');
    assert.equal(product.category_id, null, 'chua co category tuong ung trong bang categories thi category_id la null');
    assert.equal(Number(product.kiotviet_category_id), 2510401);
    assert.equal(Number(product.base_price), 100000);

    const inventory = (await pool.query('SELECT * FROM product_inventory WHERE product_id = $1', [product.id])).rows[0];
    assert.equal(Number(inventory.kiotviet_branch_id), 1325349);
    assert.equal(Number(inventory.on_hand), 5);

    const snapshot = (await pool.query('SELECT * FROM inventory_daily_snapshot WHERE product_id = $1', [product.id])).rows[0];
    assert.equal(Number(snapshot.on_hand), 5);
  });
});

test('syncProducts: category_id duoc resolve dung neu category da ton tai trong bang categories', async () => {
  await withTestPool(async (pool, branch) => {
    const category = await pool.query(
      `INSERT INTO categories (branch_id, kiotviet_id, name) VALUES ($1, 2510401, 'Nha bep') RETURNING id`,
      [branch.id]
    );
    await syncProducts(pool, fakeClient([[sampleProduct()]]), branch, null);
    const product = (await pool.query('SELECT category_id FROM products WHERE branch_id = $1', [branch.id])).rows[0];
    assert.equal(product.category_id, category.rows[0].id);
  });
});

test('syncProducts: upsert lan 2 cung kiotviet_id -> update, khong tao dong trung', async () => {
  await withTestPool(async (pool, branch) => {
    await syncProducts(pool, fakeClient([[sampleProduct({ name: 'Ten cu' })]]), branch, null);
    await syncProducts(pool, fakeClient([[sampleProduct({ name: 'Ten moi', basePrice: 200000 })]]), branch, null);

    const rows = (await pool.query('SELECT * FROM products WHERE branch_id = $1 AND kiotviet_id = 48039386', [branch.id])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Ten moi');
    assert.equal(Number(rows[0].base_price), 200000);
  });
});

test('syncProducts: product_inventory upsert truc tiep (khong xoa-chen-lai), Inventories[] rong khong xoa ton kho cu', async () => {
  await withTestPool(async (pool, branch) => {
    await syncProducts(pool, fakeClient([[sampleProduct()]]), branch, null);
    await syncProducts(pool, fakeClient([[sampleProduct({ inventories: [] })]]), branch, null);

    const product = (await pool.query('SELECT id FROM products WHERE branch_id = $1', [branch.id])).rows[0];
    const inventoryRows = (await pool.query('SELECT * FROM product_inventory WHERE product_id = $1', [product.id])).rows;
    assert.equal(inventoryRows.length, 1, 'ton kho cu phai duoc giu nguyen khi luot poll sau tra Inventories rong');
    assert.equal(Number(inventoryRows[0].on_hand), 5);
  });
});

test('syncProducts: 2 lan sync trong cung 1 ngay chi tao 1 dong inventory_daily_snapshot (DO NOTHING)', async () => {
  await withTestPool(async (pool, branch) => {
    await syncProducts(pool, fakeClient([[sampleProduct({ inventories: [{ productId: 48039386, branchId: 1325349, onHand: 5 }] })]]), branch, null);
    await syncProducts(pool, fakeClient([[sampleProduct({ inventories: [{ productId: 48039386, branchId: 1325349, onHand: 999 }] })]]), branch, null);

    const product = (await pool.query('SELECT id FROM products WHERE branch_id = $1', [branch.id])).rows[0];
    const snapshotRows = (await pool.query('SELECT * FROM inventory_daily_snapshot WHERE product_id = $1', [product.id])).rows;
    assert.equal(snapshotRows.length, 1);
    assert.equal(Number(snapshotRows[0].on_hand), 5, 'DO NOTHING nen giu gia tri cua lan dau tien trong ngay, khong ghi de');
  });
});

test('syncProducts: loi giua chung thi rejects va giu nguyen du lieu trang truoc', async () => {
  await withTestPool(async (pool, branch) => {
    const client = fakeClient([[sampleProduct()], new Error('KiotViet 500')]);
    await assert.rejects(() => syncProducts(pool, client, branch, null), /KiotViet 500/);
    const rows = (await pool.query('SELECT * FROM products WHERE branch_id = $1', [branch.id])).rows;
    assert.equal(rows.length, 1);
  });
});
