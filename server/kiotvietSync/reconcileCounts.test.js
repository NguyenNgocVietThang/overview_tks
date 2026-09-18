'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeDiff, fetchKiotVietTotal, fetchPostgresCount, reconcileEntity } = require('./reconcileCounts');

test('computeDiff: diff=0 la ok cho moi entity', () => {
  assert.equal(computeDiff('invoices', 100, 100).severity, 'ok');
  assert.equal(computeDiff('invoices', 100, 100).diff, 0);
});

test('computeDiff: invoices/categories lech du nho van la loi cung (khong nam trong danh sach tolerant)', () => {
  const result = computeDiff('invoices', 1000, 999);
  assert.equal(result.severity, 'error');
  assert.equal(result.diff, 1);
});

test('computeDiff: orders/returns duoc phep lech nho (<=1%), chi canh bao khong phai loi', () => {
  const smallDiff = computeDiff('orders', 10000, 9995); // 0.05%
  assert.equal(smallDiff.severity, 'ok');
  const bigDiff = computeDiff('orders', 10000, 9800); // 2%
  assert.equal(bigDiff.severity, 'warn');
});

test('fetchKiotVietTotal: dung ngay sau trang dau, lay dung total (client gia)', async () => {
  let calls = 0;
  const fakeClient = {
    async fetchAllPages(endpoint, query, onPage) {
      calls++;
      await onPage([], { total: 12345 });
    }
  };
  const total = await fetchKiotVietTotal(fakeClient, { endpoint: 'invoices' });
  assert.equal(total, 12345);
  assert.equal(calls, 1);
});

test('fetchPostgresCount: goi dung SQL COUNT theo branch, dung tham so (pool gia)', async () => {
  const calls = [];
  const fakePool = { async query(sql, params) { calls.push([sql, params]); return { rows: [{ count: 42 }] }; } };
  const count = await fetchPostgresCount(fakePool, { entity: 'invoices' }, 'hanoi');
  assert.equal(count, 42);
  assert.match(calls[0][0], /SELECT COUNT\(\*\)::int AS count FROM invoices WHERE branch = \$1/);
  assert.deepEqual(calls[0][1], ['hanoi']);
});

test('fetchKiotVietTotal: cash_flows LUON goi 2 lan (isReceipt=true/false) va cong lai, du khong co since (phat hien loi that 2026-09-16: goi khong isReceipt tra total sai)', async () => {
  const queries = [];
  const fakeClient = {
    async fetchAllPages(endpoint, query, onPage) {
      queries.push({ endpoint, query });
      await onPage([], { total: query.isReceipt === 'true' ? 100 : 30 });
    }
  };
  const total = await fetchKiotVietTotal(fakeClient, { entity: 'cash_flows', endpoint: 'cashflow' });
  assert.equal(total, 130);
  assert.equal(queries.length, 2);
  assert.equal(queries[0].query.isReceipt, 'true');
  assert.equal(queries[1].query.isReceipt, 'false');
  assert.ok(queries[0].query.startDate, 'phai co startDate ngay ca khi khong truyen since (fallback ve moc rat som)');
  assert.ok(queries[0].query.endDate);
});

test('fetchKiotVietTotal: cash_flows dung since lam startDate khi co truyen', async () => {
  const queries = [];
  const fakeClient = { async fetchAllPages(endpoint, query, onPage) { queries.push(query); await onPage([], { total: 1 }); } };
  await fetchKiotVietTotal(fakeClient, { entity: 'cash_flows', endpoint: 'cashflow' }, { since: '2026-06-01T00:00:00Z' });
  assert.equal(queries[0].startDate, '2026-06-01T00:00:00Z');
  assert.equal(queries[1].startDate, '2026-06-01T00:00:00Z');
});

test('fetchKiotVietTotal: entity co backfillRangeParam (invoices/purchases) dung since lam moc duoi khi co truyen, LUON kem ca moc tren (KiotViet bo qua fromXDate neu thieu toXDate)', async () => {
  const queries = [];
  const fakeClient = { async fetchAllPages(endpoint, query, onPage) { queries.push(query); await onPage([], { total: 1 }); } };
  await fetchKiotVietTotal(fakeClient, { entity: 'invoices', endpoint: 'invoices', backfillRangeParam: { from: 'fromPurchaseDate', to: 'toPurchaseDate' } }, { since: '2026-06-01T00:00:00Z' });
  assert.equal(queries[0].fromPurchaseDate, '2026-06-01T00:00:00Z');
  assert.ok(queries[0].toPurchaseDate, 'phai luon kem toPurchaseDate, khong duoc thieu');
});

test('fetchKiotVietTotal: entity hasUpperBound:false (orders/returns) dung incrementalParam lam moc duoi khi co since', async () => {
  const queries = [];
  const fakeClient = { async fetchAllPages(endpoint, query, onPage) { queries.push(query); await onPage([], { total: 1 }); } };
  await fetchKiotVietTotal(fakeClient, { entity: 'orders', endpoint: 'orders', hasUpperBound: false, incrementalParam: 'lastModifiedFrom' }, { since: '2026-06-01T00:00:00Z' });
  assert.deepEqual(queries[0], { lastModifiedFrom: '2026-06-01T00:00:00Z' });
});

test('fetchKiotVietTotal: khong co since thi cac entity khac van goi khong loc (tron doi), giu nguyen hanh vi cu', async () => {
  const queries = [];
  const fakeClient = { async fetchAllPages(endpoint, query, onPage) { queries.push(query); await onPage([], { total: 1 }); } };
  await fetchKiotVietTotal(fakeClient, { entity: 'orders', endpoint: 'orders', hasUpperBound: false, incrementalParam: 'lastModifiedFrom' });
  assert.deepEqual(queries[0], {});
});

test('reconcileEntity: ghep dung ket qua total KiotViet (gia) + count Postgres (gia)', async () => {
  const fakeClient = { async fetchAllPages(endpoint, query, onPage) { await onPage([], { total: 500 }); } };
  const fakePool = { async query() { return { rows: [{ count: 500 }] }; } };
  const result = await reconcileEntity(fakeClient, fakePool, 'hanoi', { entity: 'categories', endpoint: 'categories' });
  assert.equal(result.branch, 'hanoi');
  assert.equal(result.kiotVietTotal, 500);
  assert.equal(result.postgresCount, 500);
  assert.equal(result.severity, 'ok');
});
