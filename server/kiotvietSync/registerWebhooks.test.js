'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWebhookUrl, listWebhooks, registerWebhook, deleteWebhook, parseArgs, EVENT_TYPES } = require('./registerWebhooks');

test('buildWebhookUrl gan secret/branch/eventType vao query string', () => {
  const url = buildWebhookUrl('https://tokosi.example.com', 'shh', 'hanoi', 'invoice.update');
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, 'https://tokosi.example.com/api/kiotviet/webhook');
  assert.equal(parsed.searchParams.get('secret'), 'shh');
  assert.equal(parsed.searchParams.get('branch'), 'hanoi');
  assert.equal(parsed.searchParams.get('eventType'), 'invoice.update');
});

test('parseArgs: mac dinh dry-run, branch=all, khong list', () => {
  assert.deepEqual(parseArgs([]), { branch: 'all', execute: false, list: false });
  assert.deepEqual(parseArgs(['--execute', '--branch=hanoi', '--baseUrl=https://x.com']), { branch: 'hanoi', execute: true, list: false, baseUrl: 'https://x.com' });
  assert.deepEqual(parseArgs(['--list']), { branch: 'all', execute: false, list: true });
});

test('EVENT_TYPES khop dung danh sach da xac nhan chay that o Apps Script (KIOTVIET_AUTO_SYNC_EVENT_TYPES)', () => {
  assert.deepEqual(EVENT_TYPES, [
    'product.update', 'product.delete', 'stock.update',
    'customer.update', 'customer.delete',
    'invoice.update', 'order.update',
    'category.update', 'category.delete'
  ]);
});

function fakeClient({ onFetch } = {}) {
  const calls = [];
  return {
    calls,
    async getAccessToken() { return 'tok-1'; },
    async fetchJsonWithRetry(url, options) {
      calls.push({ url, options });
      return onFetch ? onFetch(url, options) : { data: [] };
    }
  };
}

test('listWebhooks goi dung URL/method, tra mang data', async () => {
  const client = fakeClient({ onFetch: () => ({ data: [{ id: 1 }] }) });
  const result = await listWebhooks(client);
  assert.deepEqual(result, [{ id: 1 }]);
  assert.equal(client.calls[0].url, 'https://public.kiotapi.com/webhooks?pageSize=100');
  assert.equal(client.calls[0].options.method, 'GET');
  assert.equal(client.calls[0].options.headers.Authorization, 'Bearer tok-1');
});

test('listWebhooks tra mang rong neu response khong co data la mang', async () => {
  const client = fakeClient({ onFetch: () => ({ data: null }) });
  assert.deepEqual(await listWebhooks(client), []);
});

test('registerWebhook goi POST dung schema {Webhook:{Type,Url,IsActive,Description}}', async () => {
  const client = fakeClient({ onFetch: () => ({ id: 99 }) });
  await registerWebhook(client, { url: 'https://x.com/api/kiotviet/webhook?a=b', eventType: 'invoice.update' });
  const call = client.calls[0];
  assert.equal(call.url, 'https://public.kiotapi.com/webhooks');
  assert.equal(call.options.method, 'POST');
  const body = JSON.parse(call.options.body);
  assert.deepEqual(body, {
    Webhook: { Type: 'invoice.update', Url: 'https://x.com/api/kiotviet/webhook?a=b', IsActive: true, Description: 'Postgres sync - invoice.update' }
  });
});

test('deleteWebhook goi dung DELETE /webhooks/:id, khong nem loi khi response rong (khong phai loi HTTP that)', async () => {
  const client = fakeClient({ onFetch: () => { throw Object.assign(new Error('Unexpected end of JSON input'), {}); } });
  await assert.doesNotReject(deleteWebhook(client, 42));
  assert.equal(client.calls[0].url, 'https://public.kiotapi.com/webhooks/42');
  assert.equal(client.calls[0].options.method, 'DELETE');
});

test('deleteWebhook nem lai loi HTTP that (co .status)', async () => {
  const client = fakeClient({ onFetch: () => { throw Object.assign(new Error('HTTP 500'), { status: 500 }); } });
  await assert.rejects(deleteWebhook(client, 42), /HTTP 500/);
});
