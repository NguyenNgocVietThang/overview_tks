'use strict';
// Chuan hoa ghi chu thung da luu cua VT Ha Noi / VT Sai Gon (stock_positions) bang dung ham cua VT (carton.normalizeStoredNote):
// so tran "60" -> "1T x 60", gop cong don "50Tx50 + 70Tx50" -> "120T x 50", thong nhat ky hieu ("1tx432", "1t*432" -> "1T x 432").
//   npm run vt:normalize-notes -- [--branch HN|SG] [--apply]
// Mac dinh DRY-RUN (khong ghi). --apply ghi version + 1 va 1 dong lich su 'edit' cho moi dong doi. Chay lai an toan.
const { createStockPositionsService } = require('../stockPositions/stockPositionsService');

async function main(args, { service = createStockPositionsService(), stdout = console.log } = {}) {
  let apply = false;
  let branches = ['HN', 'SG'];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') apply = true;
    else if (args[i] === '--dry-run') apply = false;
    else if (args[i] === '--branch') {
      const value = String(args[++i] || '').toUpperCase();
      if (!['HN', 'SG'].includes(value)) throw new Error('--branch phải là HN hoặc SG');
      branches = [value];
    } else throw new Error(`Tham số không hỗ trợ: ${args[i]}`);
  }
  for (const branch of branches) {
    const result = await service.normalizeAllNotes({ branch, dryRun: !apply });
    stdout(`[${branch}] ${apply ? 'ĐÃ GHI' : 'DRY-RUN'}: quét ${result.scanned} dòng, ${result.changed} dòng cần chuẩn hóa.`);
    result.sample.forEach(item => stdout(`  ${item.code} @ ${item.location}: "${item.from}" -> "${item.to}"`));
  }
  if (!apply) stdout('Chưa ghi gì. Thêm --apply để áp dụng.');
}

if (require.main === module) {
  main(process.argv.slice(2)).then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
}
module.exports = { main };
