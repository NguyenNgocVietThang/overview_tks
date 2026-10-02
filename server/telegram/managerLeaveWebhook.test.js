'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createManagerLeaveWebhook } = require('./managerLeaveWebhook');

test('webhook rejects bad secret, persists valid update, and deduplicates without auth cookies', async t => {
  const saved = [];
  let wakes = 0;
  const app = express();
  app.use(express.json());
  app.use(createManagerLeaveWebhook({ enabled: true, secret: 'valid-secret', store: { enqueueUpdate: async update => {
    if (saved.some(x => x.update_id === update.update_id)) return false;
    saved.push(update); return true;
  } }, wake: () => wakes++ }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/telegram/manager-leave/webhook`;
  const send = secret => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify({ update_id: 1, message: { text: '/start' } }) });
  assert.equal((await send('invalid')).status, 403);
  assert.equal(saved.length, 0);
  assert.equal((await send('valid-secret')).status, 200);
  assert.equal((await send('valid-secret')).status, 200);
  assert.equal(saved.length, 1);
  assert.equal(wakes, 1);
});
