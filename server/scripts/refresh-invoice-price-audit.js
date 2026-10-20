'use strict';
// Chay tay job "Kiem tra gia ban" (23:00 VN) cho 1 ngay:
//   npm run invoices:price-audit -- [--date YYYY-MM-DD] [--apply]
// Mac dinh DRY-RUN: chup trong giao dich roi ROLLBACK, in so hoa don/dong se them, so dong sai gia, cua so;
// KHONG ghi gi (ca state/last_error). --apply goi runDailyAudit that (khoa advisory, cong bo tat ca hoac khong).
// Khong co co ghi de ban da chup: ngay da cong bo tra 'already-completed', ngay cu hon ban cong bo tra 'stale'.

const HELP = 'Kiểm tra giá bán (job 23:00 VN) cho một ngày: '
  + 'node server/scripts/refresh-invoice-price-audit.js [--date YYYY-MM-DD] [--apply]\n'
  + 'Mặc định dry-run (không ghi DB). --date mặc định là hôm nay theo giờ VN. --apply mới công bố thật.';

// 0 = dry-run xong / da cong bo; 2 = chua cong bo (busy, not-due, stale, failed); 1 = tham so sai/loi dry-run.
const OK_STATUSES = new Set(['completed', 'already-completed']);

function parseArgs(args, isValidDay) {
  const opts = { apply: false, date: null, help: false };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help') opts.help = true;
    else if (flag === '--apply') opts.apply = true;
    else if (flag === '--dry-run') opts.apply = false;
    else if (flag === '--date') {
      const value = args[++i];
      if (!isValidDay(value)) throw new Error(`--date phải là YYYY-MM-DD hợp lệ (nhận ${JSON.stringify(value)})`);
      opts.date = value;
    } else throw new Error(`Tham số không hỗ trợ: ${flag}`);
  }
  return opts;
}

async function main(args, { pool, now = () => new Date(), stdout = console.log, stderr = console.error, logger = console } = {}) {
  const { runDailyAudit, previewDailyAudit, isValidDay } = require('../invoicePriceAudit/priceAuditRefresh');
  const { vnDateKey } = require('../kiotvietSync/vnTime');
  let opts;
  try {
    opts = parseArgs(args, isValidDay);
  } catch (error) {
    stderr(error.message);
    stderr(HELP);
    return 1;
  }
  if (opts.help) { stdout(HELP); return 0; }
  const current = now();
  const day = opts.date || vnDateKey(current);
  if (!pool) {
    require('../config');
    pool = require('../db/pool').getPool();
  }
  if (!opts.apply) {
    try {
      stdout(JSON.stringify(await previewDailyAudit({ day, pool, now: current }), null, 2));
      return 0;
    } catch (error) {
      stderr(`[PriceAudit] Dry-run thất bại: ${error.code || 'UNKNOWN'} ${error.code === 'PRICE_AUDIT_SOURCE_NOT_READY' ? error.message : ''}`.trim());
      return 1;
    }
  }
  const result = await runDailyAudit({ day, pool, now: current, logger });
  stdout(JSON.stringify({ mode: 'apply', ...result }, null, 2));
  return OK_STATUSES.has(result.status) ? 0 : 2;
}

if (require.main === module) {
  if (process.env.NODE_ENV !== 'production') {
    try { require('dotenv').config(); } catch { /* dotenv tuy chon */ }
  }
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).finally(async () => {
    try { await require('../db/pool').getPool().end(); } catch { /* da dong */ }
  });
}

module.exports = { main, parseArgs };
