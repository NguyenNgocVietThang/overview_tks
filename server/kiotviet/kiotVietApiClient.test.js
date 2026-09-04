'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createKiotVietClient } = require('./kiotVietApiClient');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

function tokenFetchImpl(handleOther) {
  return async (url, options) => {
    if (String(url).includes('/connect/token')) {
      return jsonResponse(200, { access_token: 'tok-1', expires_in: 3600, token_type: 'Bearer' });
    }
    return handleOther(url, options);
  };
}

test('getAccessToken goi token endpoint dung tham so va cache lai, khong goi lai khi con han', async () => {
  let tokenCalls = 0;
  const fetchImpl = async (url, options) => {
    tokenCalls++;
    assert.equal(url, 'https://id.kiotviet.vn/connect/token');
    assert.equal(options.method, 'POST');
    assert.match(options.body, /grant_type=client_credentials/);
    assert.match(options.body, /client_id=my-id/);
    return jsonResponse(200, { access_token: 'tok-1', expires_in: 3600, token_type: 'Bearer' });
  };
  const client = createKiotVietClient({ clientId: 'my-id', clientSecret: 'secret', retailer: 'CHhanoi', fetchImpl, now: () => 1000 });

  const token1 = await client.getAccessToken();
  const token2 = await client.getAccessToken();
  assert.equal(token1, 'tok-1');
  assert.equal(token2, 'tok-1');
  assert.equal(tokenCalls, 1);
});

test('getAccessToken tu refresh khi token da het han', async () => {
  let tokenCalls = 0;
  let nowValue = 1000;
  const fetchImpl = async () => {
    tokenCalls++;
    return jsonResponse(200, { access_token: `tok-${tokenCalls}`, expires_in: 100, token_type: 'Bearer' });
  };
  const client = createKiotVietClient({ clientId: 'id', clientSecret: 'secret', retailer: 'CHhanoi', fetchImpl, now: () => nowValue });

  const token1 = await client.getAccessToken();
  nowValue += 200 * 1000; // vuot qua thoi han (100s - 60s bien an toan)
  const token2 = await client.getAccessToken();

  assert.equal(token1, 'tok-1');
  assert.equal(token2, 'tok-2');
  assert.equal(tokenCalls, 2);
});

test('fetchJsonWithRetry tra ve JSON ngay khi thanh cong', async () => {
  const fetchImpl = async () => jsonResponse(200, { hello: 'world' });
  const client = createKiotVietClient({ clientId: 'id', clientSecret: 's', retailer: 'r', fetchImpl });
  const result = await client.fetchJsonWithRetry('https://example.com', {}, { baseDelayMs: 1 });
  assert.deepEqual(result, { hello: 'world' });
});

test('fetchJsonWithRetry thu lai khi gap 429 roi thanh cong', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls < 3) return jsonResponse(429, { message: 'rate limited' });
    return jsonResponse(200, { ok: true });
  };
  const client = createKiotVietClient({ clientId: 'id', clientSecret: 's', retailer: 'r', fetchImpl });
  const result = await client.fetchJsonWithRetry('https://example.com', {}, { baseDelayMs: 1, maxRetries: 5 });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 3);
});

test('fetchJsonWithRetry thu lai khi gap loi 5xx', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls < 2) return jsonResponse(503, { message: 'unavailable' });
    return jsonResponse(200, { ok: true });
  };
  const client = createKiotVietClient({ clientId: 'id', clientSecret: 's', retailer: 'r', fetchImpl });
  const result = await client.fetchJsonWithRetry('https://example.com', {}, { baseDelayMs: 1 });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
});

test('fetchJsonWithRetry dung ngay khi gap loi 4xx khac (khong phai 429), khong thu lai', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return jsonResponse(400, { message: 'bad request' });
  };
  const client = createKiotVietClient({ clientId: 'id', clientSecret: 's', retailer: 'r', fetchImpl });
  await assert.rejects(
    client.fetchJsonWithRetry('https://example.com', {}, { baseDelayMs: 1, maxRetries: 5 }),
    /HTTP 400/
  );
  assert.equal(calls, 1);
});

test('fetchJsonWithRetry nem loi sau khi het so lan thu toi da', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return jsonResponse(500, { message: 'server error' });
  };
  const client = createKiotVietClient({ clientId: 'id', clientSecret: 's', retailer: 'r', fetchImpl });
  await assert.rejects(
    client.fetchJsonWithRetry('https://example.com', {}, { baseDelayMs: 1, maxRetries: 3 })
  );
  assert.equal(calls, 3);
});

test('fetchAllPages phan trang dung theo total, goi onPage sau moi trang', async () => {
  const allItems = Array.from({ length: 25 }, (_, i) => ({ id: i }));
  const fetchImpl = tokenFetchImpl(async (url) => {
    const u = new URL(url);
    const currentItem = Number(u.searchParams.get('currentItem') || 0);
    const pageSize = Number(u.searchParams.get('pageSize'));
    assert.equal(pageSize, 100);
    const pageItems = allItems.slice(currentItem, currentItem + pageSize);
    return jsonResponse(200, { total: allItems.length, data: pageItems });
  });
  const client = createKiotVietClient({ clientId: 'id', clientSecret: 's', retailer: 'r', fetchImpl });

  const pages = [];
  await client.fetchAllPages('invoices', { fromPurchaseDate: '2026-01-01' }, (items, meta) => {
    pages.push({ count: items.length, meta });
  });

  assert.equal(pages.length, 1);
  assert.equal(pages[0].count, 25);
  assert.equal(pages[0].meta.pagesLoaded, 1);
  assert.equal(pages[0].meta.recordsLoaded, 25);
  assert.equal(pages[0].meta.total, 25);
});

test('fetchAllPages voi nhieu trang goi onPage nhieu lan va dung dung khi het du lieu', async () => {
  const allItems = Array.from({ length: 250 }, (_, i) => ({ id: i }));
  let requestCount = 0;
  const fetchImpl = tokenFetchImpl(async (url) => {
    requestCount++;
    const u = new URL(url);
    const currentItem = Number(u.searchParams.get('currentItem') || 0);
    const pageItems = allItems.slice(currentItem, currentItem + 100);
    return jsonResponse(200, { total: allItems.length, data: pageItems });
  });
  const client = createKiotVietClient({ clientId: 'id', clientSecret: 's', retailer: 'r', fetchImpl });

  let totalRecords = 0;
  await client.fetchAllPages('invoices', {}, (items) => { totalRecords += items.length; });

  assert.equal(requestCount, 3); // 100 + 100 + 50
  assert.equal(totalRecords, 250);
});

test('fetchAllPages CHO onPage bat dong bo hoan tat truoc khi tai trang tiep theo (can thiet cho entity sync ghi DB theo tung trang)', async () => {
  const allItems = Array.from({ length: 250 }, (_, i) => ({ id: i }));
  const order = [];
  const fetchImpl = tokenFetchImpl(async (url) => {
    const u = new URL(url);
    const currentItem = Number(u.searchParams.get('currentItem') || 0);
    order.push(`fetch-page-${currentItem}`);
    const pageItems = allItems.slice(currentItem, currentItem + 100);
    return jsonResponse(200, { total: allItems.length, data: pageItems });
  });
  const client = createKiotVietClient({ clientId: 'id', clientSecret: 's', retailer: 'r', fetchImpl });

  await client.fetchAllPages('invoices', {}, async (items, meta) => {
    order.push(`onpage-start-${meta.pagesLoaded}`);
    await new Promise((resolve) => setImmediate(resolve));
    order.push(`onpage-end-${meta.pagesLoaded}`);
  });

  assert.deepEqual(order, [
    'fetch-page-0', 'onpage-start-1', 'onpage-end-1',
    'fetch-page-100', 'onpage-start-2', 'onpage-end-2',
    'fetch-page-200', 'onpage-start-3', 'onpage-end-3'
  ]);
});

test('fetchAllPages tra nextItem trong meta de biet vi tri tiep tuc neu bi dung sau trang nay', async () => {
  const allItems = Array.from({ length: 250 }, (_, i) => ({ id: i }));
  const fetchImpl = tokenFetchImpl(async (url) => {
    const u = new URL(url);
    const currentItem = Number(u.searchParams.get('currentItem') || 0);
    const pageItems = allItems.slice(currentItem, currentItem + 100);
    return jsonResponse(200, { total: allItems.length, data: pageItems });
  });
  const client = createKiotVietClient({ clientId: 'id', clientSecret: 's', retailer: 'r', fetchImpl });

  const nextItems = [];
  await client.fetchAllPages('invoices', {}, (items, meta) => { nextItems.push(meta.nextItem); });

  assert.deepEqual(nextItems, [100, 200, 300]);
});

test('fetchAllPages voi options.startItem bat dau phan trang tu offset da cho, bo qua cac trang truoc do', async () => {
  const allItems = Array.from({ length: 250 }, (_, i) => ({ id: i }));
  const requestedOffsets = [];
  const fetchImpl = tokenFetchImpl(async (url) => {
    const u = new URL(url);
    const currentItem = Number(u.searchParams.get('currentItem') || 0);
    requestedOffsets.push(currentItem);
    const pageItems = allItems.slice(currentItem, currentItem + 100);
    return jsonResponse(200, { total: allItems.length, data: pageItems });
  });
  const client = createKiotVietClient({ clientId: 'id', clientSecret: 's', retailer: 'r', fetchImpl });

  let totalRecords = 0;
  await client.fetchAllPages('invoices', {}, (items) => { totalRecords += items.length; }, { startItem: 200 });

  assert.deepEqual(requestedOffsets, [200]);
  assert.equal(totalRecords, 50, 'chi lay 50 ban ghi con lai tu offset 200, khong keo lai tu dau');
});

test('fetchProductOnHand cong dong onHand tat ca chi nhanh', async () => {
  const fetchImpl = tokenFetchImpl(async (url) => {
    assert.match(String(url), /\/products\/code\/SP001/);
    return jsonResponse(200, {
      code: 'SP001',
      inventories: [{ branchId: 1, onHand: 5 }, { branchId: 2, onHand: 3 }]
    });
  });
  const client = createKiotVietClient({ clientId: 'id', clientSecret: 's', retailer: 'r', fetchImpl });
  const result = await client.fetchProductOnHand('SP001');
  assert.deepEqual(result, { code: 'SP001', found: true, onHand: 8 });
});

test('fetchProductOnHand tra found=false khi khong tim thay ma hang (404)', async () => {
  const fetchImpl = tokenFetchImpl(async () => jsonResponse(404, { message: 'not found' }));
  const client = createKiotVietClient({ clientId: 'id', clientSecret: 's', retailer: 'r', fetchImpl });
  const result = await client.fetchProductOnHand('KHONGTONTAI');
  assert.deepEqual(result, { code: 'KHONGTONTAI', found: false, onHand: 0 });
});
