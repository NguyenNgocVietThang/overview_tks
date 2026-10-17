'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const aging = require('./debtAgingRules');

const TODAY = '2026-10-17';
const base = { branch: 'hanoi', customerId: '7', customerCode: 'KH7', customerName: 'Anh A', sale: 'Duy Thái' };

function amounts(map) {
  return Object.entries(map).map(([day, invoiceAmount]) => ({ day, invoiceAmount }));
}

test('vi du nguoi dung: het no 10/10, lich 5 -> ngay no tuong duong 8 (dem ca ngay het no), con han -3', () => {
  const row = aging.buildAgingRow({ ...base, scheduleDays: 5, currentDebt: 600 }, {
    today: TODAY, dailyAmounts: amounts({ '2026-10-17': 100, '2026-10-15': 200, '2026-10-10': 300, '2026-10-01': 900 })
  });
  assert.equal(row.payoffDay, '2026-10-10');
  assert.equal(row.equivalentDays, 8);
  assert.equal(row.remainingDays, -3);
  assert.equal(row.beyondHistory, false);
  assert.equal(row.branch, 'HN');
});

test('het no ngay trong hom nay -> ngay no tuong duong 1, con han = lich TT - 1', () => {
  const row = aging.buildAgingRow({ ...base, scheduleDays: 3, currentDebt: 100 }, {
    today: TODAY, dailyAmounts: amounts({ '2026-10-17': 150 })
  });
  assert.equal(row.payoffDay, TODAY);
  assert.equal(row.equivalentDays, 1);
  assert.equal(row.remainingDays, 2);
});

test('tru vua du ve 0 la het no; ngay khong co hoa don bi bo qua', () => {
  const result = aging.findPayoffDay(300, amounts({ '2026-10-12': 100, '2026-10-16': 200, '2026-10-05': 50 }), TODAY);
  assert.deepEqual(result, { payoffDay: '2026-10-12', beyondHistory: false });
});

test('no bang 0 hoac am -> 3 cot ngay de trong', () => {
  for (const debt of [0, -50000]) {
    const row = aging.buildAgingRow({ ...base, scheduleDays: 2, currentDebt: debt }, {
      today: TODAY, dailyAmounts: amounts({ '2026-10-17': 100 })
    });
    assert.equal(row.payoffDay, null);
    assert.equal(row.equivalentDays, null);
    assert.equal(row.remainingDays, null);
    assert.equal(row.overdueDebt, 0);
  }
});

test('tru het lich su van con no -> moc dau khoang tra cuu + co beyondHistory', () => {
  const row = aging.buildAgingRow({ ...base, scheduleDays: 1, currentDebt: 1000 }, {
    today: TODAY, dailyAmounts: amounts({ '2026-10-01': 100, '2025-01-01': 5000 })
  });
  assert.equal(row.beyondHistory, true);
  assert.equal(row.payoffDay, aging.agingHistoryStart(TODAY));
  assert.equal(row.equivalentDays, aging.AGING_LOOKBACK_DAYS);
  assert.equal(row.remainingDays, 1 - aging.AGING_LOOKBACK_DAYS);
});

test('khong co hoa don nao ma con no -> beyondHistory', () => {
  const result = aging.findPayoffDay(500, [], TODAY);
  assert.equal(result.beyondHistory, true);
});

test('no qua han theo quy tac cu voi moc hom nay (khong tru tra hang)', () => {
  const row = aging.buildAgingRow({ ...base, scheduleDays: 2, currentDebt: 1000 }, {
    today: TODAY, dailyAmounts: amounts({ '2026-10-17': 100, '2026-10-16': 200, '2026-10-15': 400 })
  });
  assert.equal(row.overdueDebt, 700);
});

test('khach chua co lich TT tinh 1 ngay, sale trong -> Chua phan nhom', () => {
  const row = aging.buildAgingRow({ ...base, sale: null, scheduleDays: null, currentDebt: 100 }, {
    today: TODAY, dailyAmounts: amounts({ '2026-10-15': 100 })
  });
  assert.equal(row.scheduleDays, 1);
  assert.equal(row.hasStoredSchedule, false);
  assert.equal(row.sale, 'Chưa phân nhóm');
  assert.equal(row.equivalentDays, 3);
  assert.equal(row.remainingDays, -2);
});

test('daysBetween qua ranh gioi thang/nam', () => {
  assert.equal(aging.daysBetween('2025-12-31', '2026-01-02'), 2);
  assert.equal(aging.daysBetween('2026-02-28', '2026-03-01'), 1);
});
