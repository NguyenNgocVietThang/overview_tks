'use strict';
const fs = require('node:fs');
const { captureHistorySnapshot } = require('../marketingReport/marketingHistoryImport');
async function main() {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--output' || !args[1] || args[1].startsWith('--')) throw new Error();
    const snapshot = await captureHistorySnapshot();
    // Capture contains private source data. Never overwrite an existing capture.
    fs.writeFileSync(args[1], JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 });
    process.stdout.write(JSON.stringify({ capturedAt: snapshot.capturedAt, workbooks: Object.fromEntries(Object.entries(snapshot.workbooks).map(([kind, workbook]) => [kind, { workbookId: workbook.workbookId, tabs: Object.keys(workbook.sheets).length }])) }) + '\n');
  } catch { process.stderr.write('MARKETING_CAPTURE_FAILED: use --output FILE and configured readonly Sheets credentials; no source values are logged.\n'); process.exitCode = 1; }
}
if (require.main === module) main();
