'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeStockoutTimeline, computeStockoutWindow, maxDateKey, hasUnreliableZeroOnHand } = require('./stockoutEngine');
const { daysBetweenInclusive } = require('./stockoutAnalyzer');

test('analyzeStockoutTimeline dùng 4 ngày đệm để xác nhận đợt vắt qua biên nhưng chỉ cộng ngày trong kỳ', () => {
  const result = analyzeStockoutTimeline({
    currentOnHand: 0,
    events: [],
    todayKey: '2026-01-10',
    daysBack: 5,
    minConsecutiveDays: 5
  });

  assert.deepEqual(result.periods, [{ fromDate: '2026-01-05', toDate: '2026-01-10', days: 6 }]);
  assert.deepEqual(result.summary, { stockoutCount: 1, totalStockoutDays: 6 });
  assert.equal(result.reportFromDate, '2026-01-05');
  assert.equal(result.calculationFromDate, '2026-01-01');
});

test('analyzeStockoutTimeline giữ tồn hiện tại khi mã không có ở bất kỳ bảng giao dịch nào', () => {
  const result = analyzeStockoutTimeline({
    currentOnHand: 3,
    events: [],
    todayKey: '2026-01-10',
    daysBack: 5,
    minConsecutiveDays: 5
  });

  assert.deepEqual(result.periods, []);
  assert.deepEqual(result.summary, { stockoutCount: 0, totalStockoutDays: 0 });
});

test('computeStockoutWindow khong gioi han khi cua so yeu cau da nam sau moc san', () => {
  const window = computeStockoutWindow({
    todayKey: '2026-09-08',
    daysBack: 10,
    minConsecutiveDays: 5,
    dataFromDateFloor: '2026-06-01'
  });
  assert.equal(window.reportFromDate, '2026-08-29');
  assert.equal(window.calculationFromDate, '2026-08-25');
});

test('computeStockoutWindow ghim reportFromDate va calculationFromDate vao dataFromDateFloor khi daysBack vuot qua moc', () => {
  const window = computeStockoutWindow({
    todayKey: '2026-09-08',
    daysBack: 183,
    minConsecutiveDays: 5,
    dataFromDateFloor: '2026-06-01'
  });
  assert.equal(window.reportFromDate, '2026-06-01');
  assert.equal(window.calculationFromDate, '2026-06-01');
});

test('analyzeStockoutTimeline gioi han dot dut hang theo dataFromDateFloor khi daysBack keo dai hon moc san', () => {
  const result = analyzeStockoutTimeline({
    currentOnHand: 0,
    events: [],
    todayKey: '2026-09-08',
    daysBack: 183,
    minConsecutiveDays: 5,
    dataFromDateFloor: '2026-06-01'
  });

  assert.equal(result.reportFromDate, '2026-06-01');
  assert.equal(result.calculationFromDate, '2026-06-01');
  assert.deepEqual(result.periods, [{
    fromDate: '2026-06-01',
    toDate: '2026-09-08',
    days: daysBetweenInclusive('2026-06-01', '2026-09-08')
  }]);
});

test('maxDateKey tra ve moc muon hon, coi null/rong la khong gioi han', () => {
  assert.equal(maxDateKey('2026-06-01', '2026-08-04'), '2026-08-04');
  assert.equal(maxDateKey('2026-08-04', '2026-06-01'), '2026-08-04');
  assert.equal(maxDateKey(null, '2026-08-04'), '2026-08-04');
  assert.equal(maxDateKey('2026-08-04', null), '2026-08-04');
  assert.equal(maxDateKey(null, null), null);
});

test('hasUnreliableZeroOnHand: true khi su kien gan nhat la Nhap hang chua bi tieu thu', () => {
  const events = [
    { dateKey: '2026-08-01', delta: -5, source: 'invoices' },
    { dateKey: '2026-09-05', delta: 400, source: 'purchases' }
  ];
  assert.equal(hasUnreliableZeroOnHand(events), true);
});

test('hasUnreliableZeroOnHand: false khi su kien gan nhat khong phai Nhap hang', () => {
  const events = [
    { dateKey: '2026-08-01', delta: 50, source: 'purchases' },
    { dateKey: '2026-09-05', delta: 3, source: 'customerReturns' }
  ];
  assert.equal(hasUnreliableZeroOnHand(events), false);
});

test('hasUnreliableZeroOnHand: false khi Nhap hang trong ngay gan nhat bi tieu het cung ngay (net <= 0)', () => {
  const events = [
    { dateKey: '2026-09-05', delta: 400, source: 'purchases' },
    { dateKey: '2026-09-05', delta: -400, source: 'invoices' }
  ];
  assert.equal(hasUnreliableZeroOnHand(events), false);
});

test('hasUnreliableZeroOnHand: false khi khong co su kien nao', () => {
  assert.equal(hasUnreliableZeroOnHand([]), false);
});
