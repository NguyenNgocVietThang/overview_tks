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
      permissions: ['cashbook.view', 'cashbook.manage'],
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
        checkpoints: async () => ({ checkpoints: [], total: 0 }),
        insertCheckpoint: async (b) => ({ ...b, systemBalance: 10, diff: 5 }),
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
test('Sale/Kho/Khách forbidden all6 endpoints and manager allowed/no-store regardless branch cookie', async () => {
  for (const role of ['Nhân viên sale', 'Nhân viên kho', 'Khách'])
    for (const [path, method] of [
      ['/summary', 'GET'],
      ['/entries', 'GET'],
      ['/filter-options', 'GET'],
      ['/checkpoints', 'GET'],
      ['/export?view=entries&format=html', 'GET'],
      ['/checkpoints', 'POST'],
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
    '/checkpoints',
    '/export?view=entries&format=html',
  ]) {
    const r = await request(path);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
});
test('checkpoint manage required; future or malformed inputs400; valid user attributed', async () => {
  const body = {
    fund: 'cash',
    checkpointAt: '2026-10-01T00:00:00Z',
    balance: 15,
  };
  assert.equal(
    (
      await request('/checkpoints', {
        method: 'POST',
        body,
        user: { permissions: ['cashbook.view'] },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request('/checkpoints', {
        method: 'POST',
        body: { ...body, checkpointAt: '2999-01-01T00:00:00Z' },
      })
    ).status,
    400,
  );
  assert.equal((await request('/summary?page=1oops')).status, 400);
  const r = await request('/checkpoints', {
    method: 'POST',
    body,
    repo: {
      insertCheckpoint: async (b, by) => ({
        fund: b.fund,
        systemBalance: 10,
        diff: 5,
        createdBy: by,
      }),
    },
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.checkpoint.createdBy, 'Manager');
  assert.equal(r.data.checkpoint.diff, 5);
});
test('unauthenticated returns401; internal errors generic no SQL detail; export limit400', async () => {
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
