'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const config = require('../../config');
const { runMigrations } = require('../../db/migrate');
const { syncOrders } = require('./ordersSync');

function makeSchemaName() {
  return 'test_orders_' + Math.random().toString(36).slice(2, 10);
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

function sampleOrder(overrides = {}) {
  return {
    id: 21126274,
    code: 'DH034717',
    purchaseDate: '2026-08-30T09:00:00.0000000',
    customerId: 31770180,
    customerCode: 'KH008574',
    customerName: 'KH C',
    soldById: 1494955,
    soldByName: 'Pham Thi Phuong Anh',
    branchId: 1325349,
    total: 3150000,
    totalPayment: 0,
    discount: 0,
    status: 1,
    usingCod: false,
    modifiedDate: '2026-08-30T09:00:00.0000000',
    ...overrides
  };
}

test('syncOrders: upsert lan dau tao dong moi dung field mapping, suy ra nhan vien tu SoldById', async () => {
  await withTestPool(async (pool, branch) => {
    const result = await syncOrders(pool, fakeClient([[sampleOrder()]]), branch, null);
    assert.deepEqual(result, { fetched: 1, upserted: 1 });

    const order = (await pool.query('SELECT * FROM orders WHERE branch_id = $1', [branch.id])).rows[0];
    assert.equal(Number(order.kiotviet_id), 21126274);
    assert.equal(order.order_code, 'DH034717');
    assert.equal(Number(order.total_amount), 3150000);

    const staff = (await pool.query('SELECT * FROM staff WHERE branch_id = $1 AND kiotviet_id = 1494955', [branch.id])).rows[0];
    assert.ok(staff);
    assert.equal(order.created_by_staff_id, staff.id);
  });
});

test('syncOrders: upsert lan 2 cung kiotviet_id -> update, khong tao dong trung', async () => {
  await withTestPool(async (pool, branch) => {
    await syncOrders(pool, fakeClient([[sampleOrder({ total: 1000 })]]), branch, null);
    await syncOrders(pool, fakeClient([[sampleOrder({ total: 2000 })]]), branch, null);

    const rows = (await pool.query('SELECT * FROM orders WHERE branch_id = $1 AND kiotviet_id = 21126274', [branch.id])).rows;
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].total_amount), 2000);
  });
});

test('syncOrders: gui lastModifiedFrom (khong phai fromOrderDate) khi co sinceIso', async () => {
  await withTestPool(async (pool, branch) => {
    let capturedQuery = null;
    const client = { async fetchAllPages(endpoint, query, onPage) { capturedQuery = query; await onPage([], {}); } };
    await syncOrders(pool, client, branch, '2026-08-01T00:00:00');
    assert.equal(capturedQuery.lastModifiedFrom, '2026-08-01T00:00:00');
    assert.equal(capturedQuery.fromOrderDate, undefined, 'fromOrderDate bi API bo qua theo live probe, khong dung tham so nay');
  });
});

test('syncOrders: loi giua chung thi rejects va giu nguyen du lieu trang truoc', async () => {
  await withTestPool(async (pool, branch) => {
    const client = fakeClient([[sampleOrder()], new Error('KiotViet 500')]);
    await assert.rejects(() => syncOrders(pool, client, branch, null), /KiotViet 500/);
    const rows = (await pool.query('SELECT * FROM orders WHERE branch_id = $1', [branch.id])).rows;
    assert.equal(rows.length, 1);
  });
});
