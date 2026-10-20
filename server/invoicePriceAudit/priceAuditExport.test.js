'use strict';

// Xuat file "Kiem tra gia ban": cung catalog cot voi bang, toan bo tap da loc (khong chi trang 1),
// dung cot da chon, tien la so (giu so goc), chong formula injection, metadata cua so / lan chay / tong.

const test = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET ||= 'fixture';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||= '{}';
const ExcelJS = require('exceljs');
const express = require('express');
const { resolvePermissions } = require('../auth/featureRegistry');
const { COLUMNS, BUSINESS_KEYS, exportValue } = require('./priceAuditColumns');
const { createPriceAuditExport, resolveColumnKeys, exportFieldsFor } = require('./priceAuditExport');
const { createPriceAuditRouter } = require('./priceAuditRoutes');

const META = {
  available: true, windowFrom: '2026-10-14', windowTo: '2026-10-20', lastSuccessAt: '2026-10-20T16:02:00.000Z',
  lastAttemptAt: '2026-10-20T16:02:00.000Z', lastError: null, addedInvoiceCount: 12
};

function line(i, over = {}) {
  return {
    soldAt: '2026-10-19T08:00:00', branch: i % 2 ? 'saigon' : 'hanoi', invoiceCode: 'HD' + String(i).padStart(5, '0'),
    saleName: 'Duy Thái', customerName: 'Khách ' + i, productCode: 'T100', productName: 'Ly giữ nhiệt', customerLevel: 'Vừa',
    quantity: '100', totalCodeQuantity: '300', fullVat: false, netUnitPrice: '23000.5', minimumUnitPrice: '24000',
    unitShortfall: '999.5', effectiveAmount: '99950', effectiveStatus: 'wrong', saleExplanation: null, decision: null,
    customerCode: 'KH' + i, customerEmail: 'vua@x', sourceLineNo: 1, originalUnitPrice: '25000', unitDiscount: '1999.5',
    cartonSizeHn: '100', quantityPriceHn: '23800', levelPriceHn: '24000', vatHn: '0', minimumHn: '23800',
    freightEligible: false, freightPerUnit: '0', cartonSizeSg: null, quantityPriceSg: null, levelPriceSg: null,
    vatSg: null, minimumSg: null, winningSource: 'HN', reason: 'Theo giá quy định', productNoteHn: 'T100 # 1T-24000',
    productNoteSg: null, lineNote: null, invoiceNote: null, originalStatus: 'wrong', originalAmount: '99950',
    decidedBy: null, decidedAt: null, capturedAt: '2026-10-19T16:00:00.000Z', invoiceId: String(1000 + i), version: 1,
    ...over
  };
}

async function readSheet(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.worksheets;
}

test('catalog: 18 cot nghiep vu dung thu tu muc 2.1, 16 hien mac dinh, cot doi chieu dat sau', () => {
  assert.deepEqual(BUSINESS_KEYS, ['soldAt', 'branch', 'invoiceCode', 'saleName', 'customerName', 'productCode', 'productName',
    'customerLevel', 'quantity', 'totalCodeQuantity', 'fullVat', 'netUnitPrice', 'minimumUnitPrice', 'unitShortfall',
    'effectiveAmount', 'effectiveStatus', 'saleExplanation', 'decision']);
  assert.deepEqual(COLUMNS.slice(0, 18).map(c => c.key), BUSINESS_KEYS);
  assert.equal(COLUMNS.filter(c => c.defaultVisible).length, 16);
  assert.deepEqual(COLUMNS.filter(c => BUSINESS_KEYS.includes(c.key) && !c.defaultVisible).map(c => c.key), ['totalCodeQuantity', 'unitShortfall']);
  assert.equal(COLUMNS.find(c => c.key === 'effectiveAmount').label, 'Tiền chênh / phạt');
  assert.ok(COLUMNS.length > 18 && COLUMNS.slice(18).every(c => !c.defaultVisible));
  assert.equal(new Set(COLUMNS.map(c => c.key)).size, COLUMNS.length, 'khoa cot khong trung');
});

test('exportValue: thieu gia = rong (khong ep 0), 0 = so 0, nhan tieng Viet cho co so / ket qua / chot', () => {
  const byKey = k => COLUMNS.find(c => c.key === k);
  assert.equal(exportValue({ minimumUnitPrice: null }, byKey('minimumUnitPrice')), '');
  assert.equal(exportValue({ effectiveAmount: '0' }, byKey('effectiveAmount')), 0);
  assert.equal(exportValue({ branch: 'saigon' }, byKey('branch')), 'SG');
  assert.equal(exportValue({ effectiveStatus: 'correct' }, byKey('effectiveStatus')), 'Đúng giá');
  assert.equal(exportValue({ decision: null }, byKey('decision')), 'Chưa chốt');
  assert.equal(exportValue({ decision: 'penalty' }, byKey('decision')), 'Phạt');
  assert.equal(exportValue({ fullVat: true }, byKey('fullVat')), 'Có');
  assert.equal(exportValue({ soldAt: '2026-10-19T00:10:00' }, byKey('soldAt')), '19/10/2026 00:10', 'khong dich mui gio');
});

test('resolveColumnKeys: whitelist theo catalog, giu thu tu catalog; bo trong = cot mac dinh', () => {
  assert.deepEqual(resolveColumnKeys('decision,invoiceCode'), ['invoiceCode', 'decision']);
  assert.deepEqual(resolveColumnKeys(undefined), COLUMNS.filter(c => c.defaultVisible).map(c => c.key));
  assert.throws(() => resolveColumnKeys('invoiceCode,password'), err => err.statusCode === 400);
  assert.throws(() => resolveColumnKeys(''), err => err.statusCode === 400);
});

test('exportFieldsFor: cung dang hop thoai Xuat file, selected = hien mac dinh', () => {
  const fields = exportFieldsFor(250);
  assert.equal(fields.worksheets[0].rowCount, 250);
  assert.deepEqual(fields.worksheets[0].fields.map(f => f.key), COLUMNS.map(c => c.key));
  assert.equal(fields.worksheets[0].fields.filter(f => f.selected).length, 16);
});

test('XLSX: dung cot da chon, tien la so goc, null de trong, chong formula injection, sheet thong tin co cua so/lan chay/tong', async () => {
  const rows = [
    line(1, { saleExplanation: '=HYPERLINK("http://evil","x")', customerName: '+SUM(A1)' }),
    line(2, { minimumUnitPrice: null, effectiveAmount: '0', effectiveStatus: 'correct', originalStatus: 'correct', reason: 'Không có giá quy định' })
  ];
  const file = await createPriceAuditExport({
    rows, columns: ['invoiceCode', 'customerName', 'minimumUnitPrice', 'effectiveAmount', 'saleExplanation'], format: 'xlsx',
    meta: { ...META, kpis: { invoiceCount: 2, correctLines: 1, wrongLines: 1, pendingAmount: '99950', penaltyAmount: '0', effectiveAmount: '99950' }, filters: { status: 'wrong' } }
  });
  assert.match(file.mimeType, /spreadsheetml/);
  assert.match(file.fileName, /\.xlsx$/);
  const [sheet, info] = await readSheet(file.buffer);
  assert.deepEqual(sheet.getRow(1).values.slice(1), ['Mã hóa đơn', 'Khách hàng', 'Giá min áp dụng', 'Tiền chênh / phạt', 'Sale giải thích']);
  assert.equal(sheet.rowCount, 3);
  const r1 = sheet.getRow(2).values.slice(1);
  assert.equal(r1[1], "'+SUM(A1)");
  assert.equal(r1[4], `'=HYPERLINK("http://evil","x")`);
  assert.equal(r1[2], 24000);
  assert.equal(r1[3], 99950);
  const r2 = sheet.getRow(3);
  assert.equal(r2.getCell(3).value, null, 'thieu gia de trong');
  assert.equal(r2.getCell(4).value, 0, '0 la so 0');
  assert.ok(info, 'co sheet thong tin');
  const infoText = info.getSheetValues().flat().filter(v => typeof v === 'string' || typeof v === 'number').join('|');
  assert.match(infoText, /14\/10\/2026/);
  assert.match(infoText, /20\/10\/2026/);
  assert.match(infoText, /Sai giá/);
  assert.match(infoText, /99950|99,950/);
});

test('HTML: dung renderHtmlReport, ten file .html, co ghi chu cua so du lieu', async () => {
  const file = await createPriceAuditExport({ rows: [line(1)], columns: ['invoiceCode', 'effectiveAmount'], format: 'html', meta: META });
  assert.match(file.mimeType, /text\/html/);
  assert.match(file.fileName, /\.html$/);
  const html = file.buffer.toString('utf8');
  assert.match(html, /Kiểm tra giá bán/);
  assert.match(html, /14\/10\/2026/);
});

test('dinh dang khong hop le -> 400', async () => {
  await assert.rejects(createPriceAuditExport({ rows: [], columns: null, format: 'csv', meta: META }), err => err.statusCode === 400);
});

// ---- Router: /export lay TOAN BO tap loc (khong chi trang 1), can reports.export ----

function fakeRepository(all) {
  const calls = [];
  return {
    calls,
    async readState() { return { published_day: '2026-10-20', window_from: '2026-10-14', window_to: '2026-10-20' }; },
    async readReport(query) {
      calls.push(query);
      const filtered = all.filter(r => !query.status || r.effectiveStatus === query.status);
      const start = (query.page - 1) * query.pageSize;
      return { meta: META, filters: { applied: query, options: { sales: [] } },
        kpis: { invoiceCount: filtered.length, correctLines: 0, wrongLines: filtered.length, pendingAmount: '1', penaltyAmount: '0', effectiveAmount: '1' },
        totals: {}, rows: filtered.slice(start, start + query.pageSize), totalRows: filtered.length, page: query.page, pageSize: query.pageSize };
    }
  };
}

function makeApp(repository) {
  const users = {
    ql: { id: 'ql', vaiTro: 'Quản lý', hoTen: 'QL', featurePermissions: {} },
    sale: { id: 'sale', vaiTro: 'Nhân viên sale', hoTen: 'Duy Thái', featurePermissions: {} }
  };
  const requireAuth = (req, res, next) => {
    const stored = users[req.headers['x-user']];
    if (!stored) return res.status(401).json({ error: 'x' });
    req.user = { ...stored, permissions: resolvePermissions(stored) };
    return next();
  };
  const resolveBranch = (req, res, next) => { req.branch = 'Cả hai'; next(); };
  const app = express();
  app.use('/api/invoice-price-audit', createPriceAuditRouter({ service: { getReport: async () => ({ rows: [] }) }, repository, requireAuth, resolveBranch }));
  return app;
}

async function withServer(app, fn) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try { return await fn(`http://127.0.0.1:${server.address().port}/api/invoice-price-audit`); } finally { await new Promise(r => server.close(r)); }
}

test('GET /export: xuat 130 dong da loc (vuot trang 1), cung bo loc, cot da chon; Sale khong co reports.export bi 403', async () => {
  const all = Array.from({ length: 140 }, (_, i) => line(i + 1, i < 130 ? {} : { effectiveStatus: 'correct' }));
  const repo = fakeRepository(all);
  await withServer(makeApp(repo), async base => {
    const sale = await fetch(base + '/export?format=xlsx', { headers: { 'x-user': 'sale' } });
    assert.equal(sale.status, 403);
    const res = await fetch(base + '/export?format=xlsx&status=wrong&page=1&pageSize=25&columns=invoiceCode,effectiveAmount', { headers: { 'x-user': 'ql' } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /\.xlsx/);
    const [sheet] = await readSheet(Buffer.from(await res.arrayBuffer()));
    assert.equal(sheet.rowCount, 131, 'tieu de + 130 dong sai gia');
    assert.deepEqual(sheet.getRow(1).values.slice(1), ['Mã hóa đơn', 'Tiền chênh / phạt']);
    assert.equal(repo.calls.at(-1).status, 'wrong');
    const fields = await (await fetch(base + '/export/fields?status=wrong', { headers: { 'x-user': 'ql' } })).json();
    assert.equal(fields.worksheets[0].rowCount, 130);
    const bad = await fetch(base + '/export?format=xlsx&from=2026-01-01', { headers: { 'x-user': 'ql' } });
    assert.equal(bad.status, 400, 'ngay ngoai cua so');
  });
});

