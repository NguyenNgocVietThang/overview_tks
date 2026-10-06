'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const ExcelJS = require('exceljs');
const { createExportFile } = require('./cashbookExport');
// Báo cáo HTML nhúng dữ liệu dạng gzip + base64; giải nén để kiểm tra đúng số liệu.
function embedded(file) {
  const html = file.buffer.toString();
  const base64 = /<script type="application\/octet-stream" id="report-data"[^>]*>([^<]*)<\/script>/.exec(html)[1];
  return { html, data: JSON.parse(zlib.gunzipSync(Buffer.from(base64, 'base64'))).worksheets[0] };
}
test('XLSX giữ cột đã chọn, kiểu số và chặn công thức', async () => {
  for (const view of ['balances', 'entries']) {
    const key = view === 'entries' ? 'code' : 'name';
    const file = await createExportFile(
      view,
      'xlsx',
      [{ [key]: '=CMD()', balance: 12.5, amount: -3 }],
      `${key},${view === 'entries' ? 'amount' : 'balance'}`,
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer);
    const sh = wb.worksheets[0];
    assert.equal(sh.columnCount, 2);
    assert.equal(sh.getCell('A2').value, "'=CMD()");
    assert.equal(typeof sh.getCell('B2').value, 'number');
    assert.ok(sh.views[0].state === 'frozen');
    assert.ok(sh.getCell('A2').border);
  }
});
test('HTML sổ chi tiết là dashboard: KPI, ô tìm, bộ lọc, biểu đồ, bảng; thêm cột Thu/Chi bỏ phiếu hủy', async () => {
  const file = await createExportFile(
    'entries',
    'html',
    [
      { code: 'PT1', transDate: '2026-10-01T17:30:00Z', docType: 'receipt', branch: 'hanoi', amount: 1000, status: 'paid', note: '=1+2' },
      { code: 'PC1', transDate: '2026-10-02T03:00:00Z', docType: 'payment', branch: 'saigon', amount: -400, status: 'paid' },
      { code: 'PC2', transDate: '2026-10-02T04:00:00Z', docType: 'payment', branch: 'saigon', amount: -999, status: 'cancelled' },
    ],
    'code,transDate,docType,branch,amount,status,note',
    { period: '01/10/2026 – 06/10/2026', generatedAt: new Date('2026-10-06T10:00:00Z') },
  );
  assert.equal(file.fileName, 'TKS_So_quy_entries.html');
  assert.match(file.mimeType, /text\/html/);
  const { html, data } = embedded(file);
  assert.match(html, /<title>Sổ quỹ · Sổ chi tiết \(01\/10\/2026 – 06\/10\/2026\) · TOKOSI<\/title>/);
  for (const id of ['id="kpis"', 'id="q"', 'id="category"', 'id="charts"', 'id="thead"'])
    assert.ok(html.includes(id), id);
  assert.match(html, /Tổng thu[\s\S]*1\.000[\s\S]*Tổng chi[\s\S]*400/);
  assert.match(html, /Content-Security-Policy/);
  assert.deepEqual(
    data.columns.map((c) => [c.key, c.type]),
    [
      ['code', 'general'],
      ['transDate', 'date'],
      ['docType', 'general'],
      ['branch', 'general'],
      ['amount', 'number'],
      ['status', 'general'],
      ['note', 'general'],
      ['receipt', 'number'],
      ['payment', 'number'],
    ],
  );
  assert.deepEqual(data.summaryKeys, ['receipt', 'payment', 'amount']);
  assert.deepEqual(data.hints, { labelKey: 'partnerName', categoryKey: 'group' });
  // 17:30Z ngày 01 = 00:30 ngày 02 giờ VN; nhãn tiếng Việt; không thêm dấu ' chặn công thức.
  assert.deepEqual(data.rows[0], ['PT1', '2026-10-02T00:30', 'Thu', 'HN', 1000, 'Đã thanh toán', '=1+2', 1000, 0]);
  assert.deepEqual(data.rows[2].slice(-2), [0, 0]);
});
test('HTML số dư: KPI tổng tồn quỹ, HN, SG; chữ được escape khi render sẵn', async () => {
  const file = await createExportFile(
    'balances',
    'html',
    [
      { accountNo: '123', name: '<b>A</b>', balanceHanoi: 1000, balanceSaigon: -200, balance: 800 },
      { accountNo: '', name: 'Tiền mặt', balanceHanoi: 50, balanceSaigon: 0, balance: 50 },
    ],
    'accountNo,name,balanceHanoi,balanceSaigon,balance',
  );
  const { html, data } = embedded(file);
  assert.ok(!html.includes('<b>A</b>'));
  assert.match(html, /Tổng tồn quỹ<\/[\s\S]*850/);
  assert.match(html, /Tổng tồn quỹ HN[\s\S]*1\.050/);
  assert.deepEqual(data.summaryKeys, ['balance', 'balanceHanoi', 'balanceSaigon']);
  assert.deepEqual(data.rows[0], ['123', '<b>A</b>', 1000, -200, 800]);
  assert.deepEqual(data.rows[1].slice(0, 2), ['Tiền mặt', 'Tiền mặt']);
  assert.deepEqual(data.hints, { labelKey: 'accountNo' });
});
test('reject invalid views/formats/columns and oversized export with friendly400', async () => {
  for (const args of [
    ['bad', 'xlsx', []],
    ['checkpoints', 'xlsx', []],
    ['constructor', 'xlsx', []],
    [['balances'], 'xlsx', []],
    ['entries', 'pdf', []],
    ['entries', 'xlsx', [], 'bogus'],
    ['entries', 'xlsx', [], ''],
    ['balances', 'html', [], 'bank'],
    ['balances', 'html', Array(20001).fill({})],
  ])
    await assert.rejects(
      createExportFile(...args),
      (e) => e.statusCode === 400,
    );
});
