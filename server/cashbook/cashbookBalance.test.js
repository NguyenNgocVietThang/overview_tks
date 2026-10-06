'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { balanceAt } = require('./cashbookBalance');
const cp = {
  accountId: null,
  checkpointAt: '2026-10-02T00:00:00Z',
  balance: 100,
};
const entries = [
  { accountId: null, transDate: '2026-10-01T00:00:00Z', amount: 10, status: 0 },
  { accountId: null, transDate: cp.checkpointAt, amount: 20, status: 0 },
  {
    accountId: null,
    transDate: '2026-10-03T00:00:00Z',
    amount: -30,
    status: 0,
  },
  {
    accountId: null,
    transDate: '2026-10-04T00:00:00Z',
    amount: 999,
    status: 1,
  },
  { accountId: 7, transDate: '2026-10-03T00:00:00Z', amount: 999, status: 0 },
];
test('unchốt quỹ trả null', () =>
  assert.equal(balanceAt(null, [], entries, '2026-10-05T00:00:00Z'), null));
test('tiền mặt chỉ cộng phiếu sau mốc và bỏ hủy, giữ dấu chi âm', () =>
  assert.equal(balanceAt(null, [cp], entries, '2026-10-05T00:00:00Z'), 70));
test('đầu kỳ trước mốc tính lùi cả phiếu đúng mốc', () =>
  assert.equal(balanceAt(null, [cp], entries, '2026-10-01T12:00:00Z'), 80));
test('nhiều chốt lấy mốc mới nhất trước thời điểm cần tính', () => {
  const next = { ...cp, checkpointAt: '2026-10-04T00:00:00Z', balance: 200 };
  assert.equal(
    balanceAt(null, [cp, next], entries, '2026-10-05T00:00:00Z'),
    200,
  );
  assert.equal(
    balanceAt(null, [cp, next], entries, '2026-10-03T12:00:00Z'),
    70,
  );
});
