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

test('reconcileEntity: ghep dung ket qua total KiotViet (gia) + count Postgres (gia)', async () => {
  const fakeClient = { async fetchAllPages(endpoint, query, onPage) { await onPage([], { total: 500 }); } };
  const fakePool = { async query() { return { rows: [{ count: 500 }] }; } };
  const result = await reconcileEntity(fakeClient, fakePool, 'hanoi', { entity: 'categories', endpoint: 'categories' });
  assert.equal(result.branch, 'hanoi');
  assert.equal(result.kiotVietTotal, 500);
  assert.equal(result.postgresCount, 500);
  assert.equal(result.severity, 'ok');
});
