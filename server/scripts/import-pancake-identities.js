'use strict';
const fs = require('node:fs');
const { prepareIdentityImport, applyIdentityImport } = require('../marketingReport/marketingIdentityImport');
const SYSTEM_ACTOR = { userId: 'system:pancake-identity-import', username: 'system', name: 'Pancake identity import' };

// Usage: node server/scripts/import-pancake-identities.js --input FILE [--apply] [--report-file FILE]
// The input is the private recovery file (message IDs + row references only). Without --apply nothing is written.
async function main(args = process.argv.slice(2)) {
  let pool;
  try {
    const options = { apply: false };
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--apply') options.apply = true;
      else if (args[i] === '--input' || args[i] === '--report-file') { const value = args[++i]; if (!value || value.startsWith('--')) throw new Error(); options[args[i - 1] === '--input' ? 'input' : 'reportFile'] = value; }
      else throw new Error();
    }
    if (!options.input) throw new Error();
    const prepared = prepareIdentityImport(JSON.parse(fs.readFileSync(options.input, 'utf8')));
    const summary = { mode: options.apply ? 'apply' : 'dry-run', ...prepared.summary };
    if (options.apply) {
      require('../config');
      pool = require('../db/pool').getPool();
      const repository = require('../marketingReport/marketingRepository').createMarketingRepository({ pool });
      const result = await applyIdentityImport(prepared, repository, SYSTEM_ACTOR);
      summary.batchId = result.id; summary.replayed = result.replayed;
    }
    if (options.reportFile) fs.writeFileSync(options.reportFile, JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } catch (error) {
    const code = ['INVALID_MARKETING_IMPORT', 'MARKETING_IMPORT_CONFLICT', 'MARKETING_STORAGE_ERROR'].includes(error.code) ? error.code : 'MARKETING_IMPORT_FAILED';
    process.stderr.write(JSON.stringify({ code, message: 'Identity import failed. Use --input FILE [--apply] [--report-file FILE]. No source values are logged.', rowReferences: error.rowReferences || [] }) + '\n');
    process.exitCode = 1;
  } finally { if (pool) await pool.end(); }
}

if (require.main === module) main();
module.exports = { main };
