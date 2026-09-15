'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDebtCollectionStatusRepository } = require('./debtCollectionStatusRepository');

test('listByBranch chỉ đọc trạng thái của đúng cơ sở', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ branch: 'hanoi', customer_key: 'a'.repeat(64), status: 'Đang xử lý' }] };
    }
  };
  const repository = createDebtCollectionStatusRepository({ pool });

  const rows = await repository.listByBranch('hanoi');
  assert.equal(rows.length, 1);
  assert.deepEqual(calls[0].params, ['hanoi']);
  assert.match(calls[0].sql, /WHERE branch = \$1/);
});

test('upsertStatus dùng khóa branch + customer_key và last-write-wins', async () => {
  const rowsByKey = new Map();
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      const [branch, customerKey, status, alertSignature, userId, userName] = params;
      const row = {
        branch,
        customer_key: customerKey,
        status,
        alert_signature: alertSignature,
        updated_by_user_id: userId,
        updated_by_name: userName,
        updated_at: new Date().toISOString()
      };
      rowsByKey.set(`${branch}|${customerKey}`, row);
      return { rows: [row] };
    }
  };
  const repository = createDebtCollectionStatusRepository({ pool });
  const base = {
    branch: 'hanoi',
    customerKey: 'b'.repeat(64),
    alertSignature: 'c'.repeat(64),
    userId: '9ad42989-90ef-4da8-bf87-da505551ed15',
    userName: 'Quản lý'
  };

  await repository.upsertStatus({ ...base, status: 'Đang xử lý' });
  const latest = await repository.upsertStatus({ ...base, status: 'Đã xử lý' });

  assert.equal(latest.status, 'Đã xử lý');
  assert.equal(rowsByKey.size, 1);
  assert.match(calls[0].sql, /ON CONFLICT \(branch, customer_key\) DO UPDATE/);
  assert.deepEqual(calls[1].params.slice(0, 4), ['hanoi', 'b'.repeat(64), 'Đã xử lý', 'c'.repeat(64)]);
});
