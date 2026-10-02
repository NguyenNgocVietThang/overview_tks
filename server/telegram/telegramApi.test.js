'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelegramApi } = require('./telegramApi');

test('Telegram HTTP client sends JSON and returns Telegram result', async () => {
  let request;
  const client = createTelegramApi({ token: 'test-token', fetch: async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 8 } }) };
  } });
  assert.equal((await client.call('sendMessage', { chat_id: '123', text: 'hello' })).message_id, 8);
  assert.equal(JSON.parse(request.options.body).chat_id, '123');
});

test('Telegram failures expose code and retry delay without token or response content', async () => {
  const client = createTelegramApi({ token: 'private-token', fetch: async () => ({ ok: false, json: async () => ({ ok: false, error_code: 429, description: 'private-token', parameters: { retry_after: 7 } }) }) });
  await assert.rejects(client.call('sendMessage', {}), err => err.code === 429 && err.retryAfter === 7 && !err.message.includes('private-token'));
  const broken = createTelegramApi({ token: 'private-token', fetch: async () => { throw new Error('private-token'); } });
  await assert.rejects(broken.call('sendMessage', {}), err => !err.message.includes('private-token'));
});
