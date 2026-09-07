'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeStockoutTimeline } = require('./stockoutEngine');

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
