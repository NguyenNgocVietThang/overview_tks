'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const config = require('../../config');
const { runMigrations } = require('../../db/migrate');
const { syncCustomers } = require('./customersSync');

function makeSchemaName() {
  return 'test_customers_' + Math.random().toString(36).slice(2, 10);
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

test('syncCustomers: upsert lan dau tao dong moi dung field mapping', async () => {
  await withTestPool(async (pool, branch) => {
    const client = fakeClient([[{
      id: 28846898,
      code: 'KH000216',
      name: 'Khach A',
      contactNumber: '0929331991',
      address: 'Dia chi A',
      groups: 'Nhom X',
      debt: 433485050,
      totalInvoiced: 1000,
      totalRevenue: 2000,
      modifiedDate: '2026-08-30T10:00:00.0000000'
    }]]);

    const result = await syncCustomers(pool, client, branch, null);
    assert.deepEqual(result, { fetched: 1, upserted: 1 });

    const row = (await pool.query('SELECT * FROM customers WHERE branch_id = $1', [branch.id])).rows[0];
    assert.equal(Number(row.kiotviet_id), 28846898);
    assert.equal(row.customer_code, 'KH000216');
    assert.equal(row.name, 'Khach A');
    assert.equal(row.contact_number, '0929331991');
    assert.equal(row.customer_group_names, 'Nhom X');
    assert.equal(Number(row.debt_amount), 433485050);
    assert.equal(Number(row.total_invoiced), 1000);
    assert.equal(Number(row.total_revenue), 2000);
  });
});

test('syncCustomers: upsert lan 2 cung kiotviet_id -> update, khong tao dong trung', async () => {
  await withTestPool(async (pool, branch) => {
    const clientV1 = fakeClient([[{ id: 1, code: 'KH001', name: 'Ten cu', debt: 0 }]]);
    await syncCustomers(pool, clientV1, branch, null);
    const clientV2 = fakeClient([[{ id: 1, code: 'KH001', name: 'Ten moi', debt: 5000 }]]);
    await syncCustomers(pool, clientV2, branch, null);

    const rows = (await pool.query('SELECT * FROM customers WHERE branch_id = $1 AND kiotviet_id = 1', [branch.id])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Ten moi');
    assert.equal(Number(rows[0].debt_amount), 5000);
  });
});

test('syncCustomers: dong kiotviet_id=NULL tu truoc khong bi anh huong', async () => {
  await withTestPool(async (pool, branch) => {
    await pool.query(`INSERT INTO customers (branch_id, customer_code, name, kiotviet_id) VALUES ($1, 'KH-MANUAL', 'Nhap tay', NULL)`, [branch.id]);
    const client = fakeClient([[{ id: 1, code: 'KH001', name: 'Tu KiotViet' }]]);
    await syncCustomers(pool, client, branch, null);

    const rows = (await pool.query('SELECT customer_code FROM customers WHERE branch_id = $1', [branch.id])).rows;
    assert.deepEqual(rows.map((r) => r.customer_code).sort(), ['KH-MANUAL', 'KH001'].sort());
  });
});

test('syncCustomers: loi giua chung thi rejects va giu nguyen du lieu trang truoc', async () => {
  await withTestPool(async (pool, branch) => {
    const client = fakeClient([
      [{ id: 1, code: 'KH001', name: 'Trang 1' }],
      new Error('KiotViet timeout')
    ]);
    await assert.rejects(() => syncCustomers(pool, client, branch, null), /KiotViet timeout/);
    const rows = (await pool.query('SELECT * FROM customers WHERE branch_id = $1', [branch.id])).rows;
    assert.equal(rows.length, 1);
  });
});
