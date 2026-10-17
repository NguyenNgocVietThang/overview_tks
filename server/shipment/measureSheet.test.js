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
