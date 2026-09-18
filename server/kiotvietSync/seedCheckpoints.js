'use strict';

// Script van hanh, chay 1 LAN DUY NHAT truoc khi bat KIOTVIET_SYNC_ENABLED=true
// lan dau (Giai doan 3->2 chuyen giao). Van de can giai quyet: backfill.js loc
// theo NGAY GIAO DICH (fromPurchaseDate/startDate...), khong loc theo
// ModifiedDate - nen 1 ban ghi da backfill xong nhung bi SUA trong luc backfill
// van dang chay cho cac entity/chunk khac se KHONG duoc backfill quet lai.
// Neu bat polling lan dau ma khong co checkpoint cu, syncDriver.js mac dinh
// chi quet lai 1 GIO gan nhat - bo sot moi thay doi xay ra truoc do, trong
// suot thoi gian backfill chay (co the vai gio).
//
// Cach xu ly: ghi san sync_checkpoints.last_synced_at (va note, dung cho
// cash_flows - xem syncDriver.js pollCashFlows) = thoi diem BAT DAU backfill
// (khong phai thoi diem chay script nay), de lan poll dau tien tu quet lai
// toan bo khoang "backfill dang chay" - khong bo sot du bao lau backfill da
// chay.
//
// Chay thu cong: node server/kiotvietSync/seedCheckpoints.js --from=<ISO>
// --from bat buoc phai la thoi diem <= luc backfill --execute lan dau bat
// dau chay that (an toan hon la lay som hon that, khong duoc lay tre hon).

if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* dotenv là tùy chọn trong môi trường production */ }
}

const ENTITIES = ['categories', 'products', 'customers', 'suppliers', 'returns', 'purchases', 'cash_flows', 'orders', 'invoices'];

async function seedCheckpoints(pool, branches, fromIso, { log = console.log } = {}) {
  const rows = [];
  for (const branch of branches) {
    for (const entity of ENTITIES) {
      await pool.query(
        `INSERT INTO sync_checkpoints (branch, entity, last_synced_at, last_success_at, note)
         VALUES ($1, $2, $3::timestamptz, now(), $4)
         ON CONFLICT (branch, entity) DO UPDATE SET
           last_synced_at = LEAST(COALESCE(sync_checkpoints.last_synced_at, EXCLUDED.last_synced_at), EXCLUDED.last_synced_at),
           note = EXCLUDED.note`,
        [branch, entity, fromIso, fromIso]
      );
      rows.push({ branch, entity });
      log(`[seedCheckpoints] ${branch}/${entity}: last_synced_at <= ${fromIso}`);
    }
  }
  return rows;
}

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'from') args.from = value;
  }
  return args;
}

async function main() {
  const { getPool } = require('../db/pool');
  const { getConfiguredBranches } = require('./config');

  const args = parseArgs(process.argv.slice(2));
  if (!args.from) {
    console.error('[seedCheckpoints] Thieu --from=<ISO timestamp>. Vi du: --from=2026-09-16T01:30:00Z');
    process.exitCode = 1;
    return;
  }
  const fromIso = new Date(args.from).toISOString();
  const branches = getConfiguredBranches().map((b) => b.branch);
  if (!branches.length) {
    console.error('[seedCheckpoints] Khong co co so nao du cau hinh credentials.');
    process.exitCode = 1;
    return;
  }

  const pool = getPool();
  await seedCheckpoints(pool, branches, fromIso);
  console.log(`[seedCheckpoints] Da moi ${branches.length} co so x ${ENTITIES.length} entity ve last_synced_at=${fromIso}. San sang bat KIOTVIET_SYNC_ENABLED=true.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[seedCheckpoints] That bai: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { seedCheckpoints, parseArgs, ENTITIES };
