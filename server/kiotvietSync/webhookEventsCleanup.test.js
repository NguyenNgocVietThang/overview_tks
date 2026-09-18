'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanupOldWebhookEvents, startWebhookEventsCleanupSchedule, DEFAULT_RETENTION_DAYS } = require('./webhookEventsCleanup');

test('cleanupOldWebhookEvents xoa dung theo so ngay giu lai, log khi co xoa', async () => {
  const calls = [];
  const logs = [];
  const pool = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 42 }; } };
  const removed = await cleanupOldWebhookEvents(pool, { retentionDays: 14, log: (m) => logs.push(m) });
  assert.equal(removed, 42);
  assert.match(calls[0].sql, /DELETE FROM webhook_events_raw WHERE received_at < now\(\) - /);
  assert.deepEqual(calls[0].params, ['14']);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /42 ban ghi/);
});

test('cleanupOldWebhookEvents khong log khi khong co gi bi xoa', async () => {
  const logs = [];
  const pool = { query: async () => ({ rowCount: 0 }) };
  await cleanupOldWebhookEvents(pool, { log: (m) => logs.push(m) });
  assert.equal(logs.length, 0);
});

test('cleanupOldWebhookEvents dung DEFAULT_RETENTION_DAYS neu retentionDays khong hop le', async () => {
  const calls = [];
  const pool = { query: async (sql, params) => { calls.push(params); return { rowCount: 0 }; } };
  await cleanupOldWebhookEvents(pool, { retentionDays: 'khong-phai-so' });
  assert.deepEqual(calls[0], [String(DEFAULT_RETENTION_DAYS)]);
});

test('startWebhookEventsCleanupSchedule dang ky dung interval, chay cleanup khi trigger', async () => {
  let scheduledFn;
  let scheduledMs;
  const setIntervalFn = (fn, ms) => { scheduledFn = fn; scheduledMs = ms; return 'handle-1'; };
  const pool = { query: async () => ({ rowCount: 1 }) };
  const logs = [];
  const handle = startWebhookEventsCleanupSchedule({ pool, retentionDays: 7, intervalMs: 1000, setIntervalFn, log: (m) => logs.push(m) });
  assert.equal(handle, 'handle-1');
  assert.equal(scheduledMs, 1000);
  await scheduledFn();
  assert.equal(logs.length, 1);
});

test('startWebhookEventsCleanupSchedule khong nem loi ra ngoai neu cleanup that bai', async () => {
  let scheduledFn;
  const setIntervalFn = (fn) => { scheduledFn = fn; return 'h'; };
  const pool = { query: async () => { throw new Error('db down'); } };
  const logs = [];
  startWebhookEventsCleanupSchedule({ pool, setIntervalFn, log: (m) => logs.push(m) });
  assert.doesNotThrow(() => scheduledFn());
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(logs[0], /Loi khi don dep/);
});
