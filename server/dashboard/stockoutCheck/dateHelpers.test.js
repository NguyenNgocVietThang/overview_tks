'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { addDaysToDateKey, todayVnDateKey } = require('./dateHelpers');

test('addDaysToDateKey cong ngay duong', () => {
  assert.equal(addDaysToDateKey('2026-01-01', 5), '2026-01-06');
});

test('addDaysToDateKey tru ngay am', () => {
  assert.equal(addDaysToDateKey('2026-01-10', -9), '2026-01-01');
});

test('addDaysToDateKey qua nam moi', () => {
  assert.equal(addDaysToDateKey('2025-12-30', 3), '2026-01-02');
});

test('todayVnDateKey tra ve dung dinh dang YYYY-MM-DD', () => {
  assert.match(todayVnDateKey(), /^\d{4}-\d{2}-\d{2}$/);
});
