'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadStockoutEvents, STALE_SYNC_THRESHOLD_MS } = require('./stockoutEventLoader');

const NOW = new Date('2026-01-11T12:00:00Z');
const FRESH_AT = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();
const FRESH_SYNC = ['products', 'invoices', 'purchases', 'returns']
  .map((entity) => ({ entity, lastSuccessAt: FRESH_AT }));

// Nguon Postgres gia: movements = { invoices: [...], purchases: [...], customerReturns: [...], supplierReturns: [...] },
// moi phan tu la { code, dateKey, quantity } giong stockoutPgSource.listStockMovements().
function makeSource({ movements = {}, syncStatus = FRESH_SYNC, errors = {}, supplierReturnCoverage } = {}, calls) {
  return {
    async listStockMovements(query) {
      calls.push(query);
      if (errors[query.kind]) throw errors[query.kind];
      return movements[query.kind] || [];
    },
    async getSyncStatus() {
      if (errors.syncStatus) throw errors.syncStatus;
      return syncStatus;
    },
    async getSupplierReturnCoverage() {
      if (errors.supplierReturnCoverage) throw errors.supplierReturnCoverage;
      return supplierReturnCoverage || { rowCount: 0, earliestDate: null };
    }
  };
}

function makeDeps({ source: sourceOptions = {} } = {}) {
  const sourceCalls = [];
  return {
    deps: {
      source: makeSource(sourceOptions, sourceCalls),
      validCodeSet: new Set(['SP001']),
      fromDate: '2026-01-09',
      toDate: '2026-01-11',
      now: NOW
    },
    sourceCalls
  };
}

test('bon nguon Postgres (gom Tra NCC) thanh cong, dung dau moi loai', async () => {
  const fixture = makeDeps({
    source: {
      movements: {
        invoices: [{ code: 'SP001', dateKey: '2026-01-10', quantity: 2 }],
        purchases: [{ code: 'SP001', dateKey: '2026-01-10', quantity: 3 }],
        customerReturns: [{ code: 'SP001', dateKey: '2026-01-10', quantity: 4 }],
        supplierReturns: [{ code: 'SP001', dateKey: '2026-01-09', quantity: 1 }]
      },
      supplierReturnCoverage: { rowCount: 10, earliestDate: '2026-01-01' }
    }
  });

  const result = await loadStockoutEvents(fixture.deps);

  assert.deepEqual(fixture.sourceCalls.map(call => call.kind), ['invoices', 'purchases', 'customerReturns', 'supplierReturns']);
  for (const call of fixture.sourceCalls) {
    assert.equal(call.fromDate, '2026-01-09');
    assert.equal(call.toDate, '2026-01-11');
    assert.equal(call.codes, fixture.deps.validCodeSet);
  }
  assert.deepEqual(result.sources, {
    invoices: 'postgres',
    purchases: 'postgres',
    customerReturns: 'postgres',
    supplierReturns: 'postgres'
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
    source: {
      movements: { invoices: [{ code: 'SP999', dateKey: '2026-01-10', quantity: 5 }] },
      supplierReturnCoverage: { rowCount: 10, earliestDate: '2026-01-01' }
    }
  });
  const result = await loadStockoutEvents(fixture.deps);
  assert.equal(result.eventMapByCode.size, 0);
});

test('chua import Tra NCC cho co so nay thi canh bao ro', async () => {
  const fixture = makeDeps();
  const result = await loadStockoutEvents(fixture.deps);

  assert.equal(result.eventMapByCode.size, 0);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Chưa import dữ liệu Trả NCC/);
});

test('doc hoa don tu Postgres loi lam loader loi luon', async () => {
  const fixture = makeDeps({ source: { errors: { invoices: new Error('invoice query timeout') } } });
  await assert.rejects(loadStockoutEvents(fixture.deps), /Hóa đơn.*invoice query timeout/);
});

test('doc nhap hang tu Postgres loi lam loader loi luon', async () => {
  const fixture = makeDeps({ source: { errors: { purchases: new Error('forbidden') } } });
  await assert.rejects(loadStockoutEvents(fixture.deps), /Nhập hàng.*forbidden/);
});

test('doc khach tra hang tu Postgres loi lam toan bo loader loi', async () => {
  const fixture = makeDeps({ source: { errors: { customerReturns: new Error('returns timeout') } } });
  await assert.rejects(loadStockoutEvents(fixture.deps), /Khách trả hàng.*returns timeout/);
});

test('doc Tra NCC tu Postgres loi lam toan bo loader loi', async () => {
  const fixture = makeDeps({ source: { errors: { supplierReturns: new Error('supplier returns timeout') } } });
  await assert.rejects(loadStockoutEvents(fixture.deps), /Trả NCC.*supplier returns timeout/);
});

test('canh bao khi thuc the dong bo cu hon nguong hoac chua tung dong bo', async () => {
  const staleAt = new Date(NOW.getTime() - STALE_SYNC_THRESHOLD_MS - 5 * 60 * 1000).toISOString();
  const fixture = makeDeps({
    source: {
      syncStatus: [
        { entity: 'products', lastSuccessAt: FRESH_AT },
        { entity: 'invoices', lastSuccessAt: staleAt },
        { entity: 'purchases', lastSuccessAt: null },
        { entity: 'returns', lastSuccessAt: FRESH_AT }
      ],
      supplierReturnCoverage: { rowCount: 10, earliestDate: '2026-01-01' }
    }
  });

  const result = await loadStockoutEvents(fixture.deps);

  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /Hóa đơn.*65 phút/);
  assert.match(result.warnings[1], /Nhập hàng.*chưa từng/);
});

test('Tra NCC da import nhung chi tu ngay muon hon moc can tinh thi canh bao do phu du lieu', async () => {
  const fixture = makeDeps({
    source: { supplierReturnCoverage: { rowCount: 5, earliestDate: '2026-01-10' } }
  }); // fromDate mac dinh la '2026-01-09', som hon du lieu

  const result = await loadStockoutEvents(fixture.deps);

  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Trả NCC.*2026-01-10.*2026-01-09/);
});

test('Tra NCC co du lieu tu dung moc can tinh thi khong canh bao do phu', async () => {
  const fixture = makeDeps({
    source: { supplierReturnCoverage: { rowCount: 5, earliestDate: '2026-01-09' } }
  });

  const result = await loadStockoutEvents(fixture.deps);

  assert.deepEqual(result.warnings, []);
});
