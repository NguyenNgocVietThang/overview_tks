'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureHrInsuranceSchema } = require('./ensureHrInsuranceSchema');

function fakePool({ applied = false, failOnSql = false } = {}) {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT 1 FROM schema_migrations')) {
        return { rowCount: applied ? 1 : 0 };
      }
      if (failOnSql && sql.startsWith('ALTER TABLE')) throw new Error('DDL failed');
      return { rowCount: 0 };
    },
    release() { calls.push({ sql: 'RELEASE' }); }
  };
  return { calls, pool: { async connect() { return client; } } };
}

test('áp riêng migration bảo hiểm trước khi commit và ghi nhận', async () => {
  const { calls, pool } = fakePool();
  await ensureHrInsuranceSchema({ pool, logger: { log() {} } });
  assert.equal(calls[0].sql, 'BEGIN');
  assert.match(calls[1].sql, /pg_advisory_xact_lock/);
  assert.match(calls[3].sql, /ADD COLUMN IF NOT EXISTS insurance_number/);
  assert.match(calls[3].sql, /CREATE UNIQUE INDEX IF NOT EXISTS/);
  assert.equal(calls[4].params[0], '0078_hr_employee_insurance_number.sql');
  assert.equal(calls[5].sql, 'COMMIT');
  assert.equal(calls[6].sql, 'RELEASE');
});

test('migration đã áp thì bỏ qua DDL', async () => {
  const { calls, pool } = fakePool({ applied: true });
  await ensureHrInsuranceSchema({ pool });
  assert.deepEqual(calls.map((call) => call.sql === 'RELEASE' ? 'RELEASE' : call.sql.split(' ')[0]),
    ['BEGIN', 'SELECT', 'SELECT', 'COMMIT', 'RELEASE']);
});

test('DDL lỗi thì rollback và không đánh dấu đã áp', async () => {
  const { calls, pool } = fakePool({ failOnSql: true });
  await assert.rejects(ensureHrInsuranceSchema({ pool }), /DDL failed/);
  assert.equal(calls.at(-2).sql, 'ROLLBACK');
  assert.equal(calls.at(-1).sql, 'RELEASE');
  assert.equal(calls.some((call) => call.sql.startsWith('INSERT INTO schema_migrations')), false);
});
