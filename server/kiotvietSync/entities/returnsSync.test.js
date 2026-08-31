'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const config = require('../../config');
const { runMigrations } = require('../../db/migrate');
const { syncReturns } = require('./returnsSync');

function makeSchemaName() {
  return 'test_returns_' + Math.random().toString(36).slice(2, 10);
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

function sampleReturn(overrides = {}) {
  return {
    id: 555,
    code: 'TH0001',
    returnDate: '2026-08-30T09:00:00.0000000',
    invoiceId: 217962948,
    customerId: 31770180,
    soldById: 1494955,
    soldByName: 'NV Ban',
    receivedById: 1600000,
    receivedByName: 'NV Nhan',
    returnTotal: 50000,
    returnDiscount: 0,
    returnFee: 0,
    totalPayment: 50000,
    status: 1,
    modifiedDate: '2026-08-30T09:00:00.0000000',
    ...overrides
  };
}

test('syncReturns: upsert lan dau tao dong moi, suy ra ca 2 vai tro nhan vien (ban/nhan)', async () => {
  await withTestPool(async (pool, branch) => {
    await pool.query(`INSERT INTO invoices (branch_id, kiotviet_id, invoice_code, purchase_date, total_amount) VALUES ($1, 217962948, 'HD001', now(), 1)`, [branch.id]);

    const result = await syncReturns(pool, fakeClient([[sampleReturn()]]), branch, null);
    assert.deepEqual(result, { fetched: 1, upserted: 1 });

    const row = (await pool.query('SELECT * FROM returns WHERE branch_id = $1', [branch.id])).rows[0];
    assert.equal(Number(row.kiotviet_id), 555);
    assert.equal(row.return_code, 'TH0001');
    assert.equal(Number(row.return_total), 50000);

    const soldByStaff = (await pool.query('SELECT id FROM staff WHERE branch_id = $1 AND kiotviet_id = 1494955', [branch.id])).rows[0];
    const receivedByStaff = (await pool.query('SELECT id FROM staff WHERE branch_id = $1 AND kiotviet_id = 1600000', [branch.id])).rows[0];
    assert.equal(row.sold_by_staff_id, soldByStaff.id);
    assert.equal(row.received_by_staff_id, receivedByStaff.id);
  });
});

test('syncReturns: original_invoice_id duoc resolve dung khi hoa don goc da ton tai', async () => {
  await withTestPool(async (pool, branch) => {
    const invoice = await pool.query(
      `INSERT INTO invoices (branch_id, kiotviet_id, invoice_code, purchase_date, total_amount) VALUES ($1, 217962948, 'HD001', now(), 1) RETURNING id`,
      [branch.id]
    );
    await syncReturns(pool, fakeClient([[sampleReturn()]]), branch, null);
    const row = (await pool.query('SELECT original_invoice_id FROM returns WHERE branch_id = $1', [branch.id])).rows[0];
    assert.equal(row.original_invoice_id, invoice.rows[0].id);
  });
});

test('syncReturns: upsert lan 2 cung kiotviet_id -> update, khong tao dong trung', async () => {
  await withTestPool(async (pool, branch) => {
    await syncReturns(pool, fakeClient([[sampleReturn({ returnTotal: 100 })]]), branch, null);
    await syncReturns(pool, fakeClient([[sampleReturn({ returnTotal: 200 })]]), branch, null);
    const rows = (await pool.query('SELECT * FROM returns WHERE branch_id = $1 AND kiotviet_id = 555', [branch.id])).rows;
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].return_total), 200);
  });
});

test('syncReturns: loi giua chung thi rejects va giu nguyen du lieu trang truoc', async () => {
  await withTestPool(async (pool, branch) => {
    const client = fakeClient([[sampleReturn()], new Error('KiotViet 500')]);
    await assert.rejects(() => syncReturns(pool, client, branch, null), /KiotViet 500/);
    const rows = (await pool.query('SELECT * FROM returns WHERE branch_id = $1', [branch.id])).rows;
    assert.equal(rows.length, 1);
  });
});
