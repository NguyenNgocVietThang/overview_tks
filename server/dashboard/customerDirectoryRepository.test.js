'use strict';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCustomerDirectoryRepository } = require('./customerDirectoryRepository');

test('doc danh ba 1 co so vat ly: chi truyen dung 1 ma co so vao ANY($1)', async () => {
  const calls = [];
  const repo = createCustomerDirectoryRepository({
    pool: {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [{ branch: 'hanoi', code: 'KH001', name: 'Nguyễn Văn A' }] };
      }
    }
  });
  const result = await repo.readCustomerDirectory('Hà Nội');
  assert.deepEqual(calls[0].params, [['hanoi']]);
  assert.deepEqual(result, [{ branch: 'hanoi', code: 'KH001', name: 'Nguyễn Văn A' }]);
});

test('Ca hai: truyen ca hai ma co so vat ly vao ANY($1), khong bao gio truyen "Ca hai" nhu 1 co so', async () => {
  const calls = [];
  const repo = createCustomerDirectoryRepository({
    pool: {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [] };
      }
    }
  });
  await repo.readCustomerDirectory('Cả hai');
  assert.deepEqual(calls[0].params[0].sort(), ['hanoi', 'saigon']);
});

test('tu choi co so khong hop le truoc khi query', async () => {
  const repo = createCustomerDirectoryRepository({ pool: { query: async () => assert.fail('không được query') } });
  await assert.rejects(() => repo.readCustomerDirectory('Khác'), error => error.code === 'INVALID_BRANCH');
});
