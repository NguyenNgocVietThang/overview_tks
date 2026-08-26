'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runWithConcurrencyLimit } = require('./concurrencyPool');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('trả kết quả đúng thứ tự items, không phải thứ tự hoàn thành', async () => {
  const items = [30, 5, 20];
  const results = await runWithConcurrencyLimit(items, 3, async (ms) => {
    await delay(ms);
    return ms;
  });
  assert.deepEqual(results, [30, 5, 20]);
});

test('không chạy quá `limit` worker cùng lúc', async () => {
  const items = [1, 2, 3, 4, 5, 6];
  let active = 0;
  let maxActive = 0;

  await runWithConcurrencyLimit(items, 2, async (item) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await delay(10);
    active--;
    return item * 2;
  });

  assert.equal(maxActive <= 2, true);
});

test('mảng rỗng trả về mảng rỗng, không gọi worker', async () => {
  let calls = 0;
  const results = await runWithConcurrencyLimit([], 3, async () => {
    calls++;
  });
  assert.deepEqual(results, []);
  assert.equal(calls, 0);
});

test('limit lớn hơn số lượng items vẫn chạy đúng', async () => {
  const results = await runWithConcurrencyLimit([1, 2, 3], 10, async (item) => item + 1);
  assert.deepEqual(results, [2, 3, 4]);
});

test('worker throw lỗi thì reject toàn bộ runWithConcurrencyLimit', async () => {
  await assert.rejects(
    runWithConcurrencyLimit([1, 2, 3], 2, async (item) => {
      if (item === 2) throw new Error('boom');
      return item;
    }),
    /boom/
  );
});
