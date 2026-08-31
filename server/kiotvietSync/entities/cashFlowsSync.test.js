'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const config = require('../../config');
const { runMigrations } = require('../../db/migrate');
const { syncCashFlows } = require('./cashFlowsSync');

function makeSchemaName() {
  return 'test_cashflows_' + Math.random().toString(36).slice(2, 10);
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

// Mo phong that API that: response KHONG co field isReceipt -- gia tri nay
// chi suy ra tu QUERY da goi (query.isReceipt), giong hanh vi da xac nhan
// qua CustomerDebtReport.gs va live probe (xem kiotviet/API_ENDPOINTS.md).
function fakeClientByReceiptFlag(receiptItems, expenseItems) {
  return {
    async fetchAllPages(endpoint, query, onPage) {
      const items = query.isReceipt === 'true' ? receiptItems : expenseItems;
      await onPage(items, {});
    }
  };
}

function sampleReceipt(overrides = {}) {
  return {
    id: 203136344,
    code: 'TT026228',
    transDate: '2026-08-30T11:27:00.0000000',
    amount: 51000000,
    partnerType: 'C',
    partnerId: 28847656,
    partnerName: 'KH C',
    contactNumber: '0363165072',
    status: 0,
    userId: 1494929,
    user: 'Pham Thi Hanh',
    ...overrides
  };
}

test('syncCashFlows: goi ca 2 lan isReceipt=true/false va gop ket qua, dat dung cot is_receipt', async () => {
  await withTestPool(async (pool, branch) => {
    const client = fakeClientByReceiptFlag(
      [sampleReceipt({ id: 1, code: 'TT001' })],
      [sampleReceipt({ id: 2, code: 'PC001', amount: 20000 })]
    );

    const result = await syncCashFlows(pool, client, branch, null);
    assert.deepEqual(result, { fetched: 2, upserted: 2 });

    const receipt = (await pool.query('SELECT * FROM cash_flows WHERE kiotviet_id = 1')).rows[0];
    const expense = (await pool.query('SELECT * FROM cash_flows WHERE kiotviet_id = 2')).rows[0];
    assert.equal(receipt.is_receipt, true);
    assert.equal(expense.is_receipt, false);
  });
});

test('syncCashFlows: resolve customer_id khi partnerType=C va khach hang da ton tai', async () => {
  await withTestPool(async (pool, branch) => {
    const customer = await pool.query(
      `INSERT INTO customers (branch_id, kiotviet_id, customer_code, name) VALUES ($1, 28847656, 'KH1', 'KH C') RETURNING id`,
      [branch.id]
    );
    await syncCashFlows(pool, fakeClientByReceiptFlag([sampleReceipt()], []), branch, null);
    const row = (await pool.query('SELECT customer_id, supplier_id FROM cash_flows WHERE branch_id = $1', [branch.id])).rows[0];
    assert.equal(row.customer_id, customer.rows[0].id);
    assert.equal(row.supplier_id, null);
  });
});

test('syncCashFlows: resolve supplier_id khi partnerType=S va nha cung cap da ton tai', async () => {
  await withTestPool(async (pool, branch) => {
    const supplier = await pool.query(
      `INSERT INTO suppliers (branch_id, kiotviet_id, supplier_code, name) VALUES ($1, 999, 'NCC1', 'NCC A') RETURNING id`,
      [branch.id]
    );
    const client = fakeClientByReceiptFlag([], [sampleReceipt({ partnerType: 'S', partnerId: 999 })]);
    await syncCashFlows(pool, client, branch, null);
    const row = (await pool.query('SELECT customer_id, supplier_id FROM cash_flows WHERE branch_id = $1', [branch.id])).rows[0];
    assert.equal(row.supplier_id, supplier.rows[0].id);
    assert.equal(row.customer_id, null);
  });
});

test('syncCashFlows: upsert lan 2 cung kiotviet_id -> update, khong tao dong trung', async () => {
  await withTestPool(async (pool, branch) => {
    await syncCashFlows(pool, fakeClientByReceiptFlag([sampleReceipt({ amount: 100 })], []), branch, null);
    await syncCashFlows(pool, fakeClientByReceiptFlag([sampleReceipt({ amount: 200 })], []), branch, null);
    const rows = (await pool.query('SELECT * FROM cash_flows WHERE branch_id = $1 AND kiotviet_id = 203136344', [branch.id])).rows;
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].amount), 200);
  });
});

test('syncCashFlows: dung lastModifiedFrom KHONG hoat dong, dung startDate/endDate; gui dung isReceipt cho tung lan goi', async () => {
  await withTestPool(async (pool, branch) => {
    const queries = [];
    const client = {
      async fetchAllPages(endpoint, query, onPage) {
        queries.push(query);
        await onPage([], {});
      }
    };
    await syncCashFlows(pool, client, branch, '2026-08-01T00:00:00');
    assert.equal(queries.length, 2);
    assert.equal(queries[0].lastModifiedFrom, undefined, 'cashflow khong ho tro lastModifiedFrom theo live probe');
    assert.equal(queries[0].startDate, '2026-08-01T00:00:00');
    const receiptFlags = queries.map((q) => q.isReceipt).sort();
    assert.deepEqual(receiptFlags, ['false', 'true']);
  });
});

test('syncCashFlows: loi o lan goi isReceipt=false thi rejects va giu nguyen du lieu isReceipt=true da upsert', async () => {
  await withTestPool(async (pool, branch) => {
    const client = {
      async fetchAllPages(endpoint, query, onPage) {
        if (query.isReceipt === 'false') throw new Error('KiotViet 500');
        await onPage([sampleReceipt()], {});
      }
    };
    await assert.rejects(() => syncCashFlows(pool, client, branch, null), /KiotViet 500/);
    const rows = (await pool.query('SELECT * FROM cash_flows WHERE branch_id = $1', [branch.id])).rows;
    assert.equal(rows.length, 1);
  });
});
