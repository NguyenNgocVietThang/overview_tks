'use strict';
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

// Pool gia lap mot transaction that: cac dong chi "hien ra" trong `committed`
// sau COMMIT, ROLLBACK vut bo toan bo phan da ghi trong transaction do.
function transactionalPool({ failOnBranch = '' } = {}) {
  const committed = new Map();
  const client = {
    queries: [],
    released: 0,
    pending: new Map(),
    async query(sql, params) {
      client.queries.push({ sql, params });
      if (sql === 'BEGIN') { client.pending = new Map(); return { rows: [] }; }
      if (sql === 'COMMIT') {
        client.pending.forEach((row, key) => committed.set(key, row));
        client.pending = new Map();
        return { rows: [] };
      }
      if (sql === 'ROLLBACK') { client.pending = new Map(); return { rows: [] }; }
      const [branch, customerKey, status, alertSignature, userId, userName] = params;
      if (failOnBranch && branch === failOnBranch) throw new Error('mat ket noi giua transaction');
      const row = {
        branch,
        customer_key: customerKey,
        status,
        alert_signature: alertSignature,
        updated_by_user_id: userId,
        updated_by_name: userName,
        updated_at: '2026-09-21T00:00:00.000Z'
      };
      client.pending.set(`${branch}|${customerKey}`, row);
      return { rows: [row] };
    },
    release() { client.released += 1; }
  };
  const pool = {
    connect: async () => client,
    async query() { throw new Error('ghi nhieu co so phai di qua pool.connect()'); }
  };
  return { pool, client, committed };
}

const HANOI_SIGNATURE = 'b'.repeat(64);
const SAIGON_SIGNATURE = 'c'.repeat(64);
const BOTH_BASE = {
  customerKey: 'a'.repeat(64),
  status: 'Đã xử lý',
  userId: '9ad42989-90ef-4da8-bf87-da505551ed15',
  userName: 'Quản lý'
};
const BOTH_TARGETS = [
  { branch: 'hanoi', alertSignature: HANOI_SIGNATURE },
  { branch: 'saigon', alertSignature: SAIGON_SIGNATURE }
];

test('upsertStatusForBranches ghi hai cơ sở trong đúng một transaction rồi COMMIT', async () => {
  const { pool, client, committed } = transactionalPool();
  const repository = createDebtCollectionStatusRepository({ pool });

  const rows = await repository.upsertStatusForBranches({ targets: BOTH_TARGETS, ...BOTH_BASE });

  assert.deepEqual(client.queries.map(call => (call.sql === 'BEGIN' || call.sql === 'COMMIT' || call.sql === 'ROLLBACK' ? call.sql : call.params[0])),
    ['BEGIN', 'hanoi', 'saigon', 'COMMIT']);
  assert.deepEqual(rows.map(row => row.branch), ['hanoi', 'saigon']);
  assert.deepEqual([...committed.keys()], [`hanoi|${BOTH_BASE.customerKey}`, `saigon|${BOTH_BASE.customerKey}`]);
  assert.equal(client.released, 1);
});

test('upsertStatusForBranches ghi CHỮ KÝ CẢNH BÁO RIÊNG của từng cơ sở', async () => {
  const { pool, client, committed } = transactionalPool();
  const repository = createDebtCollectionStatusRepository({ pool });

  const rows = await repository.upsertStatusForBranches({ targets: BOTH_TARGETS, ...BOTH_BASE });

  const signatureByBranch = Object.fromEntries(client.queries
    .filter(call => Array.isArray(call.params))
    .map(call => [call.params[0], call.params[3]]));
  assert.deepEqual(signatureByBranch, { hanoi: HANOI_SIGNATURE, saigon: SAIGON_SIGNATURE });
  assert.deepEqual(rows.map(row => row.alert_signature), [HANOI_SIGNATURE, SAIGON_SIGNATURE]);
  assert.equal(committed.get(`saigon|${BOTH_BASE.customerKey}`).alert_signature, SAIGON_SIGNATURE);
});

test('upsertStatusForBranches ROLLBACK toàn bộ khi một cơ sở lỗi', async () => {
  const { pool, client, committed } = transactionalPool({ failOnBranch: 'saigon' });
  const repository = createDebtCollectionStatusRepository({ pool });

  await assert.rejects(
    repository.upsertStatusForBranches({ targets: BOTH_TARGETS, ...BOTH_BASE }),
    /mat ket noi giua transaction/
  );

  assert.equal(committed.size, 0, 'không được để lại trạng thái ghi một nửa');
  assert.equal(client.queries.some(call => call.sql === 'COMMIT'), false);
  assert.equal(client.queries.at(-1).sql, 'ROLLBACK');
  assert.equal(client.released, 1);
});

test('repository từ chối mọi mã cơ sở ngoài hanoi/saigon — "Cả hai"/"both" không bao giờ tới database', async () => {
  const { pool, client } = transactionalPool();
  const repository = createDebtCollectionStatusRepository({ pool });

  for (const branch of ['both', 'Cả hai', '', null]) {
    await assert.rejects(
      repository.upsertStatusForBranches({ targets: [{ branch, alertSignature: HANOI_SIGNATURE }], ...BOTH_BASE }),
      /Mã cơ sở không hợp lệ/,
      String(branch)
    );
    await assert.rejects(
      repository.upsertStatus({ branch, alertSignature: HANOI_SIGNATURE, ...BOTH_BASE }),
      /Mã cơ sở không hợp lệ/,
      String(branch)
    );
  }
  assert.deepEqual(client.queries, [], 'không được gửi câu lệnh nào tới database');
});
