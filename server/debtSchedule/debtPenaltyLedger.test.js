'use strict';

// Chay SQL THAT cua migration 0051 + chot so phat theo chu ky tren PGlite.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { takeDebtCycleSnapshot } = require('./debtCycleSnapshot');
const { createDebtScheduleRepository } = require('./debtScheduleRepository');
const { finalizePenaltyCycle, finalizePendingPenaltyCycles } = require('./debtPenaltyLedger');

const MIGRATION = ['0047_debt_schedule_report.sql', '0048_debt_penalty.sql', '0050_debt_cycle_manual_refresh.sql', '0051_debt_penalty_ledger.sql']
  .map(file => fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', file), 'utf8')).join(' ');

const BASE_SCHEMA = `
  CREATE TABLE customers (branch TEXT, id BIGINT, code TEXT, name TEXT, debt NUMERIC, raw JSONB, PRIMARY KEY (branch, id));
  CREATE TABLE invoices (branch TEXT, id BIGINT, customer_id BIGINT, purchase_date TIMESTAMPTZ, total NUMERIC, raw JSONB);
  CREATE TABLE returns (branch TEXT, id BIGINT, customer_id BIGINT, return_date TIMESTAMPTZ, total NUMERIC, raw JSONB);
`;

function poolFor(db) {
  return {
    query: (sql, params) => db.query(sql, params),
    connect: async () => ({ query: (sql, params) => db.query(sql, params), release() {} })
  };
}

async function setup() {
  const db = new PGlite();
  await db.exec(BASE_SCHEMA);
  await db.exec(MIGRATION);
  // Khong co hoa don -> no qua han = no hien tai: HN1 800d, SG1 300d (deu < 400k -> no le 25k), HN2 khong no.
  await db.exec(`
    INSERT INTO customers VALUES
      ('hanoi', 1, 'KH1', 'Khách Một', 800, '{"groups":"Lan"}'),
      ('hanoi', 2, 'KH2', 'Khách Hai', 0, '{"groups":"Lan"}'),
      ('saigon', 1, 'KH1', 'Khách Một SG', 300, '{}');
  `);
  const pool = poolFor(db);
  return { db, pool, repository: createDebtScheduleRepository({ pool }) };
}

const noAverages = async () => ({ branches: [], codes: [], values: [] });
const at15 = date => new Date(`${date}T08:00:00Z`);
const snapshot = (pool, date) => takeDebtCycleSnapshot(pool, date, { takenAt: at15(date), log: () => {}, loadAverages: noAverages });
const user = { id: 'u1', hoTen: 'Quản lý A' };

test('chot so phat: chi khi co ban chot ke tiep, ghi dung so tay / "Da xu ly" = 0 / goi y, chay lai khong nhan doi', async () => {
  const { db, pool, repository } = await setup();
  try {
    await snapshot(pool, '2026-08-08');
    await repository.savePenalty({ branch: 'hanoi', customerId: '1', amount: 40000, user });
    await repository.saveStatus({ branch: 'saigon', customerId: '1', status: 'Đã xử lý', user });

    // Chu ky 08-08 van dang mo -> chua co gi de chot.
    assert.deepEqual(await finalizePendingPenaltyCycles(pool, { log: () => {} }), []);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM debt_penalty_daily')).rows[0].n, 0);

    await snapshot(pool, '2026-08-09');
    const done = await finalizePendingPenaltyCycles(pool, { log: () => {} });
    assert.deepEqual(done, [{ cycleDate: '2026-08-08', customers: 1, amount: 40000 }]);
    const { rows } = await db.query(`SELECT branch, customer_id::int AS id, sale, amount::int AS amount, is_manual, status
      FROM debt_penalty_daily ORDER BY branch, customer_id`);
    assert.deepEqual(rows, [{ branch: 'hanoi', id: 1, sale: 'Lan', amount: 40000, is_manual: true, status: 'Chưa xử lý' }]);

    // Da chot thi khong chot lai; goi truc tiep van idempotent.
    assert.deepEqual(await finalizePendingPenaltyCycles(pool, { log: () => {} }), []);
    await finalizePenaltyCycle(pool, '2026-08-08');
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM debt_penalty_daily')).rows[0].n, 1);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM debt_penalty_cycles')).rows[0].n, 1);
  } finally { await db.close(); }
});

test('chot so phat: bu nhieu chu ky sot, listPenaltyDays loc dung thang + co so va gop theo sale', async () => {
  const { db, pool, repository } = await setup();
  try {
    for (const date of ['2026-08-08', '2026-08-09', '2026-08-10']) await snapshot(pool, date);
    const done = await finalizePendingPenaltyCycles(pool, { log: () => {} });
    assert.deepEqual(done.map(item => item.cycleDate), ['2026-08-08', '2026-08-09']);

    const both = await repository.listPenaltyDays({ month: '2026-08', branches: ['hanoi', 'saigon'] });
    assert.deepEqual(both, [
      { cycleDate: '2026-08-08', sale: 'Chưa phân nhóm', penalizedCustomers: 1, amount: 25000 },
      { cycleDate: '2026-08-08', sale: 'Lan', penalizedCustomers: 1, amount: 25000 },
      { cycleDate: '2026-08-09', sale: 'Chưa phân nhóm', penalizedCustomers: 1, amount: 25000 },
      { cycleDate: '2026-08-09', sale: 'Lan', penalizedCustomers: 1, amount: 25000 }
    ]);
    const hanoi = await repository.listPenaltyDays({ month: '2026-08', branches: ['hanoi'] });
    assert.deepEqual(hanoi.map(item => item.sale), ['Lan', 'Lan']);
    assert.deepEqual(await repository.listPenaltyDays({ month: '2026-09', branches: ['hanoi', 'saigon'] }), []);
    await assert.rejects(repository.listPenaltyDays({ month: '2026-13' }), /Tháng không hợp lệ/);
  } finally { await db.close(); }
});

test('migration 0051: tien phat phai > 0, khoa chinh theo chu ky + khach', async () => {
  const { db } = await setup();
  try {
    await assert.rejects(db.query(`INSERT INTO debt_penalty_daily (cycle_date, branch, customer_id, amount) VALUES ('2026-08-08', 'hanoi', 1, 0)`), /check/i);
    await db.query(`INSERT INTO debt_penalty_daily (cycle_date, branch, customer_id, amount) VALUES ('2026-08-08', 'hanoi', 1, 25000)`);
    await assert.rejects(db.query(`INSERT INTO debt_penalty_daily (cycle_date, branch, customer_id, amount) VALUES ('2026-08-08', 'hanoi', 1, 50000)`), /duplicate|unique/i);
  } finally { await db.close(); }
});
