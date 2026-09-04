'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const config = require('../config');
const { runMigrations } = require('../db/migrate');
const { generateMonthRanges, runBackfill } = require('./backfill');

function makeSchemaName() {
  return 'test_backfill_' + Math.random().toString(36).slice(2, 10);
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
    const hanoi = (await pool.query(`SELECT id, code, kiotviet_retailer FROM branches WHERE code = 'hanoi'`)).rows[0];
    await fn(pool, { id: hanoi.id, code: hanoi.code, kiotvietRetailer: hanoi.kiotviet_retailer });
  } finally {
    await pool.end();
    await setupPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await setupPool.end();
  }
}

test('generateMonthRanges: 1 thang duy nhat', () => {
  const months = generateMonthRanges('2026-03-01', '2026-03-31');
  assert.deepEqual(months.map((m) => m.monthKey), ['2026-03']);
  assert.equal(months[0].startQuery, '2026-03-01T00:00:00');
  assert.equal(months[0].endQuery, '2026-03-31T23:59:59');
});

test('generateMonthRanges: nhieu thang, vuot qua ranh gioi nam', () => {
  const months = generateMonthRanges('2026-11-15', '2027-02-01');
  assert.deepEqual(months.map((m) => m.monthKey), ['2026-11', '2026-12', '2027-01', '2027-02']);
});

test('generateMonthRanges: thang 2 nam thuong tinh dung 28 ngay', () => {
  const months = generateMonthRanges('2026-02-01', '2026-02-28');
  assert.equal(months[0].endQuery, '2026-02-28T23:59:59');
});

test('runBackfill: entity dang-lap (categories) chi chay 1 lan full, khong chia thang', async () => {
  await withTestPool(async (pool, branch) => {
    let callCount = 0;
    const client = {
      async fetchAllPages(endpoint, query, onPage) {
        if (endpoint === 'categories') {
          callCount++;
          assert.equal(query.lastModifiedFrom, undefined, 'dimension entity backfill khong loc theo ngay');
        }
        await onPage([], {});
      }
    };

    await runBackfill(pool, client, branch, { from: '2026-01-01', to: '2026-03-01' });
    assert.equal(callCount, 1);

    const log = await pool.query(
      `SELECT * FROM sync_run_log WHERE branch_id = $1 AND entity_name = 'categories:backfill'`,
      [branch.id]
    );
    assert.equal(log.rows.length, 1);
    assert.equal(log.rows[0].status, 'success');
  });
});

test('runBackfill: entity co filter ngay bi chan (invoices) duoc chia theo tung thang voi fromPurchaseDate/toPurchaseDate', async () => {
  await withTestPool(async (pool, branch) => {
    const invoiceCalls = [];
    const client = {
      async fetchAllPages(endpoint, query, onPage) {
        if (endpoint === 'invoices') invoiceCalls.push(query);
        await onPage([], {});
      }
    };

    await runBackfill(pool, client, branch, { from: '2026-01-01', to: '2026-02-15' });

    assert.equal(invoiceCalls.length, 2, 'thang 1 va thang 2 -> 2 lan goi rieng');
    assert.equal(invoiceCalls[0].fromPurchaseDate, '2026-01-01T00:00:00');
    assert.equal(invoiceCalls[0].toPurchaseDate, '2026-01-31T23:59:59');
    assert.equal(invoiceCalls[1].fromPurchaseDate, '2026-02-01T00:00:00');
    assert.equal(invoiceCalls[1].toPurchaseDate, '2026-02-15T23:59:59');

    const logs = await pool.query(
      `SELECT entity_name FROM sync_run_log WHERE branch_id = $1 AND entity_name LIKE 'invoices:backfill:%' ORDER BY entity_name`,
      [branch.id]
    );
    assert.deepEqual(logs.rows.map((r) => r.entity_name), ['invoices:backfill:2026-01', 'invoices:backfill:2026-02']);
  });
});

test('runBackfill: orders/returns (khong co filter ngay bi chan) chi chay 1 lan full voi lastModifiedFrom=--from', async () => {
  await withTestPool(async (pool, branch) => {
    const ordersCalls = [];
    const client = {
      async fetchAllPages(endpoint, query, onPage) {
        if (endpoint === 'orders') ordersCalls.push(query);
        await onPage([], {});
      }
    };

    await runBackfill(pool, client, branch, { from: '2026-01-01', to: '2026-03-01' });

    assert.equal(ordersCalls.length, 1, 'khong the chia thang vi API bo qua tham so chan tren, chi goi 1 lan');
    assert.equal(ordersCalls[0].lastModifiedFrom, '2026-01-01T00:00:00');

    const log = await pool.query(
      `SELECT * FROM sync_run_log WHERE branch_id = $1 AND entity_name = 'orders:backfill'`,
      [branch.id]
    );
    assert.equal(log.rows.length, 1);
  });
});

test('runBackfill: chay lai bo qua thang da thanh cong (resume), khong goi lai', async () => {
  await withTestPool(async (pool, branch) => {
    let invoiceCallCount = 0;
    const client = {
      async fetchAllPages(endpoint, query, onPage) {
        if (endpoint === 'invoices') invoiceCallCount++;
        await onPage([], {});
      }
    };

    await runBackfill(pool, client, branch, { from: '2026-01-01', to: '2026-02-15' });
    assert.equal(invoiceCallCount, 2);

    await runBackfill(pool, client, branch, { from: '2026-01-01', to: '2026-02-15' });
    assert.equal(invoiceCallCount, 2, 'lan chay thu 2 phai bo qua ca 2 thang da thanh cong, khong goi them');
  });
});

test('runBackfill: 1 thang loi khong chan cac thang khac tiep tuc chay', async () => {
  await withTestPool(async (pool, branch) => {
    const client = {
      async fetchAllPages(endpoint, query, onPage) {
        if (endpoint === 'invoices' && query.fromPurchaseDate === '2026-01-01T00:00:00') {
          throw new Error('KiotViet 500 thang 1');
        }
        await onPage([], {});
      }
    };

    await runBackfill(pool, client, branch, { from: '2026-01-01', to: '2026-02-15' });

    const logs = await pool.query(
      `SELECT entity_name, status FROM sync_run_log WHERE branch_id = $1 AND entity_name LIKE 'invoices:backfill:%' ORDER BY entity_name`,
      [branch.id]
    );
    assert.deepEqual(logs.rows, [
      { entity_name: 'invoices:backfill:2026-01', status: 'error' },
      { entity_name: 'invoices:backfill:2026-02', status: 'success' }
    ]);
  });
});

test('runBackfill: purchases (endpoint purchaseorders) duoc chia theo thang voi fromPurchaseDate/toPurchaseDate', async () => {
  await withTestPool(async (pool, branch) => {
    const purchaseCalls = [];
    const client = {
      async fetchAllPages(endpoint, query, onPage) {
        if (endpoint === 'purchaseorders') purchaseCalls.push(query);
        await onPage([], {});
      }
    };

    await runBackfill(pool, client, branch, { from: '2026-01-01', to: '2026-01-31' });

    assert.equal(purchaseCalls.length, 1);
    assert.equal(purchaseCalls[0].fromPurchaseDate, '2026-01-01T00:00:00');
    assert.equal(purchaseCalls[0].toPurchaseDate, '2026-01-31T23:59:59');

    const log = await pool.query(
      `SELECT * FROM sync_run_log WHERE branch_id = $1 AND entity_name = 'purchases:backfill:2026-01'`,
      [branch.id]
    );
    assert.equal(log.rows.length, 1);
    assert.equal(log.rows[0].status, 'success');
  });
});

test('runBackfill: cash_flows duoc chia theo thang, moi thang goi ca isReceipt=true va false voi startDate/endDate', async () => {
  await withTestPool(async (pool, branch) => {
    const cashFlowCalls = [];
    const client = {
      async fetchAllPages(endpoint, query, onPage) {
        if (endpoint === 'cashflow') cashFlowCalls.push(query);
        await onPage([], {});
      }
    };

    await runBackfill(pool, client, branch, { from: '2026-01-01', to: '2026-01-31' });

    assert.equal(cashFlowCalls.length, 2, '1 thang x 2 luot isReceipt true/false');
    const receiptFlags = cashFlowCalls.map((q) => q.isReceipt).sort();
    assert.deepEqual(receiptFlags, ['false', 'true']);
    assert.equal(cashFlowCalls[0].startDate, '2026-01-01T00:00:00');
    assert.equal(cashFlowCalls[0].endDate, '2026-01-31T23:59:59');

    const log = await pool.query(
      `SELECT * FROM sync_run_log WHERE branch_id = $1 AND entity_name = 'cash_flows:backfill:2026-01'`,
      [branch.id]
    );
    assert.equal(log.rows.length, 1);
    assert.equal(log.rows[0].status, 'success');
  });
});

test('runBackfill: KHONG dung den sync_checkpoints (chi ghi sync_run_log)', async () => {
  await withTestPool(async (pool, branch) => {
    const client = { async fetchAllPages(endpoint, query, onPage) { await onPage([], {}); } };
    await runBackfill(pool, client, branch, { from: '2026-01-01', to: '2026-01-31' });

    const checkpoints = await pool.query('SELECT * FROM sync_checkpoints WHERE branch_id = $1', [branch.id]);
    assert.deepEqual(checkpoints.rows, []);
  });
});
