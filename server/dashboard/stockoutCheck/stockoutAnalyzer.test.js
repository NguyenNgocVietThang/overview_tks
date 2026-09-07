'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findStockoutPeriods, summarizeStockoutPeriods } = require('./stockoutAnalyzer');

function daysFrom(startDate, count, stockFn) {
  const rows = [];
  const start = new Date(startDate + 'T00:00:00Z');
  for (let i = 0; i < count; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    rows.push({ date: d.toISOString().slice(0, 10), stock: stockFn(i) });
  }
  return rows;
}

test('4 ngày liên tiếp hết hàng thì KHÔNG tính là đợt đứt hàng', () => {
  const daily = daysFrom('2026-01-01', 10, (i) => (i >= 2 && i <= 5 ? 0 : 5));
  const periods = findStockoutPeriods(daily, 5);
  assert.deepEqual(periods, []);
});

test('5 ngày liên tiếp hết hàng thì tính là 1 đợt đứt hàng', () => {
  const daily = daysFrom('2026-01-01', 10, (i) => (i >= 1 && i <= 5 ? 0 : 5));
  const periods = findStockoutPeriods(daily, 5);
  assert.equal(periods.length, 1);
  assert.deepEqual(periods[0], { fromDate: '2026-01-02', toDate: '2026-01-06', days: 5 });
});

test('nhiều đợt đứt hàng tách rời bởi ngày có hàng', () => {
  const stockByIndex = [5, 0, 0, 0, 0, 0, 0, 0, 5, 5, 0, 0, 0, 0, 0, 0, 0, 5];
  const daily = daysFrom('2026-01-01', stockByIndex.length, (i) => stockByIndex[i]);
  const periods = findStockoutPeriods(daily, 5);
  assert.equal(periods.length, 2);
  assert.equal(periods[0].days, 7);
  assert.equal(periods[1].days, 7);
});

test('đợt đứt hàng nằm ở đầu mảng vẫn được tính', () => {
  const daily = daysFrom('2026-01-01', 10, (i) => (i <= 6 ? 0 : 5));
  const periods = findStockoutPeriods(daily, 5);
  assert.equal(periods.length, 1);
  assert.deepEqual(periods[0], { fromDate: '2026-01-01', toDate: '2026-01-07', days: 7 });
});

test('đợt đứt hàng nằm ở cuối mảng vẫn được tính', () => {
  const daily = daysFrom('2026-01-01', 10, (i) => (i >= 3 ? 0 : 5));
  const periods = findStockoutPeriods(daily, 5);
  assert.equal(periods.length, 1);
  assert.deepEqual(periods[0], { fromDate: '2026-01-04', toDate: '2026-01-10', days: 7 });
});

test('tồn kho âm sau khi chuẩn hóa được coi là hết hàng', () => {
  const daily = daysFrom('2026-01-01', 8, (i) => (i >= 0 && i <= 6 ? -2 : 5));
  const periods = findStockoutPeriods(daily, 5);
  assert.equal(periods.length, 1);
  assert.equal(periods[0].days, 7);
});

test('không có ngày nào hết hàng thì trả về mảng rỗng', () => {
  const daily = daysFrom('2026-01-01', 10, () => 5);
  assert.deepEqual(findStockoutPeriods(daily, 5), []);
});

test('chỉ cộng phần của đợt hợp lệ nằm trong kỳ báo cáo', () => {
  const daily = daysFrom('2026-01-01', 10, () => 0);
  const periods = findStockoutPeriods(daily, 5, '2026-01-05', '2026-01-10');
  assert.deepEqual(periods, [{ fromDate: '2026-01-05', toDate: '2026-01-10', days: 6 }]);
});

test('summarizeStockoutPeriods cộng dồn số đợt và tổng số ngày', () => {
  const periods = [
    { fromDate: '2026-01-01', toDate: '2026-01-09', days: 9 },
    { fromDate: '2026-03-01', toDate: '2026-03-23', days: 23 }
  ];
  assert.deepEqual(summarizeStockoutPeriods(periods), { stockoutCount: 2, totalStockoutDays: 32 });
});

test('summarizeStockoutPeriods với mảng rỗng trả về 0/0', () => {
  assert.deepEqual(summarizeStockoutPeriods([]), { stockoutCount: 0, totalStockoutDays: 0 });
});
