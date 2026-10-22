'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMeasureRows, createMeasureSheet } = require('./measureSheet');

const FREIGHT_HEADER = 'Cước 1 Sp\n(465/m³, 1367đ/kg)';
// Cot O (thu 15) = cuoc/chiec; cac cot I..N la cot cong thuc khong doc.
const HEADER = ['MÃ SP', 'TÊN SP', 'Mô tả', 'SL/T', 'Cân nặng', 'D', 'R', 'C', 'm3', 'kg/T', 'x', 'y', 'z', 'w', FREIGHT_HEADER];
const row = (cells, freight) => [...cells, '', '', '', '', '', '', freight];
const VALUES = [
  HEADER,
  row(['10GFED', 'Đèn', '', 280, 30.5, 81, 60, 70], 384),
  row(['10gfed', 'Trùng', '', 1, 1, 1, 1, 1], 999),
  row(['THIEU', 'Thiếu cao', '', 10, 5, 40, 30, ''], ''),
  row(['  ABC ', 'Có khoảng trắng', '', 100, 10, 50, 40, 30], 0),
  row(['T100', 'Cước chuỗi', '', 10, 5, 40, 30, 20], '1,234đ')
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

test('parseMeasureRows: freightPerUnit doc thang cot O (tieu de xuong dong), 0 hop le, trong la null, ma trung lay dong dau', () => {
  const table = parseMeasureRows(VALUES);
  assert.equal(table.get('10gfed').freightPerUnit, '384');
  assert.equal(table.get('thieu').freightPerUnit, null);
  assert.equal(table.get('abc').freightPerUnit, '0');
  assert.equal(table.get('t100').freightPerUnit, '1234');
});

test('parseMeasureRows: tieu de cot O sai/thieu -> van giu m3/kg, cuoc NULL het va freightError (khong lay nham cot khac)', () => {
  const check = values => {
    const table = parseMeasureRows(values);
    assert.match(table.freightError, /cột O/);
    assert.ok(table.size > 0);
    for (const entry of table.values()) assert.equal(entry.freightPerUnit, null);
    assert.equal(table.get('10gfed').perCarton, 280);
  };
  const bad = VALUES.map(r => [...r]);
  bad[0][14] = 'Ghi chú';
  check(bad);
  const shifted = VALUES.map(r => [...r]);
  shifted[0][14] = ''; shifted[0][13] = FREIGHT_HEADER;
  check(shifted);
  check(VALUES.map(r => r.slice(0, 8)));
  assert.equal(parseMeasureRows(VALUES).freightError, null);
});

test('parseMeasureRows: khong co hang tieu de -> loi 503', () => {
  assert.throws(() => parseMeasureRows([['a', 'b']]), { statusCode: 503, code: 'MEASURE_HEADERS_MISSING' });
});

function fakeDb({ sync = { last_success_at: '2026-10-17T03:00:00Z', last_error: null }, rows = [], fail = false } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (fail) throw Object.assign(new Error('secret'), { code: 'ECONNREFUSED' });
      if (sql.includes('FROM sheet_snapshot_sync')) return { rows: sync ? [sync] : [] };
      return { rows: rows.filter(row => params[0].includes(row.code_key)) };
    }
  };
}

const ROW = { code_key: '10gfed', per_carton: '280', m3_per_unit: '0.00121500', kg_per_unit: null };

test('lookup: đọc DB, chuẩn hóa mã, bỏ mã không có, số numeric -> Number, thiếu -> missing', async () => {
  const db = fakeDb({ rows: [ROW, { code_key: 'abc', per_carton: '100', m3_per_unit: '0.5', kg_per_unit: '0.1' }] });
  const sheet = createMeasureSheet({ getDb: () => db, now: () => Date.parse('2026-10-17T03:01:00Z') });
  const result = await sheet.lookup(['10GFED', ' 10gfed ', 'none', '']);
  assert.deepEqual([...result.keys()], ['10gfed']);
  assert.deepEqual(result.get('10gfed'), { perCarton: 280, m3PerUnit: 0.001215, kgPerUnit: null, missingVolume: false, missingWeight: true });
  assert.deepEqual(db.calls[1].params, [['10gfed', 'none']]);
});

test('lookup: danh sách mã rỗng không truy vấn bảng measures', async () => {
  const db = fakeDb();
  assert.equal((await createMeasureSheet({ getDb: () => db }).lookup([])).size, 0);
  assert.equal(db.calls.length, 1);
});

test('lookup: chưa đồng bộ -> 503 MEASURE_NOT_SYNCED; DB lỗi -> 503 gọn, không lộ chi tiết', async () => {
  await assert.rejects(createMeasureSheet({ getDb: () => fakeDb({ sync: null }) }).lookup(['a']),
    { statusCode: 503, code: 'MEASURE_NOT_SYNCED' });
  await assert.rejects(createMeasureSheet({ getDb: () => fakeDb({ fail: true }) }).lookup(['a']),
    err => err.statusCode === 503 && err.code === 'MEASURE_SOURCE_UNAVAILABLE' && !/secret/.test(err.message));
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
