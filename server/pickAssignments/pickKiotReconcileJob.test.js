'use strict';
process.env.JWT_SECRET ||= 'test-secret';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||= '{}';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPickKiotReconcileScheduler } = require('./pickKiotReconcileJob');

function fakeLogger() {
  const lines = { log: [], error: [] };
  return { lines, log: (...a) => lines.log.push(a.join(' ')), error: (...a) => lines.error.push(a.join(' ')) };
}

test('runOnce: ghi log so don tu dong xac nhan / huy; loi ket (STOCK_CHANGED) chi bao 1 lan cho moi chi dinh', async () => {
  const logger = fakeLogger();
  const failed = [{ id: 5, branch: 'HN', orderCode: 'DH001', outcome: 'completed', code: 'STOCK_CHANGED', message: 'x' }];
  const service = { reconcileWithKiot: async () => ({ checked: 3, confirmed: 1, cancelled: 1, skipped: 0, failed }) };
  const job = createPickKiotReconcileScheduler({ enabled: true, service, logger });
  await job.runOnce();
  await job.runOnce();
  assert.equal(logger.lines.log.length, 2);
  assert.match(logger.lines.log[0], /1 don.*1 don/u);
  assert.equal(logger.lines.error.length, 1, 'khong lap lai cung mot loi o chu ky sau');
  assert.match(logger.lines.error[0], /DH001/u);
});

test('runOnce: loi service khong lam sap job; khong chay chong len nhau', async () => {
  const logger = fakeLogger();
  let release;
  let calls = 0;
  const service = { reconcileWithKiot: () => { calls += 1; return new Promise(resolve => { release = () => resolve({ checked: 0, confirmed: 0, cancelled: 0, skipped: 0, failed: [] }); }); } };
  const job = createPickKiotReconcileScheduler({ enabled: true, service, logger });
  const first = job.runOnce();
  assert.equal(await job.runOnce(), null, 'luot dang chay thi bo qua');
  release();
  await first;
  assert.equal(calls, 1);
  const broken = createPickKiotReconcileScheduler({ enabled: true, service: { reconcileWithKiot: async () => { throw Object.assign(new Error('db'), { code: 'ECONNRESET' }); } }, logger });
  assert.equal(await broken.runOnce(), null);
  assert.match(logger.lines.error.at(-1), /ECONNRESET/u);
});

test('start/stop: tat (enabled=false) thi khong hen gio; bat thi hen theo chu ky va stop huy', async () => {
  const timers = [];
  const setTimeoutFn = (fn, ms) => { const t = { fn, ms, cleared: false, unref() {} }; timers.push(t); return t; };
  const clearTimeoutFn = t => { t.cleared = true; };
  const service = { reconcileWithKiot: async () => ({ checked: 0, confirmed: 0, cancelled: 0, skipped: 0, failed: [] }) };
  createPickKiotReconcileScheduler({ enabled: false, service, intervalMs: 1000, setTimeoutFn, clearTimeoutFn }).start();
  assert.equal(timers.length, 0);
  const job = createPickKiotReconcileScheduler({ enabled: true, service, intervalMs: 1000, setTimeoutFn, clearTimeoutFn });
  job.start();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 1000);
  await timers[0].fn();
  assert.equal(timers.length, 2, 'sau moi luot lai hen luot ke tiep');
  job.stop();
  assert.equal(timers[1].cleared, true);
  await timers[1].fn();
  assert.equal(timers.length, 2, 'da stop thi khong hen them');
});
