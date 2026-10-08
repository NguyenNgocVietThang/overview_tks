'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createMarketingReportRouter } = require('./marketingReportRoutes');

// Authentication and permission middleware run unchanged; only source reads are mocked.
async function request(path, { permissions = ['reports.marketing'], authenticated = true, method = 'GET', service = {}, body } = {}) {
  const calls = [];
  const app = express();
  app.use((req, res, next) => {
    if (authenticated) {
      req.user = { username: 'tester', vaiTro: 'Quản lý', permissions };
      req.effectiveUserResolved = true;
    }
    next();
  });
  app.use('/api/marketing-report', createMarketingReportRouter({ service: {
    metadata: async () => { calls.push(['metadata']); return { months: [10] }; },
    report: async (kind, query) => { calls.push(['report', kind, { ...query }]); return { kind, rows: [{ key: 'source:1' }] }; },
    detail: async query => { calls.push(['detail', { ...query }]); return { groups: [] }; },
    updateRow: async b => { calls.push(['updateRow', { ...b }]); return { ok: true }; },
    ...service
  } }));
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/marketing-report${path}`, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    return { status: res.status, headers: res.headers, calls,
      data: (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const endpoints = ['metadata', 'monthly', 'receipt-check', 'phones', 'costs', 'detail'];

test('all Marketing reads reject unauthenticated or missing permission before calling source', async () => {
  for (const endpoint of endpoints) {
    const unauthenticated = await request('/' + endpoint, { authenticated: false });
    assert.equal(unauthenticated.status, 401, endpoint);
    assert.equal(unauthenticated.headers.get('cache-control'), 'no-store');
    assert.deepEqual(unauthenticated.calls, []);
    const denied = await request('/' + endpoint, { permissions: ['reports.business'] });
    assert.equal(denied.status, 403, endpoint);
    assert.equal(denied.headers.get('cache-control'), 'no-store');
    assert.equal(denied.data.code, 'FEATURE_FORBIDDEN');
    assert.deepEqual(denied.calls, []);
  }
});

test('metadata and each report delegate to the expected service read with unchanged filters', async () => {
  const metadata = await request('/metadata');
  assert.equal(metadata.status, 200);
  assert.deepEqual(metadata.calls, [['metadata']]);
  assert.equal(metadata.headers.get('cache-control'), 'no-store');
  for (const kind of ['monthly', 'receipt-check', 'phones', 'costs']) {
    const result = await request('/' + kind + '?month=10&page=HN&employee=Lan');
    assert.equal(result.status, 200, kind);
    assert.deepEqual(result.calls, [['report', kind, { month: '10', page: 'HN', employee: 'Lan' }]]);
    assert.equal(result.headers.get('cache-control'), 'no-store');
  }
});

test('detail delegates source identity, snapshot and active filter values', async () => {
  const result = await request('/detail?kind=phones&key=sheet%3A12&snapshotId=s1&month=10&page=HN');
  assert.equal(result.status, 200);
  assert.deepEqual(result.calls, [['detail', { kind: 'phones', key: 'sheet:12', snapshotId: 's1', month: '10', page: 'HN' }]]);
  assert.equal(result.headers.get('cache-control'), 'no-store');
});

test('validation failures preserve client status and code', async () => {
  const result = await request('/monthly?month=bad', { service: { report: async () => {
    throw Object.assign(new Error('Tháng không hợp lệ.'), { statusCode: 400, code: 'MARKETING_INVALID_MONTH' });
  } } });
  assert.equal(result.status, 400);
  assert.equal(result.data.code, 'MARKETING_INVALID_MONTH');
});

test('unexpected source failures never expose credentials or raw Google diagnostics', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const result = await request('/metadata', { service: { metadata: async () => {
      throw new Error('secret credential private_key Google response');
    } } });
    assert.equal(result.status, 500);
    assert.equal(result.data.code, 'MARKETING_REPORT_ERROR');
    assert.ok(!JSON.stringify(result.data).includes('secret'));
    assert.ok(!JSON.stringify(result.data).includes('private_key'));
  } finally { console.error = original; }
});

test('a safe source failure returns 503 without affecting another report read', async () => {
  const failed = await request('/phones', { service: { report: async () => {
    throw Object.assign(new Error('Nguồn SĐT chưa sẵn sàng.'), { statusCode: 503, code: 'MARKETING_SOURCE_UNAVAILABLE' });
  } } });
  assert.equal(failed.status, 503);
  assert.equal(failed.data.code, 'MARKETING_SOURCE_UNAVAILABLE');
  const other = await request('/costs');
  assert.equal(other.status, 200);
  assert.deepEqual(other.calls, [['report', 'costs', {}]]);
});

test('Marketing has no write endpoints', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const result = await request('/monthly', { method });
    assert.equal(result.status, 404, method);
    assert.deepEqual(result.calls, []);
  }
});

test('writing Khách mới/Ghi chú needs reports.marketing.edit and only that route writes', async () => {
  const body = { snapshotId: 's', key: 'k', field: 'note', value: 'x' };
  const denied = await request('/monthly/row', { method: 'PUT', body });
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.calls, []);
  const ok = await request('/monthly/row', { method: 'PUT', body, permissions: ['reports.marketing', 'reports.marketing.edit'] });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.calls, [['updateRow', body]]);
});
