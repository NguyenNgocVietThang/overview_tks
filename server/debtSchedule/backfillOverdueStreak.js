'use strict';

// Chay MOT LAN sau khi ap migration 0048: tinh no qua han + so phien lien tiep cho ban chot
// 15:00 da co san (lam truoc khi co cot nay) de chieu nay hien phien 1. Chay lai an toan.
//   node debtSchedule/backfillOverdueStreak.js            (ban chot moi nhat)
//   node debtSchedule/backfillOverdueStreak.js 2026-10-13 (chi dinh ngay)

if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* dotenv tuy chon */ }
}

const { getPool } = require('../db/pool');
const { applyOverdueStreaks } = require('./debtCycleSnapshot');

async function backfillOverdueStreak(pool, cycleDate) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let date = cycleDate;
    if (!date) {
      const { rows } = await client.query('SELECT MAX(cycle_date)::text AS cycle_date FROM debt_cycle_runs');
      date = rows[0] && rows[0].cycle_date;
    }
    if (!date) {
      await client.query('ROLLBACK');
      return { cycleDate: null, customers: 0, slow: 0 };
    }
    const result = await applyOverdueStreaks(client, date);
    await client.query('COMMIT');
    return { cycleDate: date, ...result };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const arg = process.argv[2];
  if (arg && !/^\d{4}-\d{2}-\d{2}$/.test(arg)) throw new Error('Ngay phai co dang YYYY-MM-DD.');
  const result = await backfillOverdueStreak(getPool(), arg);
  console.log(result.cycleDate
    ? `[backfillOverdueStreak] ${result.cycleDate}: ${result.customers} khach, ${result.slow} khach no cham (>= 400k).`
    : '[backfillOverdueStreak] Chua co ban chot nao.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[backfillOverdueStreak] That bai: ${error.message}`);
    process.exitCode = 1;
  }).finally(() => getPool().end && getPool().end());
}

module.exports = { backfillOverdueStreak };
