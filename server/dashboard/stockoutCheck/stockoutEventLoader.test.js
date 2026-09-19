'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const CONFIG = require('../../config');
const { loadStockoutEvents, STALE_SYNC_THRESHOLD_MS } = require('./stockoutEventLoader');

const NOW = new Date('2026-01-11T12:00:00Z');
const FRESH_AT = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();
const FRESH_SYNC = ['products', 'invoices', 'purchases', 'returns']
  .map((entity) => ({ entity, lastSuccessAt: FRESH_AT }));

// Nguon Postgres gia: movements = { invoices: [...], purchases: [...], customerReturns: [...] },
// moi phan tu la { code, dateKey, quantity } giong stockoutPgSource.listStockMovements().
function makeSource({ movements = {}, syncStatus = FRESH_SYNC, errors = {} } = {}, calls) {
  return {
    async listStockMovements(query) {
      calls.push(query);
      if (errors[query.kind]) throw errors[query.kind];
      return movements[query.kind] || [];
    },
    async getSyncStatus() {
      if (errors.syncStatus) throw errors.syncStatus;
      return syncStatus;
    }
  };
}

function makeSheetsClient(sheetValues, calls) {
  return {
    async getMultipleSheetValues(names) {
      calls.push(names.slice());
      return Object.fromEntries(names.map(name => [name, sheetValues[name] || []]));
    }
  };
}

function emptySheets() {
  return {
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái']]
  };
}

function makeDeps({ source: sourceOptions = {}, sheets = emptySheets() } = {}) {
  const sourceCalls = [];
  const sheetCalls = [];
  return {
    deps: {
      source: makeSource(sourceOptions, sourceCalls),
      sheetsClient: makeSheetsClient(sheets, sheetCalls),
      validCodeSet: new Set(['SP001']),
      fromDate: '2026-01-09',
      toDate: '2026-01-11',
      now: NOW
    },
    sourceCalls,
    sheetCalls
  };
}

test('ba nguon Postgres thanh cong va Trả NCC luon lay Sheet dung mot lan', async () => {
  const sheets = emptySheets();
  sheets[CONFIG.SHEET_SUPPLIER_RETURNS].push(['SP001', '09/01/2026', 1, 'Hoàn thành']);
  const fixture = makeDeps({
    sheets,
    source: {
      movements: {
        invoices: [{ code: 'SP001', dateKey: '2026-01-10', quantity: 2 }],
        purchases: [{ code: 'SP001', dateKey: '2026-01-10', quantity: 3 }],
        customerReturns: [{ code: 'SP001', dateKey: '2026-01-10', quantity: 4 }]
      }
    }
  });

  const result = await loadStockoutEvents(fixture.deps);

  assert.deepEqual(fixture.sourceCalls.map(call => call.kind), ['invoices', 'purchases', 'customerReturns']);
  for (const call of fixture.sourceCalls) {
    assert.equal(call.fromDate, '2026-01-09');
    assert.equal(call.toDate, '2026-01-11');
    assert.equal(call.codes, fixture.deps.validCodeSet);
  }
  assert.deepEqual(fixture.sheetCalls, [[CONFIG.SHEET_SUPPLIER_RETURNS]]);
  assert.deepEqual(result.sources, {
    invoices: 'postgres',
    purchases: 'postgres',
    customerReturns: 'postgres',
    supplierReturns: 'google-sheets'
  });
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.eventMapByCode.get('SP001'), [
    { dateKey: '2026-01-10', delta: -2, source: 'invoices' },
    { dateKey: '2026-01-10', delta: 3, source: 'purchases' },
    { dateKey: '2026-01-10', delta: 4, source: 'customerReturns' },
    { dateKey: '2026-01-09', delta: -1, source: 'supplierReturns' }
  ]);
});

test('bo qua ma khong nam trong validCodeSet du nguon tra ve', async () => {
  const fixture = makeDeps({
    source: { movements: { invoices: [{ code: 'SP999', dateKey: '2026-01-10', quantity: 5 }] } }
  });
  const result = await loadStockoutEvents(fixture.deps);
  assert.equal(result.eventMapByCode.size, 0);
});

test('Postgres tra ve rong van thanh cong, chi Tra NCC bi thieu du lieu moi canh bao', async () => {
  const fixture = makeDeps();
  const result = await loadStockoutEvents(fixture.deps);

  assert.equal(result.eventMapByCode.size, 0);
  assert.deepEqual(fixture.sheetCalls, [[CONFIG.SHEET_SUPPLIER_RETURNS]]);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Trả NCC/);
});

test('doc hoa don tu Postgres loi lam loader loi luon, khong con fallback Sheet', async () => {
  const fixture = makeDeps({ source: { errors: { invoices: new Error('invoice query timeout') } } });
  await assert.rejects(loadStockoutEvents(fixture.deps), /Hóa đơn.*invoice query timeout/);
  assert.deepEqual(fixture.sheetCalls, []);
});

test('doc nhap hang tu Postgres loi lam loader loi luon', async () => {
  const fixture = makeDeps({ source: { errors: { purchases: new Error('forbidden') } } });
  await assert.rejects(loadStockoutEvents(fixture.deps), /Nhập hàng.*forbidden/);
});

test('doc khach tra hang tu Postgres loi lam toan bo loader loi', async () => {
  const fixture = makeDeps({ source: { errors: { customerReturns: new Error('returns timeout') } } });
  await assert.rejects(loadStockoutEvents(fixture.deps), /Khách trả hàng.*returns timeout/);
});

test('canh bao khi thuc the dong bo cu hon nguong hoac chua tung dong bo', async () => {
  const staleAt = new Date(NOW.getTime() - STALE_SYNC_THRESHOLD_MS - 5 * 60 * 1000).toISOString();
  const fixture = makeDeps({
    sheets: {
      [CONFIG.SHEET_SUPPLIER_RETURNS]: [
        ['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái'],
        ['SP001', '09/01/2026', 1, 'Hoàn thành']
      ]
    },
    source: {
      syncStatus: [
        { entity: 'products', lastSuccessAt: FRESH_AT },
        { entity: 'invoices', lastSuccessAt: staleAt },
        { entity: 'purchases', lastSuccessAt: null },
        { entity: 'returns', lastSuccessAt: FRESH_AT }
      ]
    }
  });

  const result = await loadStockoutEvents(fixture.deps);

  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /Hóa đơn.*65 phút/);
  assert.match(result.warnings[1], /Nhập hàng.*chưa từng/);
});

test('Trả NCC thiếu cột Trạng thái vẫn được tính vì sheet này không có webhook, luôn là chứng từ hoàn tất', async () => {
  const sheets = {
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [
      ['Mã hàng', 'Thời gian', 'Số lượng'],
      ['SP001', '09/01/2026', 5]
    ]
  };
  const fixture = makeDeps({ sheets });

  const result = await loadStockoutEvents(fixture.deps);

  assert.deepEqual(result.eventMapByCode.get('SP001'), [{ dateKey: '2026-01-09', delta: -5, source: 'supplierReturns' }]);
  assert.deepEqual(result.warnings, []);
});

test('Trả NCC chỉ có dữ liệu muộn hơn mốc cần tính thì cảnh báo độ phủ dữ liệu', async () => {
  const sheets = {
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [
      ['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái'],
      ['SP001', '10/01/2026', 5, 'Hoàn thành']
    ]
  };
  const fixture = makeDeps({ sheets }); // fromDate mac dinh la '2026-01-09', som hon du lieu

  const result = await loadStockoutEvents(fixture.deps);

  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Trả NCC.*2026-01-10.*2026-01-09/);
});

test('Trả NCC có dữ liệu từ đúng mốc cần tính thì không cảnh báo độ phủ', async () => {
  const sheets = {
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [
      ['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái'],
      ['SP001', '09/01/2026', 5, 'Hoàn thành']
    ]
  };
  const fixture = makeDeps({ sheets });

  const result = await loadStockoutEvents(fixture.deps);

  assert.deepEqual(result.warnings, []);
});
