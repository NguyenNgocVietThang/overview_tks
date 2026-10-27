'use strict';
process.env.JWT_SECRET ||= 'test-secret';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||= '{}';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLocationRows, createStockLocationsService, withQuantity } = require('./stockLocationsService');

const hnHeader = ['MÃ SẢN PHẨM', 'TÊN SẢN PHẨM', 'TỔNG SL', 'MÔ TẢ', 'KHU', 'NGÀY VỀ'];
const sgHeader = ['Mã hàng', 'Tên hàng', 'TỔNG SL đã đi', 'Ghi chú hàng hóa', 'Vị trí', 'NGÀY VỀ'];

test('HN detects reordered headers below notes, preserves formatted cells, duplicate rows and zero quantity', () => {
  const result = parseLocationRows([
    ['Ghi chú đầu sheet'],
    [' khu ', ' TÊN   sản PHẨM ', 'mô tả', 'MÃ SẢN PHẨM', 'tổng\nsl', ' ngày  về '],
    ['A01', 'Đèn', 'Dòng 1\nDòng 2', '0012', '1.000', 'KK 25.7'],
    ['', 'Đèn', '', '0012', '0'],
    [], ['Kệ X', '', 'Tổng', '', '10'],
    ['', 'Hàng chưa có mã']
  ], 'HN');
  assert.deepEqual(result, [
    { code: '0012', name: 'Đèn', totalQuantity: '1.000', notes: 'Dòng 1\nDòng 2', location: 'A01', arrivalDate: 'KK 25.7' },
    { code: '0012', name: 'Đèn', totalQuantity: '0', notes: '', location: '', arrivalDate: '' },
    { code: '', name: 'Hàng chưa có mã', totalQuantity: '', notes: '', location: '', arrivalDate: '' }
  ]);
});

test('SG maps its own headers, retains quantity zero and missing position', () => {
  assert.deepEqual(parseLocationRows([sgHeader, ['0007', 'Ấm đun', '0', 'Kho mới', '']], 'SG'), [
    { code: '0007', name: 'Ấm đun', totalQuantity: '0', notes: 'Kho mới', location: '', arrivalDate: '' }
  ]);
  assert.deepEqual(parseLocationRows([sgHeader], 'SG'), []);
});

test('SG thực tế: TỔNG SL đã đi is total quantity and Vị Trí is column O', () => {
  const header = ['Mã hàng', 'Tên hàng', 'Ngày yêu cầu', 'Số thùng', 'Số cái /Thùng', 'TỔNG SL đã đi', 'Ghi chú hàng hóa', 'SỐ KG/ cái', 'Thể tích /cái (L)', 'Số tấn', 'Số m3', 'CƯỚC ĐM (350k/m3)', '', '', 'Vị Trí', 'Mã Phiếu', 'Ghi chú Tổng phiếu', 'NGÀY VỀ'];
  const values = [header, ['ADN3LYU', 'Ấm đun nước YUSSAIN 3L', '', '', '', '15', '1tx15', '', '', '', '', '', '', '', '36', '', '', '03/10/2026']];
  assert.deepEqual(parseLocationRows(values, 'SG'), [{ code: 'ADN3LYU', name: 'Ấm đun nước YUSSAIN 3L', totalQuantity: '15', notes: '1tx15', location: '36', arrivalDate: '03/10/2026' }]);
});

test('missing header columns or empty sheet produces a source error instead of empty data', () => {
  for (const values of [[], [hnHeader.slice(0, 4)], [['Mã hàng', 'Tên hàng']]]) {
    assert.throws(() => parseLocationRows(values, 'HN'), { code: 'STOCK_LOCATIONS_HEADERS_MISSING', statusCode: 503 });
  }
});

function fakeDb({ sync = null, lines = [], fail = false } = {}) {
  const calls = [];
  const db = {
    calls, sync,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (fail) throw Object.assign(new Error('secret connection string'), { code: 'ECONNREFUSED' });
      if (sql.includes('FROM sheet_snapshot_sync')) return { rows: db.sync ? [db.sync] : [] };
      return { rows: lines };
    }
  };
  return db;
}

const line = { code: '0012', name: 'Đèn', total_quantity: '1.000', notes: 'Dòng 1', location: 'A01', arrival_date: 'KK 25.7' };

test('getLocations đọc từ DB đúng cơ sở, giữ nguyên chuỗi và thứ tự, trả syncedAt/stale', async () => {
  const db = fakeDb({ sync: { last_success_at: '2026-10-17T03:00:00Z', last_error: null }, lines: [line] });
  const service = createStockLocationsService({ getDb: () => db, now: () => Date.parse('2026-10-17T03:05:00Z') });
  assert.deepEqual(await service.getLocations('SG'), {
    branch: 'SG',
    rows: [{ code: '0012', name: 'Đèn', totalQuantity: '1.000', notes: 'Dòng 1', location: 'A01', arrivalDate: 'KK 25.7', quantity: null, warnings: ['unreadable'] }],
    syncedAt: '2026-10-17T03:00:00.000Z',
    stale: false
  });
  assert.deepEqual(db.calls.map(c => c.params), [['stock_locations_sg'], ['SG']]);
  assert.match(db.calls[1].sql, /ORDER BY source_row/);
});

test('cache theo last_success_at: lần sau chỉ đọc dòng trạng thái, đồng bộ mới thì đọc lại dòng dữ liệu', async () => {
  const db = fakeDb({ sync: { last_success_at: '2026-10-17T03:00:00Z', last_error: null }, lines: [line] });
  const service = createStockLocationsService({ getDb: () => db, now: () => Date.parse('2026-10-17T03:01:00Z') });
  const first = await service.getLocations('HN');
  const second = await service.getLocations('HN');
  assert.deepEqual(second.rows, first.rows);
  assert.equal(db.calls.filter(c => c.sql.includes('stock_location_lines')).length, 1);
  assert.equal(db.calls.filter(c => c.sql.includes('FROM sheet_snapshot_sync')).length, 2);
  await service.getLocations('SG'); // cơ sở khác có cache riêng
  assert.equal(db.calls.filter(c => c.sql.includes('stock_location_lines')).length, 2);
  db.sync = { last_success_at: '2026-10-17T03:02:00Z', last_error: null };
  await service.getLocations('HN');
  assert.equal(db.calls.filter(c => c.sql.includes('stock_location_lines')).length, 3);
});

test('stale khi lần đồng bộ cuối quá cũ hoặc có lỗi gần nhất, nhưng vẫn trả dữ liệu cũ', async () => {
  const old = createStockLocationsService({ now: () => Date.parse('2026-10-17T04:00:00Z'), getDb: () =>
    fakeDb({ sync: { last_success_at: '2026-10-17T03:00:00Z', last_error: null }, lines: [line] }) });
  assert.equal((await old.getLocations('HN')).stale, true);
  const failed = createStockLocationsService({ now: () => Date.parse('2026-10-17T03:01:00Z'), getDb: () =>
    fakeDb({ sync: { last_success_at: '2026-10-17T03:00:00Z', last_error: 'x' }, lines: [line] }) });
  const result = await failed.getLocations('HN');
  assert.equal(result.stale, true);
  assert.equal(result.rows.length, 1);
});

test('chưa đồng bộ lần nào, cơ sở sai hoặc DB lỗi trả lỗi 503 gọn, không lộ chi tiết', async () => {
  const unsynced = createStockLocationsService({ getDb: () => fakeDb() });
  await assert.rejects(unsynced.getLocations('HN'), { code: 'STOCK_LOCATIONS_NOT_SYNCED', statusCode: 503 });
  await assert.rejects(unsynced.getLocations('XX'), { code: 'INVALID_BRANCH', statusCode: 503 });
  const broken = createStockLocationsService({ getDb: () => fakeDb({ fail: true }) });
  await assert.rejects(broken.getLocations('HN'), err => err.code === 'STOCK_LOCATIONS_SOURCE_UNAVAILABLE' && !/secret/.test(err.message));
});

test('withQuantity: SL luôn tính từ ghi chú theo luật thùng dùng chung, TỔNG SL của Sheets chỉ giữ nguyên làm dự phòng', () => {
  const base = { code: 'A', name: 'Hàng', totalQuantity: '999', location: 'A01', arrivalDate: '' };
  const q = notes => { const row = withQuantity({ ...base, notes }); return [row.quantity, row.warnings]; };
  assert.deepEqual(q('5T x 100'), [500, []]);
  assert.deepEqual(q('9tx14, 5tx 14'), [196, []]);
  assert.deepEqual(q('1Tx50 + 2Tx25'), [100, ['multi']]);
  assert.deepEqual(q('1Tx100 - 30'), [70, ['loose']]);
  assert.deepEqual(q(''), [0, []]);
  assert.deepEqual(q('0.5Tx100'), [null, ['badnumber']]);
  assert.deepEqual(q('vin 19/9 gọi vỏ'), [null, ['unreadable']]);
  assert.deepEqual(q('2X20'), [null, ['unreadable']]);
  assert.deepEqual(q(null), [0, []]);
  assert.equal(withQuantity({ ...base, notes: '5T x 100' }).totalQuantity, '999');
});

test('getLocations thêm quantity và warnings cho mỗi dòng, giữ nguyên các trường cũ, cache vẫn đúng', async () => {
  const lines = [line, { ...line, code: '0013', notes: '3T x 10' }, { ...line, code: '0014', notes: '1Tx5 + 1Tx6' }];
  const db = fakeDb({ sync: { last_success_at: '2026-10-17T03:00:00Z', last_error: null }, lines });
  const service = createStockLocationsService({ getDb: () => db, now: () => Date.parse('2026-10-17T03:01:00Z') });
  const { rows } = await service.getLocations('HN');
  assert.deepEqual(rows.map(r => [r.code, r.quantity, r.warnings, r.totalQuantity]), [['0012', null, ['unreadable'], '1.000'], ['0013', 30, [], '1.000'], ['0014', 11, ['multi'], '1.000']]);
  assert.deepEqual((await service.getLocations('HN')).rows, rows);
});
