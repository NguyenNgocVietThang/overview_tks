'use strict';
const fs = require('node:fs');
const { prepareHistoryImport, applyHistoryImport } = require('../marketingReport/marketingHistoryImport');
function parseArgs(args) {
  const options = { apply: false }; const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]; if (seen.has(arg)) throw new Error(); seen.add(arg);
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--apply') options.apply = true;
    else if (['--input', '--year', '--report-file', '--actor-id'].includes(arg)) {
      const value = args[++i]; if (!value || value.startsWith('--')) throw new Error();
      options[{ '--input': 'input', '--year': 'year', '--report-file': 'reportFile', '--actor-id': 'actorId' }[arg]] = value;
    } else throw new Error();
  }
  if (!options.input || !/^\d{4}$/.test(options.year || '') || (options.apply && options.dryRun) || (options.apply && !/^[1-9]\d*$/.test(options.actorId || ''))) throw new Error();
  options.year = Number(options.year); return options;
}
async function main() {
  let pool;
  try {
    const options = parseArgs(process.argv.slice(2));
    const prepared = prepareHistoryImport(JSON.parse(fs.readFileSync(options.input, 'utf8')), { year: options.year });
    const summary = prepared.summary;
    if (options.apply) {
      pool = require('../db/pool').getPool();
      const repository = require('../marketingReport/marketingRepository').createMarketingRepository({ pool });
      summary.appliedBatches = await applyHistoryImport(prepared, repository, { userId: options.actorId }); summary.mode = 'apply';
    }
    if (options.reportFile) fs.writeFileSync(options.reportFile, JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } catch (error) {
    const allowedCodes = ['INVALID_MARKETING_IMPORT', 'MARKETING_IMPORT_CONFLICT', 'MARKETING_STORAGE_ERROR'];
    const code = allowedCodes.includes(error.code) ? error.code : 'MARKETING_IMPORT_FAILED';
    process.stderr.write(JSON.stringify({ code, message: 'History import failed. Use --input FILE --year YYYY [--dry-run | --apply --actor-id ID] [--report-file FILE]. No source values are logged.', rowReferences: error.rowReferences || [] }) + '\n');
    process.exitCode = 1;
  } finally { if (pool) await pool.end(); }
}
if (require.main === module) main();
module.exports = { parseArgs };
