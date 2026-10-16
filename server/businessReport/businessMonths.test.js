'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('./businessMonths');

test('khoa thang, cong thang, danh sach thang, nhan cot', () => {
  assert.equal(m.monthKey('2026-10-06'), '2026-10-01');
  assert.equal(m.addMonths('2026-01-01', -1), '2025-12-01');
  assert.equal(m.addMonths('2026-10-01', 3), '2027-01-01');
  assert.deepEqual(m.monthsBetween('2026-03-01', '2026-05-01'), ['2026-03-01', '2026-04-01', '2026-05-01']);
  assert.deepEqual(m.monthsBetween('2026-05-01', '2026-03-01'), []);
  assert.equal(m.monthLabel('2026-03-01'), 'T3/26');
});

test('parseClosedMonth: chi nhan YYYY-MM da ket thuc (lich VN), tu T3/2026', () => {
  const now = new Date('2026-10-07T03:00:00Z');
  assert.equal(m.parseClosedMonth('2026-09', now), '2026-09-01');
  assert.equal(m.parseClosedMonth('2026-03', now), '2026-03-01');
  const bad = (value, pattern, at = now) => assert.throws(() => m.parseClosedMonth(value, at),
    e => e.statusCode === 400 && pattern.test(e.message), String(value));
  for (const v of [undefined, null, '', '2026-9', '2026-09-01', '09-2026', '2026-13', '2026-00', ' 2026-09']) bad(v, /định dạng YYYY-MM/);
  bad('2026-02', /tháng đã qua, từ T3\/2026/);
  bad('2026-10', /tháng đã qua/); // thang dang chay
  bad('2026-11', /tháng đã qua/);
  // 23:30 UTC 30/09 = 06:30 VN 01/10 => thang 9 da ket thuc; 16:59 UTC 30/09 = 23:59 VN => chua
  assert.equal(m.parseClosedMonth('2026-09', new Date('2026-09-30T23:30:00Z')), '2026-09-01');
  bad('2026-09', /tháng đã qua/, new Date('2026-09-30T16:59:00Z'));
});

test('ngay VN tinh ca hom nay; 23:30 UTC ngay 5 la ngay 6 o VN', () => {
  assert.equal(m.vnToday(new Date('2026-10-05T23:30:00Z')), '2026-10-06');
  assert.equal(m.dayOfMonth('2026-10-06'), 6);
});

test('quy doi 30 ngay va tang truong theo vi du cua nguoi dung', () => {
  // 7 ngay dau thang 10 ban 100tr, thang 9 ban 500tr => 100*30/7/500 = 85,71%
  const normalized = m.normalizeTo30Days(100e6, 7);
  assert.ok(Math.abs(normalized - 428571428.5714) < 1);
  assert.ok(Math.abs(m.growthPct(normalized, 500e6) - 85.714) < 0.01);
  // Anh mau: Trinh 2.098.305.500 ngay 06/10, T9 7.891.382.769 => 133%
  assert.equal(Math.round(m.growthPct(m.normalizeTo30Days(2098305500, 6), 7891382769)), 133);
});

test('thang truoc <= 0 thi tang truong null (UI hien —)', () => {
  assert.equal(m.growthPct(1000, 0), null);
  assert.equal(m.growthPct(1000, -5), null);
});

test('TB 4 thang = (3 thang chot + quy doi thang nay) / 4, thang thieu = 0', () => {
  assert.equal(m.avg4Months([100, 200, 300], 400), 250);
  assert.equal(m.avg4Months([100], 300), 100);
});

test('buildMetrics lay dung thang truoc va 3 thang gan nhat', () => {
  const series = { '2026-07-01': 300, '2026-08-01': 600, '2026-09-01': 900, '2026-10-01': 100 };
  const r = m.buildMetrics(series, '2026-10-01', 10);
  assert.deepEqual(r, { current: 100, normalized: 300, prev: 900, growth: 300 / 900 * 100, avg4: (900 + 600 + 300 + 300) / 4 });
});
