'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStockoutPgSource, MOVEMENT_QUERIES, PRODUCTS_QUERY } = require('./stockoutPgSource');

function makePool(rowsFor) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: rowsFor(sql, params) };
    }
  };
}

test('listProducts map dong SQL ve { code, name, isActive, onHand, createdDate } theo co so', async () => {
  const pool = makePool(() => [
    { code: 'SP001', name: 'Hang A', is_active: true, on_hand: '12', created_date: '2026-08-04T09:44:00.0000000' },
    { code: 'SP002', name: 'Hang B', is_active: null, on_hand: 0, created_date: null }
  ]);
  const source = createStockoutPgSource({ pool, branch: 'Sài Gòn' });

  const products = await source.listProducts();

  assert.equal(pool.calls[0].sql, PRODUCTS_QUERY);
  assert.deepEqual(pool.calls[0].params, ['saigon']);
  assert.deepEqual(products, [
    { code: 'SP001', name: 'Hang A', isActive: true, onHand: 12, createdDate: '2026-08-04T09:44:00.0000000' },
    { code: 'SP002', name: 'Hang B', isActive: null, onHand: 0, createdDate: null }
  ]);
});

test('listStockMovements dung dung cau SQL, trang thai hoan thanh va tham so tung loai chung tu', async () => {
  const pool = makePool(() => [{ code: 'SP001', date_key: '2026-01-10', quantity: '7' }]);
  const source = createStockoutPgSource({ pool, branch: 'Hà Nội' });

  const movements = await source.listStockMovements({
    kind: 'invoices', codes: new Set(['SP001', 'SP002']), fromDate: '2026-01-01', toDate: '2026-01-31'
  });

  assert.deepEqual(movements, [{ code: 'SP001', dateKey: '2026-01-10', quantity: 7 }]);
  assert.equal(pool.calls[0].sql, MOVEMENT_QUERIES.invoices);
  assert.deepEqual(pool.calls[0].params, ['hanoi', ['SP001', 'SP002'], '2026-01-01', '2026-01-31']);
  assert.match(MOVEMENT_QUERIES.invoices, /FROM invoice_details d[\s\S]*h\.status = 1/);
  assert.match(MOVEMENT_QUERIES.purchases, /FROM purchase_details d[\s\S]*h\.status = 3/);
  assert.match(MOVEMENT_QUERIES.customerReturns, /FROM return_details d[\s\S]*h\.return_date/);
  assert.match(MOVEMENT_QUERIES.customerReturns, /h\.status = 1/);
  // Ngay giao dich phai doc theo gio treo tuong (UTC), khong doi sang Asia/Ho_Chi_Minh.
  assert.match(MOVEMENT_QUERIES.invoices, /AT TIME ZONE 'UTC'/);
  assert.doesNotMatch(MOVEMENT_QUERIES.invoices, /Asia\/Ho_Chi_Minh/);
});

test('listStockMovements khong truy van khi khong co ma hang nao', async () => {
  const pool = makePool(() => { throw new Error('khong duoc goi'); });
  const source = createStockoutPgSource({ pool, branch: 'Hà Nội' });

  assert.deepEqual(await source.listStockMovements({ kind: 'invoices', codes: new Set(), fromDate: 'a', toDate: 'b' }), []);
  assert.equal(pool.calls.length, 0);
});

test('listStockMovements tu choi loai chung tu la', async () => {
  const source = createStockoutPgSource({ pool: makePool(() => []), branch: 'Hà Nội' });
  await assert.rejects(
    source.listStockMovements({ kind: 'orders', codes: ['SP001'], fromDate: 'a', toDate: 'b' }),
    /Loại chứng từ không hợp lệ/
  );
});

test('getSyncStatus tra ve du 4 thuc the, thieu checkpoint thi lastSuccessAt = null', async () => {
  const at = new Date('2026-01-11T10:00:00Z');
  const pool = makePool(() => [{ entity: 'invoices', last_success_at: at }]);
  const source = createStockoutPgSource({ pool, branch: 'Hà Nội' });

  assert.deepEqual(await source.getSyncStatus(), [
    { entity: 'products', lastSuccessAt: null },
    { entity: 'invoices', lastSuccessAt: at },
    { entity: 'purchases', lastSuccessAt: null },
    { entity: 'returns', lastSuccessAt: null }
  ]);
  assert.deepEqual(pool.calls[0].params, ['hanoi', ['products', 'invoices', 'purchases', 'returns']]);
});

test('co so khong hop le bi tu choi voi 400', () => {
  assert.throws(
    () => createStockoutPgSource({ pool: makePool(() => []), branch: 'Đà Nẵng' }),
    (error) => error.code === 'INVALID_BRANCH' && error.statusCode === 400
  );
});
