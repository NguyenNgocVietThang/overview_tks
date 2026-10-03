'use strict';
process.env.JWT_SECRET ||= 'test-secret';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||= '{}';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLocationRows, createStockLocationsService } = require('./stockLocationsService');

const hnHeader = ['MÃ SẢN PHẨM', 'TÊN SẢN PHẨM', 'TỔNG SL', 'MÔ TẢ', 'KHU'];
const sgHeader = ['Mã hàng', 'Tên hàng', 'TỔNG SL đã đi', 'Ghi chú hàng hóa', 'Vị trí'];

test('HN detects reordered headers below notes, preserves formatted cells, duplicate rows and zero quantity', () => {
  const result = parseLocationRows([
    ['Ghi chú đầu sheet'],
    [' khu ', ' TÊN   sản PHẨM ', 'mô tả', 'MÃ SẢN PHẨM', 'tổng\nsl'],
    ['A01', 'Đèn', 'Dòng 1\nDòng 2', '0012', '1.000'],
    ['', 'Đèn', '', '0012', '0'],
    [], ['Kệ X', '', 'Tổng', '', '10'],
    ['', 'Hàng chưa có mã']
  ], 'HN');
  assert.deepEqual(result, [
    { code: '0012', name: 'Đèn', totalQuantity: '1.000', notes: 'Dòng 1\nDòng 2', location: 'A01' },
    { code: '0012', name: 'Đèn', totalQuantity: '0', notes: '', location: '' },
    { code: '', name: 'Hàng chưa có mã', totalQuantity: '', notes: '', location: '' }
  ]);
});

test('SG maps its own headers, retains quantity zero and missing position', () => {
  assert.deepEqual(parseLocationRows([sgHeader, ['0007', 'Ấm đun', '0', 'Kho mới', '']], 'SG'), [
    { code: '0007', name: 'Ấm đun', totalQuantity: '0', notes: 'Kho mới', location: '' }
  ]);
  assert.deepEqual(parseLocationRows([sgHeader], 'SG'), []);
});

test('SG thực tế: TỔNG SL đã đi is total quantity and Vị Trí is column O', () => {
  const header = ['Mã hàng', 'Tên hàng', 'Ngày yêu cầu', 'Số thùng', 'Số cái /Thùng', 'TỔNG SL đã đi', 'Ghi chú hàng hóa', 'SỐ KG/ cái', 'Thể tích /cái (L)', 'Số tấn', 'Số m3', 'CƯỚC ĐM (350k/m3)', '', '', 'Vị Trí', 'Mã Phiếu', 'Ghi chú Tổng phiếu'];
  const values = [header, ['ADN3LYU', 'Ấm đun nước YUSSAIN 3L', '', '', '', '15', '1tx15', '', '', '', '', '', '', '', '36']];
  assert.deepEqual(parseLocationRows(values, 'SG'), [{ code: 'ADN3LYU', name: 'Ấm đun nước YUSSAIN 3L', totalQuantity: '15', notes: '1tx15', location: '36' }]);
});

test('actual HN tab title is case-insensitive and reads the title returned by Google', async () => {
  const service = createStockLocationsService({ getSpreadsheetId: () => 'id', client: {
    listSheetTitles: async () => ['VỊ TRÍ HN'],
    getValues: async title => { assert.equal(title, 'VỊ TRÍ HN'); return [hnHeader]; }
  } });
  assert.deepEqual(await service.getLocations('HN'), { branch: 'HN', rows: [] });
});

test('missing header columns or empty sheet produces a source error instead of empty data', () => {
  for (const values of [[], [hnHeader.slice(0, 4)], [['Mã hàng', 'Tên hàng']]]) {
    assert.throws(() => parseLocationRows(values, 'HN'), { code: 'STOCK_LOCATIONS_HEADERS_MISSING', statusCode: 503 });
  }
});

test('only reads selected sheet in formatted mode, coalesces concurrent reads but rereads after completion', async () => {
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const client = {
    listSheetTitles: async () => ['Vị trí HN', 'Vị trí SG'],
    getValues: async (name, options) => { calls.push({ name, options }); await gate; return [name === 'Vị trí HN' ? hnHeader : sgHeader]; }
  };
  const service = createStockLocationsService({ client, getSpreadsheetId: () => 'workbook' });
  const first = service.getLocations('HN');
  assert.equal(first, service.getLocations('HN'));
  const sg = service.getLocations('SG');
  release();
  assert.deepEqual(await first, { branch: 'HN', rows: [] });
  await sg;
  assert.deepEqual(calls, [
    { name: 'Vị trí HN', options: { valueRenderOption: 'FORMATTED_VALUE' } },
    { name: 'Vị trí SG', options: { valueRenderOption: 'FORMATTED_VALUE' } }
  ]);
  await service.getLocations('HN');
  assert.equal(calls.length, 3);
});

test('missing configuration/sheet and failed reads are explicit, and a failure does not poison retries', async () => {
  const client = { listSheetTitles: async () => [], getValues: async () => assert.fail('must not read absent sheet') };
  const missingConfig = createStockLocationsService({ client, getSpreadsheetId: () => null });
  assert.throws(() => missingConfig.getLocations('HN'), { code: 'STOCK_LOCATIONS_NOT_CONFIGURED' });
  const missingSheet = createStockLocationsService({ client, getSpreadsheetId: () => 'id' });
  await assert.rejects(missingSheet.getLocations('SG'), { code: 'STOCK_LOCATIONS_SHEET_MISSING' });
  let attempts = 0;
  const retry = createStockLocationsService({ getSpreadsheetId: () => 'id', client: {
    listSheetTitles: async () => ['Vị trí HN'],
    getValues: async () => { if (++attempts === 1) throw Object.assign(new Error('private Google error'), { code: 403 }); return [hnHeader]; }
  } });
  await assert.rejects(retry.getLocations('HN'), { code: 'STOCK_LOCATIONS_SOURCE_UNAVAILABLE', statusCode: 503 });
  assert.deepEqual(await retry.getLocations('HN'), { branch: 'HN', rows: [] });
});
