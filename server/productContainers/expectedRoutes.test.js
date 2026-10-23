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

const FULL_USER = { vaiTro: 'Nhân viên sale', featurePermissions: { 'reports.overview.containers.full': true } };
const NO_USER = { vaiTro: 'Nhân viên sale' };

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
  assert.deepEqual(Object.keys(res.body), ['rows', 'filters', 'meta', 'fullAccess', 'otherNoteAccess']);
  assert.equal(res.body.fullAccess, false);
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
  assert.deepEqual(filterRows(ROWS, { q: 'quan zzzz' }), []); // 2 tu phai khop ca 2
  assert.deepEqual(filterRows(ROWS, { q: 'YIWU' }), []);
  assert.deepEqual(filterRows(ROWS, { q: 'TKS1' }), []);
  assert.equal(filterRows(ROWS, { sheetName: 'YIWU' }).length, 2);
  assert.equal(filterRows(ROWS, {}).length, 2);
});

test('source filter is exact, optional, and combines with container, status and existing search', () => {
  assert.deepEqual(filterRows(ROWS, { source: 'CONT TKS1' }).map(r => r.productCode), ['SKU2']);
  for (const source of ['CONT TKS', 'cont tks1', 'CONT TKS1 ', 'UNKNOWN']) {
    assert.deepEqual(filterRows(ROWS, { source }), [], source);
  }
  assert.deepEqual(filterRows(ROWS, { source: '' }), ROWS);
  assert.deepEqual(filterRows(ROWS), ROWS);
  const query = { source: 'YIWU', container: 'CONT A', status: '1.Chưa có lịch', q: 'AO THUN' };
  assert.deepEqual(filterRows(ROWS, query).map(r => r.productCode), ['SKU1']);
  for (const change of [{ source: 'CONT TKS1' }, { container: 'CONT B' }, { status: '3.Đã bốc' }, { q: 'quan jean' }, { q: 'YIWU' }]) {
    assert.deepEqual(filterRows(ROWS, { ...query, ...change }), [], JSON.stringify(change));
  }
  assert.deepEqual(filterRows(ROWS, { source: '', q: 'quan JEAN' }).map(r => r.productCode), ['SKU2']);
});

test('/export/fields rowCount uses source together with the other filters', async () => {
  const router = createExpectedArrivalsRouter({ repository: { getExpected: async () => DATA } });
  for (const [query, count] of [
    [{ source: 'CONT TKS1' }, 1],
    [{ source: 'CONT TKS' }, 0],
    [{ source: 'CONT TKS1', container: 'CONT A' }, 0],
    [{ source: 'CONT TKS1', status: '3.Đã bốc', q: 'QUAN JEAN' }, 1],
    [{ source: '' }, 2],
    [{}, 2]
  ]) {
    const res = response();
    await handler(router, '/export/fields')({ user: FULL_USER, query }, res);
    assert.equal(res.body.worksheets[0].rowCount, count, JSON.stringify(query));
  }
});

test('/export source filters actual XLSX and executed HTML with default and legacy column selections', async t => {
  const router = createExpectedArrivalsRouter({ repository: { getExpected: async () => DATA } });
  for (const columns of [undefined, 'productCode,quantity']) {
    const query = { source: 'CONT TKS1', columns };
    const xlsx = response();
    await handler(router, '/export')({ user: FULL_USER, query: { ...query, format: 'xlsx' } }, xlsx);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx.sent);
    const sheet = workbook.worksheets[0];
    assert.equal(sheet.rowCount, 2, 'header and exactly one selected-source row');
    assert.equal(sheet.columnCount, columns ? 2 : 13);
    if (columns) {
      assert.deepEqual(sheet.getRow(1).values.slice(1), ['Mã SP', 'Tổng số lượng']);
      assert.deepEqual(sheet.getRow(2).values.slice(1), ['SKU2', 7]);
    } else {
      assert.equal(sheet.getCell('A2').value, 'CONT TKS1');
      assert.equal(sheet.getCell('D2').value, 'SKU2');
    }

    const html = response();
    await handler(router, '/export')({ user: FULL_USER, query: { ...query, format: 'html' } }, html);
    const doc = await openExportHtml(html.sent, t);
    assert.equal(doc.querySelectorAll('#tbody tr').length, 1);
    assert.equal(doc.querySelectorAll('#thead th').length, columns ? 2 : 13);
    assert.match(doc.querySelector('#tbody').textContent, /SKU2/);
    assert.doesNotMatch(doc.querySelector('#tbody').textContent, /SKU1|YIWU/);
    if (columns) {
      assert.deepEqual([...doc.querySelector('#tbody tr').cells].map(td => td.textContent), ['SKU2', '7']);
    } else {
      assert.equal(doc.querySelector('#tbody tr').cells[0].textContent, 'CONT TKS1');
    }
  }
});

test('/export HTML describes source filter and escapes its text even with no matching rows', async t => {
  const router = createExpectedArrivalsRouter({ repository: { getExpected: async () => DATA } });
  const source = '<img src=x onerror="window.sourceInjected=true">';
  for (const value of ['CONT TKS1', source]) {
    const res = response();
    await handler(router, '/export')({ user: FULL_USER, query: { format: 'html', source: value } }, res);
    const doc = await openExportHtml(res.sent, t);
    assert.ok([...doc.querySelectorAll('.meta li')].some(node => node.textContent === `Nguồn ${value}`), 'source appears in report notes');
    assert.equal(doc.querySelector('.meta img'), null);
    assert.equal(doc.defaultView.sourceInjected, undefined);
  }
});

test('/export/fields cung dang business-report: title, selectionMode, worksheets[].fields, rowCount theo bo loc', async () => {
  const router = createExpectedArrivalsRouter({ repository: { getExpected: async () => DATA } });
  const res = response();
  await handler(router, '/export/fields')({ user: FULL_USER, query: { container: 'CONT A' } }, res);
  assert.equal(res.body.selectionMode, 'custom');
  assert.equal(res.body.worksheets[0].rowCount, 1);
  assert.deepEqual(res.body.worksheets[0].fields.map(f => f.label),
    ['Nguồn', 'Lịch / Trạng thái', 'Tên Cont', 'Mã SP', 'Tên SP', 'Màu sắc', 'Ghi chú sale', 'Người đặt', 'Số cái/kiện', 'Số kiện', 'Tổng số lượng', 'Giá SP (tệ)', 'Giá hàng về VN']);
  assert.deepEqual(res.body.worksheets[0].fields[0], { key: 'sheetName', label: 'Nguồn', type: 'text', selected: true });
  assert.ok(res.body.worksheets[0].fields.every(f => f.selected === true && f.key && f.type));
  assert.equal(exportFieldsFor([]).worksheets[0].rowCount, 0);
});

test('/export default xlsx places source first with original source names and numeric quantities', async () => {
  const router = createExpectedArrivalsRouter({ repository: { getExpected: async () => DATA } });
  const res = response();
  await handler(router, '/export')({ user: FULL_USER, query: {} }, res);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(res.sent);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.columnCount, 13);
  assert.equal(sheet.getCell('A1').value, 'Nguồn');
  assert.equal(sheet.getCell('A2').value, 'YIWU');
  assert.equal(sheet.getCell('A3').value, 'CONT TKS1');
  assert.equal(sheet.getCell('K2').value, 50);
  assert.equal(sheet.getCell('K3').value, 7);
});

test('/export default HTML renders source first with both original source names', async t => {
  const router = createExpectedArrivalsRouter({ repository: { getExpected: async () => DATA } });
  const res = response();
  await handler(router, '/export')({ user: FULL_USER, query: { format: 'html' } }, res);
  const doc = await openExportHtml(res.sent, t);
  assert.equal(doc.querySelectorAll('#thead th').length, 13);
  assert.equal(doc.querySelector('#thead th').dataset.columnKey, 'sheetName');
  assert.equal(doc.querySelector('#thead th button').firstChild.textContent, 'Nguồn');
  assert.deepEqual([...doc.querySelectorAll('#tbody tr')].map(tr => tr.cells[0].textContent), ['YIWU', 'CONT TKS1']);
});

test('/export sheetName,quantity selects exactly two columns in Excel and HTML', async t => {
  const router = createExpectedArrivalsRouter({ repository: { getExpected: async () => DATA } });
  const xlsx = response();
  await handler(router, '/export')({ user: FULL_USER, query: { format: 'xlsx', columns: 'sheetName,quantity' } }, xlsx);
  assert.equal(xlsx.statusCode, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsx.sent);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.columnCount, 2);
  assert.deepEqual(sheet.getRow(1).values.slice(1), ['Nguồn', 'Tổng số lượng']);
  assert.deepEqual(sheet.getRow(2).values.slice(1), ['YIWU', 50]);
  assert.deepEqual(sheet.getRow(3).values.slice(1), ['CONT TKS1', 7]);

  const html = response();
  await handler(router, '/export')({ user: FULL_USER, query: { format: 'html', columns: 'sheetName,quantity' } }, html);
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
  await handler(router, '/export')({ user: FULL_USER, query: { format: 'html' } }, html);
  const doc = await openExportHtml(html.sent, t);
  const cell = doc.querySelector('#tbody tr').cells[0];
  assert.equal(cell.textContent, source);
  assert.equal(cell.querySelector('img'), null);
  assert.equal(doc.defaultView.sourceInjected, undefined);

  const xlsx = response();
  await handler(router, '/export')({ user: FULL_USER, query: {} }, xlsx);
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

// ---- Cot gia: chi nguoi co reports.overview.containers.full ----
const PRICE_KEYS = ['listedAt', 'unitPriceCny', 'vietnamPrice'];
const PRICED = {
  ...DATA,
  rows: [
    { ...ROWS[0], status: 1, listedAt: '2026-10-01', unitPriceCny: 12.345, vietnamPrice: 45678.6 },
    { ...ROWS[1], status: 3, listedAt: null, unitPriceCny: null, vietnamPrice: null }
  ]
};
const pricedRouter = () => createExpectedArrivalsRouter({ repository: { getExpected: async () => PRICED } });

test('GET / bo listedAt/unitPriceCny/vietnamPrice khi khong co quyen, giu orderedBy, khong sua cache', async () => {
  const before = JSON.stringify(PRICED);
  const res = response();
  await handler(pricedRouter(), '/')({ user: NO_USER, query: {} }, res);
  assert.equal(res.body.fullAccess, false);
  for (const row of res.body.rows) {
    for (const key of PRICE_KEYS) assert.equal(key in row, false, key);
    assert.ok('orderedBy' in row && 'status' in row);
  }
  assert.equal(JSON.stringify(PRICED), before, 'cache objects are not mutated');
});

test('GET / tra du truong gia + fullAccess:true khi co quyen', async () => {
  const res = response();
  await handler(pricedRouter(), '/')({ user: FULL_USER, query: {} }, res);
  assert.equal(res.body.fullAccess, true);
  assert.equal(res.body.rows[0].unitPriceCny, 12.345);
  assert.equal(res.body.rows[0].vietnamPrice, 45678.6);
  assert.equal(res.body.rows[0].listedAt, '2026-10-01');
  assert.deepEqual(Object.keys(res.body), ['rows', 'filters', 'meta', 'fullAccess', 'otherNoteAccess']);
});

test('/export/fields chi liet ke cot gia khi co quyen', async () => {
  const none = response();
  await handler(pricedRouter(), '/export/fields')({ user: NO_USER, query: {} }, none);
  assert.equal(none.body.worksheets[0].fields.length, 10);
  assert.ok(!none.body.worksheets[0].fields.some(f => f.key === 'sheetName'));
  assert.ok(!none.body.worksheets[0].fields.some(f => f.key === 'unitPriceCny' || f.key === 'vietnamPrice'));
  const full = response();
  await handler(pricedRouter(), '/export/fields')({ user: FULL_USER, query: {} }, full);
  assert.deepEqual(full.body.worksheets[0].fields.slice(-2).map(f => [f.key, f.label, f.type]),
    [['unitPriceCny', 'Giá SP (tệ)', 'number'], ['vietnamPrice', 'Giá hàng về VN', 'number']]);
  assert.equal(full.body.worksheets[0].fields.length, 13);
});

test('resolveColumnKeys loai cot gia khi khong co quyen, ke ca khi duoc yeu cau', () => {
  assert.deepEqual(resolveColumnKeys('quantity,unitPriceCny'), ['quantity']);
  assert.deepEqual(resolveColumnKeys('quantity,unitPriceCny', { fullAccess: true }), ['quantity', 'unitPriceCny']);
  assert.throws(() => resolveColumnKeys('unitPriceCny,vietnamPrice'), e => e.statusCode === 400);
  assert.deepEqual(resolveColumnKeys('vietnamPrice', { fullAccess: true }), ['vietnamPrice']);
});

test('/export XLSX: cot gia dinh dang dung khi co quyen, vang mat khi khong', async () => {
  const full = response();
  await handler(pricedRouter(), '/export')({ user: FULL_USER, query: { format: 'xlsx' } }, full);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(full.sent);
  const sheet = wb.worksheets[0];
  assert.equal(sheet.columnCount, 13);
  assert.deepEqual(sheet.getRow(1).values.slice(-2), ['Giá SP (tệ)', 'Giá hàng về VN']);
  assert.equal(sheet.getCell('L2').value, 12.35);
  assert.equal(sheet.getCell('M2').value, 45679);
  assert.equal(sheet.getCell('L2').numFmt, '#,##0.00');
  assert.equal(sheet.getCell('M2').numFmt, '#,##0');
  assert.ok(sheet.getCell('L3').value === null || sheet.getCell('L3').value === '');

  const none = response();
  await handler(pricedRouter(), '/export')({ user: NO_USER, query: { format: 'xlsx' } }, none);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(none.sent);
  assert.equal(wb2.worksheets[0].columnCount, 10);

  const only = response();
  await handler(pricedRouter(), '/export')({ user: NO_USER, query: { format: 'xlsx', columns: 'productCode,unitPriceCny,vietnamPrice' } }, only);
  const wb3 = new ExcelJS.Workbook();
  await wb3.xlsx.load(only.sent);
  assert.deepEqual(wb3.worksheets[0].getRow(1).values.slice(1), ['Mã SP']);

  const bad = response();
  await handler(pricedRouter(), '/export')({ user: NO_USER, query: { format: 'xlsx', columns: 'unitPriceCny' } }, bad);
  assert.equal(bad.statusCode, 400);
});

test('/export HTML: cot gia chi xuat hien khi co quyen', async t => {
  const full = response();
  await handler(pricedRouter(), '/export')({ user: FULL_USER, query: { format: 'html' } }, full);
  const doc = await openExportHtml(full.sent, t);
  assert.deepEqual([...doc.querySelectorAll('#thead th')].map(th => th.dataset.columnKey).slice(-2), ['unitPriceCny', 'vietnamPrice']);
  const cells = [...doc.querySelector('#tbody tr').cells].map(td => td.textContent);
  assert.equal(cells.at(-2), '12.35');
  assert.equal(cells.at(-1), '45,679');

  const none = response();
  await handler(pricedRouter(), '/export')({ user: NO_USER, query: { format: 'html' } }, none);
  const doc2 = await openExportHtml(none.sent, t);
  assert.equal(doc2.querySelectorAll('#thead th').length, 10);
  const payload = String(none.sent).match(/id="report-data" data-encoding="gzip-base64">([^<]+)</)[1];
  const decoded = require('node:zlib').gunzipSync(Buffer.from(payload, 'base64')).toString('utf8');
  assert.doesNotMatch(decoded, /unitPriceCny|vietnamPrice|12.345|45678/);
});

// ---- Cot Nguon: cung quyen reports.overview.containers.full nhu cot gia ----
const SOURCE_NAMES = /YIWU|CONT TKS1/;

test('GET / khong co quyen: sheetName thanh token an danh #n nhat quan theo sheet, khong lo ten that, khong sua cache', async () => {
  const data = { ...DATA, rows: [ROWS[0], ROWS[1], { ...ROWS[0], productCode: 'SKU3', sourceRow: 4 }] };
  const before = JSON.stringify(data);
  const router = createExpectedArrivalsRouter({ repository: { getExpected: async () => data } });
  const res = response();
  await handler(router, '/')({ user: NO_USER, query: {} }, res);
  assert.deepEqual(res.body.rows.map(r => r.sheetName), ['#1', '#2', '#1']);
  assert.doesNotMatch(JSON.stringify(res.body), SOURCE_NAMES);
  assert.equal(JSON.stringify(data), before, 'cache objects are not mutated');
  assert.equal(data.rows[0].sheetName, 'YIWU');

  const full = response();
  await handler(router, '/')({ user: FULL_USER, query: {} }, full);
  assert.deepEqual(full.body.rows.map(r => r.sheetName), ['YIWU', 'CONT TKS1', 'YIWU']);
});

test('khong co quyen: ?source bi bo qua (khong loc), export khong co cot Nguon va khong co ghi chu Nguon', async t => {
  const router = createExpectedArrivalsRouter({ repository: { getExpected: async () => DATA } });
  const list = response();
  await handler(router, '/')({ user: NO_USER, query: { source: 'YIWU' } }, list);
  assert.equal(list.body.rows.length, 2);

  const fields = response();
  await handler(router, '/export/fields')({ user: NO_USER, query: { source: 'YIWU' } }, fields);
  assert.equal(fields.body.worksheets[0].rowCount, 2);

  const xlsx = response();
  await handler(router, '/export')({ user: NO_USER, query: { format: 'xlsx', source: 'YIWU' } }, xlsx);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsx.sent);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.rowCount, 3, 'header and both rows: source ignored');
  assert.equal(sheet.columnCount, 10);
  assert.ok(!sheet.getRow(1).values.includes('Nguồn'));
  assert.doesNotMatch(JSON.stringify(sheet.getSheetValues()), SOURCE_NAMES);

  const html = response();
  await handler(router, '/export')({ user: NO_USER, query: { format: 'html', source: 'YIWU' } }, html);
  const doc = await openExportHtml(html.sent, t);
  assert.equal(doc.querySelectorAll('#tbody tr').length, 2);
  assert.equal(doc.querySelectorAll('#thead th').length, 10);
  assert.ok(![...doc.querySelectorAll('#thead th')].some(th => th.dataset.columnKey === 'sheetName'));
  assert.ok(![...doc.querySelectorAll('.meta li')].some(node => /^Nguồn/.test(node.textContent)));
  const payload = String(html.sent).match(/id="report-data" data-encoding="gzip-base64">([^<]+)</)[1];
  assert.doesNotMatch(require('node:zlib').gunzipSync(Buffer.from(payload, 'base64')).toString('utf8'), SOURCE_NAMES);

  const only = response();
  await handler(router, '/export')({ user: NO_USER, query: { format: 'xlsx', columns: 'sheetName' } }, only);
  assert.equal(only.statusCode, 400);
  assert.deepEqual(resolveColumnKeys('sheetName,quantity'), ['quantity']);
  assert.deepEqual(resolveColumnKeys('sheetName,quantity', { fullAccess: true }), ['sheetName', 'quantity']);
});

test('co quyen: ?source loc /export/fields va export, GET / giu ten Nguon that', async () => {
  const router = createExpectedArrivalsRouter({ repository: { getExpected: async () => DATA } });
  const list = response();
  await handler(router, '/')({ user: FULL_USER, query: { source: 'CONT TKS1' } }, list);
  assert.deepEqual(list.body.rows.map(r => r.sheetName), ['YIWU', 'CONT TKS1'], 'GET / returns all rows (source filtering is client-side) with real names');

  const fields = response();
  await handler(router, '/export/fields')({ user: FULL_USER, query: { source: 'CONT TKS1' } }, fields);
  assert.equal(fields.body.worksheets[0].rowCount, 1);
  assert.equal(fields.body.worksheets[0].fields.length, 13);

  const xlsx = response();
  await handler(router, '/export')({ user: FULL_USER, query: { format: 'xlsx', source: 'CONT TKS1' } }, xlsx);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsx.sent);
  assert.equal(workbook.worksheets[0].rowCount, 2);
  assert.equal(workbook.worksheets[0].getCell('A2').value, 'CONT TKS1');
});


test('otherNote permission is independent, redacts API/export/search and never mutates cache', async () => {
  const secret = 'privatepurchasenote';
  const data = { ...DATA, rows: [{ ...ROWS[0], otherNote: secret }] };
  const router = createExpectedArrivalsRouter({ repository: { getExpected: async () => data } });
  const key = 'reports.products.expected.otherNote';
  for (const [user, allowed] of [[NO_USER, false], [FULL_USER, false], [{ vaiTro: 'Quản lý' }, true], [{ ...NO_USER, featurePermissions: { [key]: true } }, true], [{ vaiTro: 'Quản lý', featurePermissions: { [key]: false } }, false]]) {
    const res = response();
    await handler(router, '/')({ user, query: { otherNoteAccess: 'true' } }, res);
    assert.equal(res.body.otherNoteAccess, allowed);
    assert.equal('otherNote' in res.body.rows[0], allowed);
    const fields = response();
    await handler(router, '/export/fields')({ user, query: { q: secret } }, fields);
    assert.equal(fields.body.worksheets[0].rowCount, allowed ? 1 : 0);
    assert.equal(fields.body.worksheets[0].fields.some(f => f.key === 'otherNote'), allowed);
    const file = response();
    await handler(router, '/export')({ user, query: { columns: 'productCode,otherNote', format: 'xlsx' } }, file);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.sent);
    assert.equal(wb.worksheets[0].columnCount, allowed ? 2 : 1);
    if (allowed) assert.equal(wb.worksheets[0].getCell('B2').value, secret);
  }
  assert.equal(data.rows[0].otherNote, secret);
});
