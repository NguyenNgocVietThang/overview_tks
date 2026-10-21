'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||= '{}';
process.env.JWT_SECRET ||= 'fixture';
const ExcelJS = require('exceljs');
const { JSDOM } = require('jsdom');
const { createExpectedArrivalsRouter } = require('./expectedRoutes');
const { filterRows, resolveColumnKeys, exportFieldsFor } = require('./expectedExport');

const ROWS = [
  { scheduleLabel: '1.Chưa có lịch DK T10', statusLabel: '1.Chưa có lịch', eta: 'DK T10', containerName: 'CONT A', productCode: 'SKU1', productName: 'Áo thun', color: 'Đỏ', saleNote: 'Gấp', orderedBy: 'An', unitsPerPackage: 10, packageCount: 5, quantity: 50, sheetName: 'YIWU', sourceRow: 2 },
  { scheduleLabel: '3.Đã bốc', statusLabel: '3.Đã bốc', eta: '', containerName: 'CONT B', productCode: 'SKU2', productName: 'Quần jean', color: '', saleNote: '', orderedBy: 'Bình', unitsPerPackage: null, packageCount: null, quantity: 7, sheetName: 'CONT TKS1', sourceRow: 3 }
];
const DATA = { rows: ROWS, filters: { containers: ['CONT A', 'CONT B'], statuses: ['1.Chưa có lịch', '3.Đã bốc'] }, meta: { computedAt: '2026-10-20T03:00:00.000Z', version: '1', rowCount: 2 } };

// Chay router that qua requireAuth/requireFeature bang JWT that khong tien nghi -> goi thang handler cuoi cung.
function handler(router, path) {
  const layer = router.stack.find(l => l.route && l.route.path === path);
  return layer.route.stack.at(-1).handle;
}
function guards(router, path) {
  return router.stack.find(l => l.route && l.route.path === path).route.stack.map(s => s.name);
}
function response() {
  return { statusCode: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(n) { this.statusCode = n; return this; }, json(d) { this.body = d; return this; }, send(b) { this.sent = b; return this; } };
}

async function openExportHtml(buffer, t) {
  const dom = new JSDOM(buffer.toString('utf8'), {
    runScripts: 'dangerously',
    beforeParse(win) {
      win.DecompressionStream = DecompressionStream;
      win.Response = Response;
      win.HTMLCanvasElement.prototype.getContext = () => null;
      win.console.error = () => {}; // Chart.js cannot draw without a jsdom canvas.
    }
  });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  for (let i = 0; i < 200 && /Đang mở dữ liệu/.test(doc.getElementById('tbody').textContent); i += 1) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.ok(doc.querySelector('#thead th'), 'HTML export renders its embedded compressed data');
  return doc;
}

test('GET / tra rows + filters + meta; loi DB tra 503 thong diep chung', async () => {
  let fail = false;
  const router = createExpectedArrivalsRouter({ repository: { getExpected: async () => { if (fail) throw new Error('postgres secret'); return DATA; } } });
  const res = response();
  await handler(router, '/')({ query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body), ['rows', 'filters', 'meta']);
  assert.equal(res.body.rows.length, 2);
  fail = true;
  const original = console.error; console.error = () => {};
  try {
    const bad = response();
    await handler(router, '/')({ query: {} }, bad);
    assert.equal(bad.statusCode, 503);
    assert.doesNotMatch(JSON.stringify(bad.body), /secret|postgres/);
  } finally { console.error = original; }
});

test('chi gac bang requireAuth + quyen reports.products.expected (khong can reports.export)', () => {
  const { requireFeature } = require('../auth/authMiddleware');
  const router = createExpectedArrivalsRouter({ repository: { getExpected: async () => DATA } });
  for (const p of ['/', '/export', '/export/fields']) assert.equal(router.stack.find(l => l.route && l.route.path === p).route.stack.length, 3, p);
  assert.ok(typeof requireFeature === 'function');
  const { hasFeature } = require('../auth/featureRegistry');
  for (const role of ['Quản lý', 'Trợ lý', 'Nhân viên sale', 'Kế toán', 'Nhân viên marketing', 'Nhân viên mua hàng', 'Nhân viên kho']) {
    assert.equal(hasFeature({ vaiTro: role }, 'reports.products.expected'), true, role);
    assert.equal(hasFeature({ vaiTro: role }, 'reports.export'), role === 'Quản lý' || role === 'Trợ lý', role);
  }
  assert.equal(hasFeature({ vaiTro: 'Khách' }, 'reports.products.expected'), false);
  assert.equal(guards(router, '/').length, 3);
});

test('loc: container / status khop chinh xac, q khong dau khong phan biet hoa thuong tren ma, ten, cont, mau, ghi chu', () => {
  assert.equal(filterRows(ROWS, { container: 'CONT A' }).length, 1);
  assert.equal(filterRows(ROWS, { container: 'CONT' }).length, 0);
  assert.equal(filterRows(ROWS, { status: '3.Đã bốc' }).length, 1);
  assert.equal(filterRows(ROWS, { status: '3.' }).length, 0);
  assert.deepEqual(filterRows(ROWS, { q: 'quan JEAN' }).map(r => r.productCode), ['SKU2']);
  assert.deepEqual(filterRows(ROWS, { q: 'do' }).map(r => r.productCode), ['SKU1']);
  assert.deepEqual(filterRows(ROWS, { q: 'gap' }).map(r => r.productCode), ['SKU1']);
  assert.deepEqual(filterRows(ROWS, { q: 'YIWU' }), []);
  assert.deepEqual(filterRows(ROWS, { q: 'TKS1' }), []);
  assert.equal(filterRows(ROWS, { sheetName: 'YIWU' }).length, 2);
  assert.equal(filterRows(ROWS, {}).length, 2);
});

test('/export/fields cung dang business-report: title, selectionMode, worksheets[].fields, rowCount theo bo loc', async () => {
  const router = createExpectedArrivalsRouter({ repository: { getExpected: async () => DATA } });
  const res = response();
  await handler(router, '/export/fields')({ query: { container: 'CONT A' } }, res);
  assert.equal(res.body.selectionMode, 'custom');
  assert.equal(res.body.worksheets[0].rowCount, 1);
  assert.deepEqual(res.body.worksheets[0].fields.map(f => f.label),
    ['Nguồn', 'Lịch / Trạng thái', 'Tên Cont', 'Mã SP', 'Tên SP', 'Màu sắc', 'Ghi chú sale', 'Người đặt', 'Số cái/kiện', 'Số kiện', 'Tổng số lượng']);
  assert.deepEqual(res.body.worksheets[0].fields[0], { key: 'sheetName', label: 'Nguồn', type: 'text', selected: true });
  assert.ok(res.body.worksheets[0].fields.every(f => f.selected === true && f.key && f.type));
  assert.equal(exportFieldsFor([]).worksheets[0].rowCount, 0);
});

test('/export default xlsx places source first with original source names and numeric quantities', async () => {
  const router = createExpectedArrivalsRouter({ repository: { getExpected: async () => DATA } });
  const res = response();
  await handler(router, '/export')({ query: {} }, res);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(res.sent);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.columnCount, 11);
  assert.equal(sheet.getCell('A1').value, 'Nguồn');
  assert.equal(sheet.getCell('A2').value, 'YIWU');
  assert.equal(sheet.getCell('A3').value, 'CONT TKS1');
  assert.equal(sheet.getCell('K2').value, 50);
  assert.equal(sheet.getCell('K3').value, 7);
});

test('/export default HTML renders source first with both original source names', async t => {
  const router = createExpectedArrivalsRouter({ repository: { getExpected: async () => DATA } });
  const res = response();
  await handler(router, '/export')({ query: { format: 'html' } }, res);
  const doc = await openExportHtml(res.sent, t);
  assert.equal(doc.querySelectorAll('#thead th').length, 11);
  assert.equal(doc.querySelector('#thead th').dataset.columnKey, 'sheetName');
  assert.equal(doc.querySelector('#thead th button').firstChild.textContent, 'Nguồn');
  assert.deepEqual([...doc.querySelectorAll('#tbody tr')].map(tr => tr.cells[0].textContent), ['YIWU', 'CONT TKS1']);
});

test('/export sheetName,quantity selects exactly two columns in Excel and HTML', async t => {
  const router = createExpectedArrivalsRouter({ repository: { getExpected: async () => DATA } });
  const xlsx = response();
  await handler(router, '/export')({ query: { format: 'xlsx', columns: 'sheetName,quantity' } }, xlsx);
  assert.equal(xlsx.statusCode, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsx.sent);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.columnCount, 2);
  assert.deepEqual(sheet.getRow(1).values.slice(1), ['Nguồn', 'Tổng số lượng']);
  assert.deepEqual(sheet.getRow(2).values.slice(1), ['YIWU', 50]);
  assert.deepEqual(sheet.getRow(3).values.slice(1), ['CONT TKS1', 7]);

  const html = response();
  await handler(router, '/export')({ query: { format: 'html', columns: 'sheetName,quantity' } }, html);
  assert.equal(html.statusCode, 200);
  const doc = await openExportHtml(html.sent, t);
  assert.deepEqual([...doc.querySelectorAll('#thead th')].map(th => th.dataset.columnKey), ['sheetName', 'quantity']);
  assert.deepEqual([...doc.querySelectorAll('#tbody tr')].map(tr => [...tr.cells].map(td => td.textContent)), [['YIWU', '50'], ['CONT TKS1', '7']]);
});

test('/export escapes source HTML and protects source text from Excel formulas', async t => {
  const source = '<img src=x onerror="window.sourceInjected=true"> & \'Nguồn\'';
  const data = { ...DATA, rows: [{ ...ROWS[0], sheetName: source }, { ...ROWS[1], sheetName: '=1+1' }] };
  const router = createExpectedArrivalsRouter({ repository: { getExpected: async () => data } });
  const html = response();
  await handler(router, '/export')({ query: { format: 'html' } }, html);
  const doc = await openExportHtml(html.sent, t);
  const cell = doc.querySelector('#tbody tr').cells[0];
  assert.equal(cell.textContent, source);
  assert.equal(cell.querySelector('img'), null);
  assert.equal(doc.defaultView.sourceInjected, undefined);

  const xlsx = response();
  await handler(router, '/export')({ query: {} }, xlsx);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsx.sent);
  assert.equal(workbook.worksheets[0].getCell('A2').value, source);
  assert.equal(workbook.worksheets[0].getCell('A3').value, "'=1+1");
});

test('/export xlsx theo bo loc + cot chon; html; format/cot sai => 400', async () => {
  const router = createExpectedArrivalsRouter({ repository: { getExpected: async () => DATA } });
  const res = response();
  await handler(router, '/export')({ query: { format: 'xlsx', status: '3.Đã bốc', columns: 'productCode,quantity' } }, res);
  assert.match(res.headers['Content-Disposition'], /\.xlsx"/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(res.sent);
  const sheet = workbook.worksheets[0];
  assert.deepEqual(sheet.getRow(1).values.slice(1), ['Mã SP', 'Tổng số lượng']);
  assert.equal(sheet.rowCount, 2);
  assert.deepEqual(sheet.getRow(2).values.slice(1), ['SKU2', 7]);

  const html = response();
  await handler(router, '/export')({ query: { format: 'html', container: 'CONT A' } }, html);
  assert.match(html.headers['Content-Disposition'], /\.html"/);
  const payload = String(html.sent).match(/id="report-data" data-encoding="gzip-base64">([^<]+)</)[1];
  const decoded = require('node:zlib').gunzipSync(Buffer.from(payload, 'base64')).toString('utf8');
  assert.match(decoded, /SKU1/);
  assert.doesNotMatch(decoded, /SKU2/);

  for (const query of [{ format: 'pdf' }, { format: 'xlsx', columns: 'khong_co' }, { format: 'xlsx', columns: ',' }]) {
    const bad = response();
    await handler(router, '/export')({ query }, bad);
    assert.equal(bad.statusCode, 400, JSON.stringify(query));
  }
  assert.deepEqual(resolveColumnKeys('quantity,productCode'), ['productCode', 'quantity']);
  assert.equal(resolveColumnKeys(undefined), null);
});
