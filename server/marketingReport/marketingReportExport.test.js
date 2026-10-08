const test = require('node:test');
const assert = require('node:assert/strict');
const { createExportFile, tableRows, exportFieldsFor, resolveColumnKeys } = require('./marketingReportExport');

const result = {
  computedAt: '2026-10-08T09:00:00Z',
  summaryRows: [{ key: 'a', label: 'Hữu Nghị', count: 2, revenue: 1500 }, { key: 'b', label: 'Sài Gòn', count: 1, revenue: 0 }],
  rows: [{ key: 'r1', sale: 'Đặng An', phone: '0901', revenue: 1000, note: '=cmd' }, { key: 'r2', sale: 'Bình', phone: '0902', revenue: 500 }]
};

test('fields follow on-screen columns and q filters without accents', () => {
  const rows = tableRows('rows', result, 'dang an');
  assert.equal(rows.length, 1);
  const meta = exportFieldsFor('monthly', 'rows', result, rows);
  assert.equal(meta.worksheets[0].rowCount, 1);
  assert.ok(meta.worksheets[0].fields.some(f => f.key === 'note'));
  const summary = exportFieldsFor('monthly', 'summary', result, result.summaryRows).worksheets[0].fields.map(f => f.key);
  assert.deepEqual(summary, ['label', 'count', 'revenue']);
});

test('columns whitelist rejects unknown or empty keys', () => {
  assert.deepEqual(resolveColumnKeys('monthly', 'rows', result, 'revenue,sale'), ['sale', 'revenue']);
  assert.equal(resolveColumnKeys('monthly', 'rows', result, undefined), null);
  assert.throws(() => resolveColumnKeys('monthly', 'rows', result, 'evil'), { statusCode: 400 });
  assert.throws(() => resolveColumnKeys('monthly', 'rows', result, ''), { statusCode: 400 });
});

test('xlsx and html files are produced; formula-like text is neutralised', async () => {
  const xlsx = await createExportFile('monthly', 'rows', 'xlsx', result, result.rows, ['sale', 'note']);
  assert.match(xlsx.fileName, /\.xlsx$/);
  assert.ok(xlsx.buffer.length > 100);
  const html = await createExportFile('monthly', 'summary', 'html', result, result.summaryRows, null);
  assert.match(html.fileName, /\.html$/);
  await assert.rejects(createExportFile('nope', 'rows', 'xlsx', result, [], null), { statusCode: 400 });
});
