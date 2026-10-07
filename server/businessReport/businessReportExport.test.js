'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const ExcelJS = require('exceljs');
const svc = require('./businessReportService');
const { createExportFile, filterRows, MAX_EXPORT_ROWS } = require('./businessReportExport');
const { serviceSnapshot } = require('./testFixtures');

function customerRows() {
  return svc.buildCustomerReport(serviceSnapshot()).rows;
}

test('filterRows khach: mac dinh chi giu khach hoat dong, inactive=1 giu tat ca', () => {
  const rows = customerRows();
  const active = filterRows('customers', rows, {});
  assert.ok(active.length > 0 && active.every(r => r.active));
  assert.ok(active.length < rows.length);
  assert.equal(filterRows('customers', rows, { inactive: '1' }).length, rows.length);
});

test('filterRows: loc theo sale, co so va tim khong dau trong ten/ma', () => {
  const rows = customerRows();
  assert.deepEqual(filterRows('customers', rows, { sale: 'Khang' }).map(r => r.key).sort(), ['hanoi:KH1', 'saigon:KH1']);
  assert.deepEqual(filterRows('customers', rows, { branch: 'saigon' }).map(r => r.key), ['saigon:KH1']);
  assert.deepEqual(filterRows('customers', rows, { q: 'chi a' }).map(r => r.key), ['hanoi:KH1']);
  assert.deepEqual(filterRows('customers', rows, { q: 'kh1', sale: 'Khang', branch: 'hanoi' }).map(r => r.key), ['hanoi:KH1']);
});

test('XLSX bang sale: tieu de co dinh, thang giam dan (bo thang hien tai), tang truong null ghi "—", chan cong thuc', async () => {
  const report = svc.buildSaleReport(serviceSnapshot());
  const rows = report.rows.map(r => ({ ...r }));
  rows[0].saleName = '=CMD()';
  const file = await createExportFile('sales', 'xlsx', report, rows);
  assert.equal(file.fileName, 'TKS_Bao_cao_kinh_doanh_sales.xlsx');
  assert.match(file.mimeType, /spreadsheetml/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file.buffer);
  const sh = wb.worksheets[0];
  assert.deepEqual(sh.getRow(1).values.slice(1),
    ['Sale', 'SL Khách', 'TB 4 tháng', 'Tăng trưởng', 'Tháng hiện tại (đến 06/10)', 'T9/26', 'T8/26', 'T7/26']);
  assert.equal(sh.getCell('A2').value, "'=CMD()");
  const growthIdx = 4;
  const cells = rows.map((r, i) => sh.getRow(i + 2).getCell(growthIdx).value);
  rows.forEach((r, i) => {
    if (r.growth == null) assert.equal(cells[i], '—');
    else assert.equal(cells[i], r.growth / 100);
  });
  assert.ok(rows.some(r => r.growth == null) && rows.some(r => r.growth != null));
  assert.equal(sh.getCell('D2').numFmt, '0%');
  assert.ok(sh.views[0].state === 'frozen');
});

test('XLSX bang khach co cot co so HN/SG va level gia; thang chua co so lieu ghi 0', async () => {
  const report = svc.buildCustomerReport(serviceSnapshot());
  const file = await createExportFile('customers', 'xlsx', report, filterRows('customers', report.rows, { inactive: '1' }));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file.buffer);
  const sh = wb.worksheets[0];
  assert.deepEqual(sh.getRow(1).values.slice(1, 6), ['Mã KH', 'Tên khách', 'Cơ sở', 'Sale', 'Level giá']);
  const hn = [2, 3, 4, 5].map(i => sh.getRow(i).values.slice(1)).find(v => v[0] === 'KH1' && v[2] === 'HN');
  assert.ok(hn);
  assert.equal(hn[4], 'Level 2');
});

test('HTML bang ma hang la dashboard dung chung bo dung (co DOCTYPE + Chart + du lieu nhung)', async () => {
  const report = svc.buildProductReport(serviceSnapshot());
  const file = await createExportFile('products', 'html', report, report.rows);
  assert.equal(file.fileName, 'TKS_Bao_cao_kinh_doanh_products.html');
  assert.match(file.mimeType, /text\/html/);
  const html = file.buffer.toString();
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('Chart'));
  const b64 = /<script type="application\/octet-stream" id="report-data"[^>]*>([^<]*)<\/script>/.exec(html)[1];
  const ws = JSON.parse(zlib.gunzipSync(Buffer.from(b64, 'base64'))).worksheets[0];
  assert.deepEqual(ws.columns.slice(0, 2).map(c => c.label), ['Mã hàng', 'Tên hàng']);
  assert.equal(ws.rows[0][0], 'SP1');
});

test('xuat qua gioi han 20.000 dong, dinh dang/loai bang khong hop le thi bao loi 400', async () => {
  const report = svc.buildProductReport(serviceSnapshot());
  const many = Array.from({ length: MAX_EXPORT_ROWS + 1 }, () => report.rows[0]);
  await assert.rejects(() => createExportFile('products', 'xlsx', report, many), e => e.statusCode === 400 && e.code === 'TOO_MANY_ROWS');
  await assert.rejects(() => createExportFile('products', 'pdf', report, []), e => e.statusCode === 400);
  await assert.rejects(() => createExportFile('nope', 'xlsx', report, []), e => e.statusCode === 400);
});
