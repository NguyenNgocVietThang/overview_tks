'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { paginate } = require('./pagination');

test('paginate tra ve dung so trang va cat dung doan items', () => {
  const items = Array.from({ length: 250 }, (_, i) => i + 1); // [1..250]

  const page1 = paginate(items, 1, 100);
  assert.deepEqual(page1.items, items.slice(0, 100));
  assert.equal(page1.page, 1);
  assert.equal(page1.totalPages, 3);
  assert.equal(page1.totalItems, 250);

  const page3 = paginate(items, 3, 100);
  assert.deepEqual(page3.items, items.slice(200, 250)); // trang cuoi chi con 50 phan tu

  const clampedLow = paginate(items, 0, 100);
  assert.equal(clampedLow.page, 1, 'page < 1 phai ep ve trang 1');

  const clampedHigh = paginate(items, 99, 100);
  assert.equal(clampedHigh.page, 3, 'page vuot qua totalPages phai ep ve trang cuoi');
});

test('paginate xu ly mang rong va input khong hop le ma khong throw', () => {
  const empty = paginate([], 1, 100);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.totalPages, 1);
  assert.equal(empty.totalItems, 0);

  const notArray = paginate(null, 1, 100);
  assert.deepEqual(notArray.items, []);
});
