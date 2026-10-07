'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createCashbookRouter } = require('./cashbookRoutes');
// Truyền permissions đã giải; requireAuth và requireFeature vẫn chạy thật.
async function request(
  path,
  {
    user = {
      permissions: ['cashbook.view'],
      username: 'Manager',
      vaiTro: 'Quản lý',
    },
    method = 'GET',
    body,
    repo = {},
  } = {},
) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = user;
    req.effectiveUserResolved = !!user;
    req.cookies = { tks_branch: 'saigon' };
    next();
  });
  app.use(
    '/api/cashbook',
    createCashbookRouter({
      repository: {
        summary: async () => ({ balances: [{ fund: 'cash', balance: 10 }] }),
        entries: async () => ({ entries: [], total: 0 }),
        filterOptions: async () => ({ funds: [] }),
        syncStatus: async () => ({ revision: 'hn:1|sg:2', enabled: true, intervalMs: 60000 }),
        ...repo,
      },
    }),
  );
  const server = app.listen(0);
  try {
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}/api/cashbook${path}`,
      {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    return {
      status: res.status,
      headers: res.headers,
      data: res.headers.get('content-type')?.includes('json')
        ? await res.json()
        : await res.text(),
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
test('Sale/Kho/Khách forbidden every endpoint and manager allowed/no-store regardless branch cookie', async () => {
  for (const role of ['Nhân viên sale', 'Nhân viên kho', 'Khách'])
    for (const [path, method] of [
      ['/summary', 'GET'],
      ['/entries', 'GET'],
      ['/filter-options', 'GET'],
      ['/sync-status', 'GET'],
      ['/export?view=entries&format=html', 'GET'],
    ]) {
      assert.equal(
        (
          await request(path, {
            user: { vaiTro: role, permissions: [] },
            method,
          })
        ).status,
        403,
      );
    }
  for (const path of [
    '/summary',
    '/entries',
    '/filter-options',
    '/sync-status',
    '/export?view=entries&format=html',
  ]) {
    const r = await request(path);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
});
test('chốt số dư và sửa ngân hàng đã gỡ: không còn route ghi, query lạ trả 400', async () => {
  for (const [path, method] of [
    ['/checkpoints', 'GET'],
    ['/checkpoints', 'POST'],
    ['/accounts/7/bank', 'PUT'],
  ])
    assert.equal(
      (await request(path, { method, body: method === 'GET' ? undefined : {} }))
        .status,
      404,
    );
  assert.equal((await request('/summary?page=1oops')).status, 400);
  assert.equal((await request('/summary?at=2026-10-01T00:00:00Z')).status, 400);
  assert.equal(
    (await request('/export?view=checkpoints&format=html')).status,
    400,
  );
});
test('unauthenticated returns401; internal errors generic no SQL detail; export limit400', async () => {
  assert.equal((await request('/sync-status', { user: null })).status, 401);
  assert.equal((await request('/entries', { user: null })).status, 401);
  const r = await request('/summary', {
    repo: {
      summary: async () => {
        throw new Error('SQL secret contact');
      },
    },
  });
  assert.equal(r.status, 500);
  assert.ok(!JSON.stringify(r.data).includes('secret'));
  assert.equal(
    (
      await request('/export?view=entries&format=html', {
        repo: { entries: async () => ({ entries: [], total: 20001 }) },
      })
    ).status,
    400,
  );
});

test('freshness endpoint exposes successful-sync revision and interval without financial rows', async () => {
  const r = await request('/sync-status');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { revision: 'hn:1|sg:2', enabled: true, intervalMs: 60000 });
});
