'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { refreshCustomerDebtReports, startCustomerDebtReportRefreshSchedule, __sql__ } = require('./customerDebtReportRefresh');

test('refresh công nợ 1/3/7 chạy cho từng cơ sở cấu hình', async () => {
  const calls = [];
  const pool = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 4 }; } };
  const result = await refreshCustomerDebtReports(pool, {
    getConfiguredBranches: () => [{ branch: 'hanoi' }, { branch: 'saigon' }], log: () => {}
  });
  assert.deepEqual(calls.map(call => call.params), [['hanoi'], ['saigon']]);
  assert.deepEqual(result, [{ branch: 'hanoi', rowCount: 4 }, { branch: 'saigon', rowCount: 4 }]);
  assert.match(__sql__.REFRESH_SQL, /customer_debt_activity_periods/);
  assert.match(__sql__.REFRESH_SQL, /VALUES \(1\), \(3\), \(7\)/);
  assert.match(__sql__.REFRESH_SQL, /ON CONFLICT \(branch, period_days, customer_id\) DO UPDATE/);
});

test('scheduler đăng ký interval và fail-soft khi refresh lỗi', async () => {
  let scheduled;
  const logs = [];
  const handle = startCustomerDebtReportRefreshSchedule(
    { query: async () => { throw new Error('db down'); } },
    { intervalMs: 123, setIntervalFn: (fn, ms) => { scheduled = { fn, ms }; return 'handle'; },
      getConfiguredBranches: () => [{ branch: 'hanoi' }], log: message => logs.push(message) }
  );
  assert.equal(handle, 'handle');
  assert.equal(scheduled.ms, 123);
  scheduled.fn();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(logs[0], /Loi khi refresh/);
});
