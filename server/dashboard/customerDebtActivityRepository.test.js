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
