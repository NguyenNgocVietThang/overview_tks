'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runWithConcurrencyLimit } = require('./runWithConcurrencyLimit');

// Tao 1 "tac vu co the dieu khien duoc": tu ghi lai luc bat dau (started, resolve
// duoc tu ben ngoai de biet no da chay), roi cho (`gate`) den khi test chu dong
// mo khoa (`release`). Khong dung setTimeout/sleep - chi dua vao microtask, nen
// test khong phu thuoc thoi gian thuc.
function createControlledTask(id, running) {
  let releaseFn;
  let startedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  const gate = new Promise((resolve) => { releaseFn = resolve; });
  const fn = async () => {
    running.add(id);
    startedResolve();
    await gate;
    running.delete(id);
    return `done-${id}`;
  };
  return { fn, started, release: releaseFn };
}

test('limit=2: toi da 2 tac vu chay cung luc tai bat ky thoi diem nao', async () => {
  const running = new Set();
  const tasks = [];
  for (let i = 0; i < 5; i++) tasks.push(createControlledTask(i, running));

  const resultPromise = runWithConcurrencyLimit(tasks.map((t) => t.fn), 2);

  await Promise.all([tasks[0].started, tasks[1].started]);
  assert.equal(running.size, 2);
  assert.deepEqual([...running].sort(), [0, 1]);

  tasks[0].release();
  await tasks[2].started;
  assert.equal(running.size, 2);
  assert.deepEqual([...running].sort(), [1, 2]);

  tasks[1].release();
  await tasks[3].started;
  assert.equal(running.size, 2);
  assert.deepEqual([...running].sort(), [2, 3]);

  tasks[2].release();
  await tasks[4].started;
  assert.equal(running.size, 2);
  assert.deepEqual([...running].sort(), [3, 4]);

  tasks[3].release();
  tasks[4].release();
  const results = await resultPromise;
  assert.equal(results.length, 5);
  assert.ok(results.every((r) => r.status === 'fulfilled'));
});

test('1 tac vu reject khong dung cac tac vu con lai, ket qua phan biet duoc tung tac vu', async () => {
  const tasks = [
    async () => 'a',
    async () => { throw new Error('boom'); },
    async () => 'c'
  ];
  const results = await runWithConcurrencyLimit(tasks, 2);
  assert.equal(results.length, 3);
  assert.deepEqual(results[0], { status: 'fulfilled', value: 'a' });
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.message, 'boom');
  assert.deepEqual(results[2], { status: 'fulfilled', value: 'c' });
});

test('limit >= so tac vu: tat ca chay ngay, van tra dung thu tu ket qua', async () => {
  const results = await runWithConcurrencyLimit([
    async () => 1,
    async () => 2,
    async () => 3
  ], 10);
  assert.deepEqual(results.map((r) => r.value), [1, 2, 3]);
});

test('danh sach rong tra ve mang rong, khong throw', async () => {
  const results = await runWithConcurrencyLimit([], 2);
  assert.deepEqual(results, []);
});
