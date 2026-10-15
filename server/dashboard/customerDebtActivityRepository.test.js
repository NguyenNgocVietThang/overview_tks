'use strict';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCustomerDebtActivityRepository } = require('./customerDebtActivityRepository');

test('đọc ba kỳ công nợ từ Supabase và trả shape tương thích logic cảnh báo', async () => {
  const calls = [];
  const repo = createCustomerDebtActivityRepository({ pool: { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [
      { period_days: 1, customer_name: 'Khách A' },
      { period_days: 3, customer_name: 'Khách B' },
      { period_days: 7, customer_name: 'Khách C' }
    ] };
  } } });
  const result = await repo.readOperationalPeriods('Hà Nội');
  assert.deepEqual(calls[0].params, ['hanoi']);
  assert.deepEqual(result.HN1, [['Khách hàng'], ['Khách A']]);
  assert.deepEqual(result.HN3, [['Khách hàng'], ['Khách B']]);
  assert.deepEqual(result.HN7, [['Khách hàng'], ['Khách C']]);
});

test('từ chối cơ sở không hợp lệ trước khi query', async () => {
  const repo = createCustomerDebtActivityRepository({ pool: { query: async () => assert.fail('không được query') } });
  await assert.rejects(() => repo.readOperationalPeriods('Khác'), error => error.code === 'INVALID_BRANCH');
});

test('reads exclude inactive customers immediately while keeping legacy active records', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE customers(branch text,id bigint,raw jsonb);
      CREATE TABLE customer_debt_activity_periods(branch text,period_days int,customer_id bigint,customer_name text);
      INSERT INTO customers VALUES ('hanoi',1,'{}'),('hanoi',2,'{"isActive":false}'),('hanoi',3,'{"IsActive":false}');
      INSERT INTO customer_debt_activity_periods VALUES ('hanoi',1,1,'Legacy'),('hanoi',1,2,'Inactive'),('hanoi',1,3,'Inactive upper');`);
    const repo = createCustomerDebtActivityRepository({ pool: db });
    assert.deepEqual((await repo.readOperationalPeriods('Hà Nội')).HN1, [['Khách hàng'], ['Legacy']]);
  } finally { await db.close(); }
});
