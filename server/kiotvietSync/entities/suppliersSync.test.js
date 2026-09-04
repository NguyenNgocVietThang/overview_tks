'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const config = require('../../config');
const { runMigrations } = require('../../db/migrate');
const { syncSuppliers } = require('./suppliersSync');

function makeSchemaName() {
  return 'test_suppliers_' + Math.random().toString(36).slice(2, 10);
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

test('syncSuppliers: upsert lan dau tao dong moi dung field mapping', async () => {
  await withTestPool(async (pool, branch) => {
    const client = fakeClient([[{
      id: 1883385,
      code: 'NCC000296',
      name: 'NCC A',
      contactNumber: '122222',
      address: 'Dia chi',
      isActive: true,
      debt: -21500000,
      totalInvoiced: 100,
      totalInvoicedWithoutReturn: 90,
      modifiedDate: '2026-08-29T12:54:03.6670000'
    }]]);

    const result = await syncSuppliers(pool, client, branch, null);
    assert.deepEqual(result, { fetched: 1, upserted: 1 });

    const row = (await pool.query('SELECT * FROM suppliers WHERE branch_id = $1', [branch.id])).rows[0];
    assert.equal(Number(row.kiotviet_id), 1883385);
    assert.equal(row.supplier_code, 'NCC000296');
    assert.equal(row.name, 'NCC A');
    assert.equal(row.is_active, true);
    assert.equal(Number(row.debt_amount), -21500000);
    assert.equal(Number(row.total_purchased), 100);
    assert.equal(Number(row.total_purchased_net_of_returns), 90);
  });
});

test('syncSuppliers: upsert lan 2 cung kiotviet_id -> update, khong tao dong trung', async () => {
  await withTestPool(async (pool, branch) => {
    await syncSuppliers(pool, fakeClient([[{ id: 1, code: 'NCC001', name: 'Ten cu' }]]), branch, null);
    await syncSuppliers(pool, fakeClient([[{ id: 1, code: 'NCC001', name: 'Ten moi' }]]), branch, null);

    const rows = (await pool.query('SELECT * FROM suppliers WHERE branch_id = $1 AND kiotviet_id = 1', [branch.id])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Ten moi');
  });
});

test('syncSuppliers: dong kiotviet_id=NULL tu truoc khong bi anh huong', async () => {
  await withTestPool(async (pool, branch) => {
    await pool.query(`INSERT INTO suppliers (branch_id, supplier_code, name, kiotviet_id) VALUES ($1, 'NCC-MANUAL', 'Nhap tay', NULL)`, [branch.id]);
    await syncSuppliers(pool, fakeClient([[{ id: 1, code: 'NCC001', name: 'Tu KiotViet' }]]), branch, null);

    const rows = (await pool.query('SELECT supplier_code FROM suppliers WHERE branch_id = $1', [branch.id])).rows;
    assert.deepEqual(rows.map((r) => r.supplier_code).sort(), ['NCC-MANUAL', 'NCC001'].sort());
  });
});

test('syncSuppliers: loi giua chung thi rejects va giu nguyen du lieu trang truoc', async () => {
  await withTestPool(async (pool, branch) => {
    const client = fakeClient([[{ id: 1, code: 'NCC001', name: 'Trang 1' }], new Error('KiotViet 503')]);
    await assert.rejects(() => syncSuppliers(pool, client, branch, null), /KiotViet 503/);
    const rows = (await pool.query('SELECT * FROM suppliers WHERE branch_id = $1', [branch.id])).rows;
    assert.equal(rows.length, 1);
  });
});
