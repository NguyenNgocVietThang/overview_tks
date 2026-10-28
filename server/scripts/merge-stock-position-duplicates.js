'use strict';
// Gop cac dong VT Ha Noi / VT Sai Gon (stock_positions) trung (ma, vi tri) thanh 1 dong: cong don ghi chu thung bang mergeNotes,
// giu dong id nho nhat, xoa dong con lai (ghi lich su).
//   npm run vt:merge-duplicates -- [--branch HN|SG] [--apply]
// Mac dinh DRY-RUN (khong ghi). Nhom ghi chu sai dinh dang hoac dang duoc phieu boc dung thi bo qua va bao lai. Chay lai an toan.
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
    const result = await service.mergeDuplicateRows({ branch, dryRun: !apply });
    stdout(`[${branch}] ${apply ? 'ĐÃ GHI' : 'DRY-RUN'}: quét ${result.scanned} dòng, ${result.groups} nhóm trùng, xóa ${result.removed} dòng thừa, bỏ qua ${result.skipped.length} nhóm.`);
    result.sample.forEach(item => stdout(`  ${item.code} @ ${item.location}: ${item.from.map(note => `"${note}"`).join(' + ')} -> "${item.to}"`));
    result.skipped.forEach(item => stdout(`  BỎ QUA ${item.code} @ ${item.location}: ${item.reason}`));
  }
  if (!apply) stdout('Chưa ghi gì. Thêm --apply để áp dụng.');
}

if (require.main === module) {
  main(process.argv.slice(2)).then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
}
module.exports = { main };
