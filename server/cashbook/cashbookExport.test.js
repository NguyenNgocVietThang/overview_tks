'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { createExportFile } = require('./cashbookExport');
test('3view x2format selected columns, XLSX numeric styles and safe formula text', async () => {
  for (const view of ['balances', 'entries', 'checkpoints'])
    for (const format of ['html', 'xlsx']) {
      const key =
        view === 'entries' ? 'code' : view === 'balances' ? 'name' : 'fundName';
      const file = await createExportFile(
        view,
        format,
        [{ [key]: '=CMD()', balance: 12.5, amount: -3 }],
        `${key},${view === 'entries' ? 'amount' : 'balance'}`,
      );
      if (format === 'xlsx') {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(file.buffer);
        const sh = wb.worksheets[0];
        assert.equal(sh.columnCount, 2);
        assert.equal(sh.getCell('A2').value, "'=CMD()");
        assert.equal(typeof sh.getCell('B2').value, 'number');
        assert.ok(sh.views[0].state === 'frozen');
        assert.ok(sh.getCell('A2').border);
      } else assert.match(file.buffer.toString(), /&#39;=CMD\(\)/);
    }
});
test('html escapes contact/note content and formula leading whitespace', async () => {
  const file = await createExportFile(
    'entries',
    'html',
    [{ note: '<script>&"\'x', code: '\t=1+2' }],
    'note,code',
  );
  const html = file.buffer.toString();
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;&amp;&quot;&#39;x/);
  assert.match(html, /&#39;\t=1\+2/);
});
test('HTML uses Vietnamese money/date and red negatives, null cumulative blank', async () => {
  const file = await createExportFile(
    'entries',
    'html',
    [
      {
        amount: -1234567,
        transDate: '2026-10-01T17:30:00Z',
        runningBalance: null,
      },
    ],
    'amount,transDate,runningBalance',
  );
  const html = file.buffer.toString();
  assert.match(html, /-1\.234\.567/);
  assert.match(html, /class="negative"/);
  assert.match(html, /02\/10\/2026/);
  assert.match(html, /00:30/);
  assert.ok(!html.includes('Chưa chốt'));
  assert.match(html, /<td><\/td>/);
});
test('reject invalid views/formats/columns and oversized export with friendly400', async () => {
  for (const args of [
    ['bad', 'xlsx', []],
    ['constructor', 'xlsx', []],
    [['balances'], 'xlsx', []],
    ['entries', 'pdf', []],
    ['entries', 'xlsx', [], 'bogus'],
    ['entries', 'xlsx', [], ''],
    ['balances', 'html', Array(20001).fill({})],
  ])
    await assert.rejects(
      createExportFile(...args),
      (e) => e.statusCode === 400,
    );
});
