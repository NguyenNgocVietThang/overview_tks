'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEta, nearestContainer } = require('./etaParser');

const NOW = { now: new Date('2026-10-20T03:00:00Z') };

test('doc ngay ve CONT: khoang ngay lay ngay dau, suy nam gan nhat', () => {
  assert.equal(parseEta('DK 14-16/10', NOW).date, '2026-10-14');
  assert.equal(parseEta('DK 10/10', NOW).date, '2026-10-10');
  assert.equal(parseEta('dk 5 - 7 / 11', NOW).date, '2026-11-05');
  assert.equal(parseEta('14/10/2025', NOW).date, '2025-10-14');
  assert.equal(parseEta('3/1/27', NOW).date, '2027-01-03');
  assert.equal(parseEta('DK 5/2', NOW).date, '2027-02-05', 'thang 2 cach thang 10 hon 6 thang -> nam sau');
  assert.equal(parseEta('DK 20/4', NOW).date, '2026-04-20');
  assert.equal(parseEta('20.11', NOW).date, '2026-11-20');
});

test('khong doc duoc thi date=null, giu nguyen van', () => {
  assert.deepEqual(parseEta('cuối tháng', NOW), { date: null, raw: 'cuối tháng' });
  assert.deepEqual(parseEta('31/2', NOW), { date: null, raw: '31/2' });
  assert.deepEqual(parseEta(null, NOW), { date: null, raw: '' });
});

test('cont ve som nhat: dong co ngay doc duoc som nhat; khong co thi dong dau co ghi ngay, roi dong dau', () => {
  const line = (containerName, statusLabel, eta) => ({ containerName, statusLabel, eta });
  assert.deepEqual(nearestContainer([line('CONT A', '1. Chưa lịch', 'DK 14-16/11'), line('CONT B', '2', ''), line(' CONT C ', '3. Đã bốc', 'DK 28/10')], NOW),
    { containerName: 'CONT C', scheduleLabel: '3. Đã bốc DK 28/10', date: '2026-10-28' });
  assert.deepEqual(nearestContainer([line('CONT A', '1. Chưa lịch', ''), line('CONT B', '1', 'chưa có lịch')], NOW),
    { containerName: 'CONT B', scheduleLabel: '1 chưa có lịch', date: null });
  assert.deepEqual(nearestContainer([line('CONT A', '1. Chưa lịch', null)], NOW), { containerName: 'CONT A', scheduleLabel: '1. Chưa lịch', date: null });
  assert.deepEqual(nearestContainer([], NOW), { containerName: '', scheduleLabel: '', date: null });
});
