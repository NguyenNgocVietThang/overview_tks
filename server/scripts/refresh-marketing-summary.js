'use strict';
// Dung lai RIENG bang marketing_phone_summary (migration 0069) tu cac quan sat Pancake DA LUU trong Postgres.
// KHONG goi Pancake API, KHONG doc Google Sheets: chi doc marketing_pancake_independent_* va ghi khac biet
// vao marketing_phone_summary(+_state). Dung de co bang ngay sau khi ap 0069 thay vi cho het luot Pancake dem.
const { safeError } = require('../marketingReport/pancakeClient');

const HELP = 'Rebuild marketing_phone_summary from stored Pancake observations (no Pancake/Sheets access): '
  + 'node server/scripts/refresh-marketing-summary.js [--apply]\n'
  + 'Default dry-run performs no DB access. --apply rebuilds the table (diff-only writes; safe to re-run).';

// 0 = da dung/khong doi; 2 = chua dung duoc bang (busy, held, failed, unavailable); 1 = tham so sai.
const OK_STATUSES = new Set(['updated', 'unchanged']);

async function main(args, { repository, stdout = console.log, stderr = console.error } = {}) {
  try {
    let apply = false;
    for (const flag of args) {
      if (flag === '--help') { stdout(HELP); return 0; }
      if (flag === '--apply') apply = true;
      else if (flag === '--dry-run') apply = false;
      else throw safeError('INVALID_MARKETING_INPUT');
    }
    if (!apply) {
      stdout(JSON.stringify({ mode: 'dry-run', target: 'marketing_phone_summary', requiresApply: true }, null, 2));
      return 0;
    }
    if (!repository) {
      require('../config');
      repository = require('../marketingReport/marketingRepository').createMarketingRepository();
    }
    const result = await repository.refreshIndependentSummary();
    const summary = { mode: 'apply', status: result.status, phones: result.phones, written: result.written, deleted: result.deleted };
    stdout(JSON.stringify(summary, null, 2));
    return OK_STATUSES.has(result.status) ? 0 : 2;
  } catch (error) {
    stderr(safeError(error.code).code);
    return 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(async code => {
    process.exitCode = code;
    if (process.argv.includes('--apply')) {
      try { await require('../db/pool').getPool().end(); } catch { /* da dong */ }
    }
  });
}

module.exports = { main };
