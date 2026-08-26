'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createJobStore } = require('./jobManager');

test('createJob tao job status=running voi id duy nhat', () => {
  const store = createJobStore();
  const id1 = store.createJob();
  const id2 = store.createJob();
  assert.notEqual(id1, id2);
  const job = store.getJob(id1);
  assert.equal(job.status, 'running');
  assert.equal(job.result, null);
  assert.equal(job.error, null);
});

test('getJob voi id khong ton tai tra ve null', () => {
  const store = createJobStore();
  assert.equal(store.getJob('khong-ton-tai'), null);
});

test('updateProgress merge nong vao progress, khong ghi de toan bo', () => {
  const store = createJobStore();
  const id = store.createJob();
  store.updateProgress(id, { invalidCodes: ['A'], totalValidCodes: 5 });
  store.updateProgress(id, { progress: { phase: 1 } });
  const job = store.getJob(id);
  assert.deepEqual(job.invalidCodes, ['A']);
  assert.equal(job.totalValidCodes, 5);
  assert.equal(job.progress.phase, 1);
});

test('setResult chuyen status sang done va luu ket qua', () => {
  const store = createJobStore();
  const id = store.createJob();
  store.setResult(id, { rows: [] });
  const job = store.getJob(id);
  assert.equal(job.status, 'done');
  assert.deepEqual(job.result, { rows: [] });
});

test('setError chuyen status sang error va luu thong tin loi', () => {
  const store = createJobStore();
  const id = store.createJob();
  store.setError(id, { message: 'that bai', code: 'BOOM' });
  const job = store.getJob(id);
  assert.equal(job.status, 'error');
  assert.deepEqual(job.error, { message: 'that bai', code: 'BOOM' });
});

test('job tu dong bi xoa sau ttlAfterDoneMs ke tu khi done (khong can cho that)', () => {
  let now = 1000;
  const store = createJobStore({ ttlAfterDoneMs: 500, now: () => now });
  const id = store.createJob();
  store.setResult(id, { rows: [] });
  assert.notEqual(store.getJob(id), null);

  now = 1000 + 500 + 1;
  assert.equal(store.getJob(id), null);
});

test('job dang running khong bi xoa du qua ttl', () => {
  let now = 1000;
  const store = createJobStore({ ttlAfterDoneMs: 500, now: () => now });
  const id = store.createJob();
  now = 1000 + 10000;
  assert.notEqual(store.getJob(id), null);
});
