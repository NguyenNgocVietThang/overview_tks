'use strict';

// Bo test tich hop tong hop (Phase4 Task 3) - chay THAT tren 1 Supabase project
// TEST rieng biet, tach hoan toan voi production. QUAN TRONG (an toan du lieu
// that): file nay CHI doc process.env.SUPABASE_TEST_DB_URL truc tiep, TUYET
// DOI KHONG fallback sang CONFIG.SUPABASE_DB_URL / getPool() (pool production) -
// khac cac *.integration.test.js khac trong repo (migrate/checkpointRepository/
// backfillProgressRepository/webhookEventQueue) von dung chung CONFIG.SUPABASE_DB_URL
// vi chi kiem tra cau truc hoac dung transaction ROLLBACK. File nay GHI du lieu
// nghiep vu that (khong roll back - de mo phong dung 1 lan poll hoan chinh nhu
// production) nen bat buoc pool rieng, bien moi truong rieng.
//
// Khong set SUPABASE_TEST_DB_URL -> toan bo test bi skip, KHONG fail CI va
// KHONG duoc chay trong phien lam viec nay (theo yeu cau cua nguoi dung).

const test = require('node:test');
const assert = require('node:assert/strict');

const SUPABASE_TEST_DB_URL = process.env.SUPABASE_TEST_DB_URL || null;
const SKIP_REASON = 'SUPABASE_TEST_DB_URL chưa cấu hình — bỏ qua bộ test tích hợp Phase 4 (Task 3)';

// ID am, khong the trung du lieu that tu KiotViet (luon la so duong).
const TEST_IDS = Object.freeze({
  category: -900001,
  invoice: -900002,
  cashFlowReceipt: -900003,
  cashFlowPayment: -900004,
  staffSoldBy: -900011,
  staffCashUser: -900012
});

function buildTestPool() {
  // Lazy-require de khong tai `pg` neu suite bi skip toan bo.
  const { Pool } = require('pg');
  const CONFIG = require('../../config');
  return new Pool({
    connectionString: SUPABASE_TEST_DB_URL,
    max: 5,
    ssl: CONFIG.PGSSL ? { rejectUnauthorized: false } : false
  });
}

test('fullSync integration (Supabase test project)', { skip: SUPABASE_TEST_DB_URL ? false : SKIP_REASON }, async (t) => {
  const { runMigrations } = require('../../db/migrate');
  const { createCheckpointRepository } = require('../checkpointRepository');
  const { createSyncDriver } = require('../syncDriver');
  const categoriesEntity = require('../entities/categories');
  const invoicesEntity = require('../entities/invoices');
  const cashFlowsEntity = require('../entities/cashFlows');

  const pool = buildTestPool();
  t.after(() => pool.end());

  await runMigrations({ pool, logger: { log() {} } });

  async function cleanupTestData() {
    await pool.query('DELETE FROM invoice_payments WHERE branch = $1 AND invoice_id = $2', ['hanoi', TEST_IDS.invoice]);
    await pool.query('DELETE FROM invoice_details WHERE branch = $1 AND invoice_id = $2', ['hanoi', TEST_IDS.invoice]);
    await pool.query('DELETE FROM invoices WHERE branch = $1 AND id = $2', ['hanoi', TEST_IDS.invoice]);
    await pool.query('DELETE FROM categories WHERE branch = $1 AND id = $2', ['hanoi', TEST_IDS.category]);
    await pool.query('DELETE FROM cash_flows WHERE branch = $1 AND id = ANY($2::bigint[])', ['saigon', [TEST_IDS.cashFlowReceipt, TEST_IDS.cashFlowPayment]]);
    await pool.query('DELETE FROM staff WHERE branch = $1 AND id = ANY($2::bigint[])', ['hanoi', [TEST_IDS.staffSoldBy]]);
    await pool.query('DELETE FROM staff WHERE branch = $1 AND id = ANY($2::bigint[])', ['saigon', [TEST_IDS.staffCashUser]]);
    await pool.query('DELETE FROM sync_checkpoints WHERE branch = $1 AND entity = $2', ['hanoi', 'categories']);
    await pool.query('DELETE FROM sync_checkpoints WHERE branch = $1 AND entity = $2', ['hanoi', 'invoices']);
    await pool.query('DELETE FROM sync_checkpoints WHERE branch = $1 AND entity = $2', ['saigon', 'cash_flows']);
  }

  t.beforeEach(cleanupTestData);
  t.afterEach(cleanupTestData);

  await t.test('categories (dai dien nhom don gian, khong bang con)', async () => {
    const checkpoints = createCheckpointRepository({ pool });
    const driver = createSyncDriver({ pool, checkpointRepository: checkpoints, now: () => Date.parse('2026-09-14T02:00:00Z') });
    const kiotVietClient = {
      async fetchAllPages(_endpoint, _query, onPage) {
        await onPage([{ Id: TEST_IDS.category, ParentId: null, Name: 'TEST_CATEGORY', Rank: 1, ModifiedDate: '2026-09-14T01:00:00Z' }]);
      }
    };

    await driver.pollEntityOnce(kiotVietClient, 'hanoi', categoriesEntity);

    const row = (await pool.query('SELECT * FROM categories WHERE branch = $1 AND id = $2', ['hanoi', TEST_IDS.category])).rows[0];
    assert.ok(row, 'ban ghi categories phai ton tai sau khi poll');
    assert.equal(row.name, 'TEST_CATEGORY');
    assert.equal(row.rank, 1);
    assert.ok(row.raw && row.raw.Name === 'TEST_CATEGORY', 'cot raw JSONB phai luu nguyen payload goc');

    const checkpoint = await checkpoints.getCheckpoint('hanoi', 'categories');
    assert.equal(new Date(checkpoint.last_synced_at).toISOString(), '2026-09-14T02:00:00.000Z');
  });

  await t.test('invoices (dai dien nhom co bang con + invoice_payments + tac dung phu staffSync)', async () => {
    const checkpoints = createCheckpointRepository({ pool });
    const driver = createSyncDriver({ pool, checkpointRepository: checkpoints, now: () => Date.parse('2026-09-14T02:00:00Z') });
    const kiotVietClient = {
      async fetchAllPages(_endpoint, _query, onPage) {
        await onPage([{
          Id: TEST_IDS.invoice, Code: 'TEST_INV001', PurchaseDate: '2026-09-14T01:00:00Z',
          CustomerId: null, SoldById: TEST_IDS.staffSoldBy, SoldByName: 'TEST Nhan Vien',
          Total: 500000, TotalPayment: 500000, Status: 1,
          CreatedDate: '2026-09-14T01:00:00Z', ModifiedDate: '2026-09-14T01:00:00Z',
          InvoiceDetails: [{ ProductId: 111, Quantity: 2, Price: 200000, Discount: 0 }],
          Payments: [{ Method: 'Cash', Amount: 500000, TransDate: '2026-09-14T01:00:00Z' }]
        }]);
      }
    };

    await driver.pollEntityOnce(kiotVietClient, 'hanoi', invoicesEntity);

    const invoiceRow = (await pool.query('SELECT * FROM invoices WHERE branch = $1 AND id = $2', ['hanoi', TEST_IDS.invoice])).rows[0];
    assert.ok(invoiceRow);
    assert.equal(invoiceRow.code, 'TEST_INV001');
    assert.equal(Number(invoiceRow.total), 500000);

    const details = (await pool.query('SELECT * FROM invoice_details WHERE branch = $1 AND invoice_id = $2 ORDER BY line_no', ['hanoi', TEST_IDS.invoice])).rows;
    assert.equal(details.length, 1);
    assert.equal(Number(details[0].quantity), 2);

    const payments = (await pool.query('SELECT * FROM invoice_payments WHERE branch = $1 AND invoice_id = $2 ORDER BY line_no', ['hanoi', TEST_IDS.invoice])).rows;
    assert.equal(payments.length, 1);
    assert.equal(Number(payments[0].amount), 500000);

    const staffRow = (await pool.query('SELECT * FROM staff WHERE branch = $1 AND id = $2', ['hanoi', TEST_IDS.staffSoldBy])).rows[0];
    assert.ok(staffRow, 'staff phai duoc upsert tu SoldById cua invoice');
    assert.equal(staffRow.name, 'TEST Nhan Vien');
  });

  await t.test('cash_flows (dai dien nhom goi API 2 lan + checkpoint qua note)', async () => {
    const checkpoints = createCheckpointRepository({ pool });
    const driver = createSyncDriver({ pool, checkpointRepository: checkpoints, now: () => Date.parse('2026-09-14T02:00:00Z') });
    const kiotVietClient = {
      async fetchAllPages(_endpoint, query, onPage) {
        if (query.isReceipt === 'true') {
          await onPage([{ Id: TEST_IDS.cashFlowReceipt, Code: 'TEST_PT001', IsReceipt: true, Amount: 100000, UserId: TEST_IDS.staffCashUser, UserName: 'TEST Thu Ngan', TransDate: '2026-09-14T01:30:00Z', CreatedDate: '2026-09-14T01:30:00Z' }]);
        } else {
          await onPage([{ Id: TEST_IDS.cashFlowPayment, Code: 'TEST_PC001', IsReceipt: false, Amount: 50000, UserId: TEST_IDS.staffCashUser, UserName: 'TEST Thu Ngan', TransDate: '2026-09-14T01:45:00Z', CreatedDate: '2026-09-14T01:45:00Z' }]);
        }
      }
    };

    await driver.pollEntityOnce(kiotVietClient, 'saigon', cashFlowsEntity);

    const rows = (await pool.query('SELECT * FROM cash_flows WHERE branch = $1 AND id = ANY($2::bigint[]) ORDER BY id', ['saigon', [TEST_IDS.cashFlowReceipt, TEST_IDS.cashFlowPayment]])).rows;
    assert.equal(rows.length, 2);
    const receiptRow = rows.find((r) => Number(r.id) === TEST_IDS.cashFlowReceipt);
    const paymentRow = rows.find((r) => Number(r.id) === TEST_IDS.cashFlowPayment);
    assert.equal(receiptRow.is_receipt, true);
    assert.equal(Number(receiptRow.amount), 100000);
    assert.equal(paymentRow.is_receipt, false);
    assert.equal(Number(paymentRow.amount), 50000);

    const staffRow = (await pool.query('SELECT * FROM staff WHERE branch = $1 AND id = $2', ['saigon', TEST_IDS.staffCashUser])).rows[0];
    assert.ok(staffRow, 'staff phai duoc upsert tu UserId cua cash_flows');

    const checkpoint = await checkpoints.getCheckpoint('saigon', 'cash_flows');
    assert.equal(checkpoint.note, '2026-09-14T02:00:00.000Z', 'cua so startDate/endDate da dung phai duoc luu trong note');
  });

  await t.test('chay lai toan bo 3 kich ban lan 2 lien tiep khong de lai ban ghi rac', async () => {
    const checkpoints = createCheckpointRepository({ pool });
    const driver = createSyncDriver({ pool, checkpointRepository: checkpoints, now: () => Date.parse('2026-09-14T03:00:00Z') });
    const categoryClient = { async fetchAllPages(_e, _q, onPage) { await onPage([{ Id: TEST_IDS.category, Name: 'TEST_CATEGORY_2', Rank: 2, ModifiedDate: '2026-09-14T02:30:00Z' }]); } };

    await driver.pollEntityOnce(categoryClient, 'hanoi', categoriesEntity);
    await driver.pollEntityOnce(categoryClient, 'hanoi', categoriesEntity);

    const rows = (await pool.query('SELECT * FROM categories WHERE branch = $1 AND id = $2', ['hanoi', TEST_IDS.category])).rows;
    assert.equal(rows.length, 1, 'chay lai nhieu lan phai UPSERT, khong tao ban ghi trung');

    await cleanupTestData();
    const afterCleanup = (await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM categories WHERE branch = 'hanoi' AND id = $1) AS categories,
         (SELECT COUNT(*) FROM invoices WHERE branch = 'hanoi' AND id = $2) AS invoices,
         (SELECT COUNT(*) FROM cash_flows WHERE branch = 'saigon' AND id = ANY($3::bigint[])) AS cash_flows`,
      [TEST_IDS.category, TEST_IDS.invoice, [TEST_IDS.cashFlowReceipt, TEST_IDS.cashFlowPayment]]
    )).rows[0];
    assert.equal(Number(afterCleanup.categories), 0);
    assert.equal(Number(afterCleanup.invoices), 0);
    assert.equal(Number(afterCleanup.cash_flows), 0);
  });
});
