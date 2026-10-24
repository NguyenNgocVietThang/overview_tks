'use strict';

// Nap level + nhan "Khach moi" + SDT/dia chi tu file "DS khach". Mac dinh PREVIEW (khong ghi).
// Dung: node scripts/import-customer-levels-from-excel.js <file.xlsx> [--apply] [--parse-only]
const { readExcelRows, runImport, consolidate, levelCounts } = require('../businessReport/customerLevelExcelImport');

async function main(argv = process.argv.slice(2)) {
  const file = argv.find(a => !a.startsWith('--'));
  if (!file) throw new Error('Thiếu đường dẫn file .xlsx');
  const rows = await readExcelRows(file);
  if (argv.includes('--parse-only')) {
    const { entries, invalid, duplicates } = consolidate(rows);
    console.log(JSON.stringify({ mode: 'parse-only', rows: rows.length, levelCounts: levelCounts(rows), uniqueCustomers: entries.length, invalidRows: invalid.length, duplicates: duplicates.length, duplicateConflicts: duplicates.filter(d => d.conflict) }, null, 2));
    return;
  }
  const { getPool } = require('../db/pool');
  const { createCustomerPriceLevelRepository } = require('../businessReport/customerPriceLevelRepository');
  const pool = getPool();
  try {
    const repo = createCustomerPriceLevelRepository({ pool });
    console.log(JSON.stringify(await runImport({ rows, pool, repo, apply: argv.includes('--apply') }), null, 2));
  } finally { await pool.end(); }
}
if (require.main === module) main().catch(err => { console.error(err.message); process.exitCode = 1; });
module.exports = { main };
