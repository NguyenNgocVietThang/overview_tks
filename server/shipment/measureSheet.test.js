'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMeasureRows, createMeasureSheet } = require('./measureSheet');

const HEADER = ['MÃ SP', 'TÊN SP', 'Mô tả', 'SL/T', 'Cân nặng', 'D', 'R', 'C'];
const VALUES = [
  HEADER,
  ['10GFED', 'Đèn', '', 280, 30.5, 81, 60, 70],
  ['10gfed', 'Trùng', '', 1, 1, 1, 1, 1],
  ['THIEU', 'Thiếu cao', '', 10, 5, 40, 30, ''],
  ['  ABC ', 'Có khoảng trắng', '', 100, 10, 50, 40, 30]
];

test('parseMeasureRows: m3 va kg moi cai, lay hang dau khi trung ma (khong phan biet hoa/thuong)', () => {
  const table = parseMeasureRows(VALUES);
  const entry = table.get('10gfed');
  assert.equal(entry.perCarton, 280);
  assert.ok(Math.abs(entry.m3PerUnit - (81 * 60 * 70 / 1e6) / 280) < 1e-12);
  assert.ok(Math.abs(entry.kgPerUnit - 30.5 / 280) < 1e-12);
  assert.equal(table.get('abc').perCarton, 100);
});

test('parseMeasureRows: thieu kich thuoc/SL-thung -> missing', () => {
  assert.equal(parseMeasureRows(VALUES).get('thieu').m3PerUnit, null);
  assert.equal(parseMeasureRows(VALUES).get('thieu').kgPerUnit, 0.5);
});

test('parseMeasureRows: khong co hang tieu de -> loi 503', () => {
  assert.throws(() => parseMeasureRows([['a', 'b']]), { statusCode: 503, code: 'MEASURE_HEADERS_MISSING' });
});

function fakeClient(counter, values = VALUES) {
  return {
    listSheetTitles: async () => ['CÂN ĐO', 'Hoa'],
    getValues: async () => { counter.n += 1; return values; }
  };
}

test('lookup: tra ma co, bo ma khong co; cache TTL va gop request dang chay', async () => {
  const counter = { n: 0 };
  let t = 0;
  const sheet = createMeasureSheet({ getSpreadsheetId: () => 'x', client: fakeClient(counter), now: () => t, ttlMs: 1000 });
  const [a, b] = await Promise.all([sheet.lookup(['10GFED', 'none']), sheet.lookup(['abc'])]);
  assert.ok(a.has('10gfed') && !a.has('none') && b.has('abc'));
  assert.equal(counter.n, 1);
  t = 500; await sheet.lookup(['abc']);
  assert.equal(counter.n, 1);
  t = 2000; await sheet.lookup(['abc']);
  assert.equal(counter.n, 2);
});

test('lookup: loi Google -> 503 gon, khong lo chi tiet', async () => {
  const client = { listSheetTitles: async () => { const e = new Error('secret'); e.response = { status: 403 }; throw e; }, getValues: async () => [] };
  const sheet = createMeasureSheet({ getSpreadsheetId: () => 'x', client });
  await assert.rejects(sheet.lookup(['a']), err => err.statusCode === 503 && err.code === 'MEASURE_SOURCE_UNAVAILABLE' && !/secret/.test(err.message));
});

test('lookup: chua cau hinh id -> 503 MEASURE_NOT_CONFIGURED', async () => {
  const sheet = createMeasureSheet({ getSpreadsheetId: () => null, client: fakeClient({ n: 0 }) });
  await assert.rejects(sheet.lookup(['a']), { statusCode: 503, code: 'MEASURE_NOT_CONFIGURED' });
});

test('parseMeasureRows preserves partial measures and marks absent conversion', () => {
  const table = parseMeasureRows([HEADER,
    ['WEIGHT', '', '', 10, 5, 40, 30, ''],
    ['VOLUME', '', '', 10, '', 40, 30, 20],
    ['NOCOUNT', '', '', '', 5, 40, 30, 20]
  ]);
  assert.equal(table.get('weight').m3PerUnit, null);
  assert.equal(table.get('weight').kgPerUnit, 0.5);
  assert.ok(Math.abs(table.get('volume').m3PerUnit - 0.0024) < 1e-12);
  assert.equal(table.get('volume').kgPerUnit, null);
  assert.equal(table.get('nocount').m3PerUnit, null);
  assert.equal(table.get('nocount').kgPerUnit, null);
});
