'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseKiotVietDateTime, toKiotVietDateTimeParam, todayInVietnam } = require('./vietnamTime');

test('parseKiotVietDateTime dien giai chuoi naive cua KiotViet la gio Viet Nam (+07:00)', () => {
  const parsed = parseKiotVietDateTime('2026-08-30T10:15:00');
  assert.equal(parsed.toISOString(), '2026-08-30T03:15:00.000Z');
});

test('parseKiotVietDateTime xu ly duoc chuoi co mili giay', () => {
  const parsed = parseKiotVietDateTime('2026-08-30T10:15:00.500');
  assert.equal(parsed.toISOString(), '2026-08-30T03:15:00.500Z');
});

test('toKiotVietDateTimeParam chuyen Date/epoch UTC thanh chuoi naive gio Viet Nam', () => {
  const param = toKiotVietDateTimeParam(new Date('2026-08-30T03:15:00.000Z'));
  assert.equal(param, '2026-08-30T10:15:00');
});

test('toKiotVietDateTimeParam roll-trip voi parseKiotVietDateTime', () => {
  const original = '2026-08-30T10:15:00';
  const roundTripped = toKiotVietDateTimeParam(parseKiotVietDateTime(original));
  assert.equal(roundTripped, original);
});

test('todayInVietnam tra ve ngay da roll-over sang hom sau khi UTC van con hom truoc (bay loi +07:00 kinh dien)', () => {
  // 2026-08-30T18:00:00Z + 7h = 2026-08-31T01:00:00 gio VN -> da sang ngay moi
  const result = todayInVietnam(new Date('2026-08-30T18:00:00.000Z'));
  assert.equal(result, '2026-08-31');
});

test('todayInVietnam tra ve cung ngay khi chua qua moc roll-over', () => {
  // 2026-08-30T10:00:00Z + 7h = 2026-08-30T17:00:00 gio VN -> van cung ngay
  const result = todayInVietnam(new Date('2026-08-30T10:00:00.000Z'));
  assert.equal(result, '2026-08-30');
});

test('todayInVietnam mac dinh dung thoi diem hien tai neu khong truyen tham so', () => {
  const result = todayInVietnam();
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
});
