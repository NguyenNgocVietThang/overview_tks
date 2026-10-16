'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTransferDb } = require('../transfers/testHelpers');

const insert = (db) => db.query(`INSERT INTO transfer_requests
  (request_code, idempotency_key, sale_telegram_id, customer_name, amount_vnd, bank_account, account_holder, bank_bin, created_at)
  VALUES ('YC-20261015-0001', 'key-00000001', '123', 'Khách', 1000, '0123456789', 'NGUYEN A', '970418', now())
  RETURNING id, version`);

test('migration 0054: bank BIN seed, constraints, trigger state machine and immutable events', async (t) => {
  const { db } = await createTransferDb();
  try {
    await t.test('seeds NAPAS banks with folded aliases', async () => {
      const { rows } = await db.query("SELECT short_name, aliases FROM bank_bins WHERE bin = '970418'");
      assert.equal(rows[0].short_name, 'BIDV');
      assert.ok(rows[0].aliases.includes('dautuphattrienvietnam'));
      assert.ok((await db.query('SELECT count(*)::int n FROM bank_bins')).rows[0].n >= 60);
    });

    const { rows: [row] } = await insert(db);
    const update = (sql) => db.query(`UPDATE transfer_requests SET ${sql} WHERE id = ${row.id}`);

    await t.test('version increases on every update and details are editable while CHO_DUYET', async () => {
      await update("customer_name = 'Khách mới'");
      const { rows: [r] } = await db.query(`SELECT version FROM transfer_requests WHERE id = ${row.id}`);
      assert.equal(Number(r.version), 2);
    });

    await t.test('cannot approve without a BIN, cannot skip straight to DA_CHUYEN', async () => {
      await assert.rejects(update("status = 'DA_CHUYEN', paid_at = now(), paid_by_name = 'x'"), /invalid transfer status change/);
      await assert.rejects(update("bank_bin = NULL, status = 'DA_DUYET', approved_at = now()"), /CHO_DUYET|check constraint/);
    });

    await t.test('approved details are locked; paid is final except revert to DA_DUYET', async () => {
      await update("status = 'DA_DUYET', approved_at = now()");
      await assert.rejects(update('amount_vnd = 2000'), /only change while CHO_DUYET/);
      await update("status = 'DA_CHUYEN', paid_at = now(), paid_by_name = 'Sếp'");
      await assert.rejects(update("status = 'DA_HUY', canceled_at = now(), canceled_by_type = 'SALE'"), /invalid transfer status change/);
      await update("status = 'DA_DUYET', paid_at = NULL, paid_by_name = NULL");
      await update("status = 'DA_HUY', canceled_at = now(), canceled_by_type = 'SALE'");
      await assert.rejects(update("status = 'CHO_DUYET'"), /is canceled/);
    });

    await t.test('accountant cancel requires a reason; rows cannot be deleted', async () => {
      const { rows: [r2] } = await db.query(`INSERT INTO transfer_requests
        (request_code, idempotency_key, sale_telegram_id, customer_name, amount_vnd, bank_account, account_holder, created_at)
        VALUES ('YC-20261015-0002', 'key-00000002', '123', 'K', 1, '1234', 'A', now()) RETURNING id`);
      await assert.rejects(db.query(`UPDATE transfer_requests SET status = 'DA_HUY', canceled_at = now(), canceled_by_type = 'ACCOUNTANT' WHERE id = ${r2.id}`), /check constraint/);
      await assert.rejects(db.query(`DELETE FROM transfer_requests WHERE id = ${r2.id}`), /cannot be deleted/);
    });

    await t.test('events only allow setting bot_delivered_at once', async () => {
      const { rows: [e] } = await db.query(`INSERT INTO transfer_request_events (request_id, version, event_type, actor_type)
        VALUES (${row.id}, 1, 'CREATED', 'SALE') RETURNING id`);
      await assert.rejects(db.query(`UPDATE transfer_request_events SET actor_name = 'x' WHERE id = ${e.id}`), /immutable/);
      await db.query(`UPDATE transfer_request_events SET bot_delivered_at = now() WHERE id = ${e.id}`);
      await assert.rejects(db.query(`UPDATE transfer_request_events SET bot_delivered_at = now() WHERE id = ${e.id}`), /immutable/);
      await assert.rejects(db.query(`DELETE FROM transfer_request_events WHERE id = ${e.id}`), /immutable/);
    });

    await t.test('sensitive tables are hidden from reporting_readonly', async () => {
      const { rows } = await db.query(`SELECT has_table_privilege('reporting_readonly', 'transfer_requests', 'SELECT') AS ok`);
      assert.equal(rows[0].ok, false);
    });
  } finally {
    await db.close();
  }
});
