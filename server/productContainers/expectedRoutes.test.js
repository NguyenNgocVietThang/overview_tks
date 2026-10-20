'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||= '{}';
process.env.JWT_SECRET ||= 'fixture';
const ExcelJS = require('exceljs');
const { createExpectedArrivalsRouter } = require('./expectedRoutes');
const { filterRows, resolveColumnKeys, exportFieldsFor } = require('./expectedExport');

const ROWS = [
  { scheduleLabel: '1.Chưa có lịch DK T10', statusLabel: '1.Chưa có lịch', eta: 'DK T10', containerName: 'CONT A', productCode: 'SKU1', productName: 'Áo thun', color: 'Đỏ', saleNote: 'Gấp', orderedBy: 'An', unitsPerPackage: 10, packageCount: 5, quantity: 50, sheetName: 'YIWU', sourceRow: 2 },
  { scheduleLabel: '3.Đã bốc', statusLabel: '3.Đã bốc', eta: '', containerName: 'CONT B', productCode: 'SKU2', productName: 'Quần jean', color: '', saleNote: '', orderedBy: 'Bình', unitsPerPackage: null, packageCount: null, quantity: 7, sheetName: 'SD', sourceRow: 3 }
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
  assert.equal(filterRows(ROWS, {}).length, 2);
});

test('/export/fields cung dang business-report: title, selectionMode, worksheets[].fields, rowCount theo bo loc', async () => {
  const router = createExpectedArrivalsRouter({ repository: { getExpected: async () => DATA } });
  const res = response();
  await handler(router, '/export/fields')({ query: { container: 'CONT A' } }, res);
  assert.equal(res.body.selectionMode, 'custom');
  assert.equal(res.body.worksheets[0].rowCount, 1);
  assert.deepEqual(res.body.worksheets[0].fields.map(f => f.label),
    ['Lịch / Trạng thái', 'Tên Cont', 'Mã SP', 'Tên SP', 'Màu sắc', 'Ghi chú sale', 'Người đặt', 'Số cái/kiện', 'Số kiện', 'Tổng số lượng']);
  assert.ok(res.body.worksheets[0].fields.every(f => f.selected === true && f.key && f.type));
  assert.equal(exportFieldsFor([]).worksheets[0].rowCount, 0);
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
