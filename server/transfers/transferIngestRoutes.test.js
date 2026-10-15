'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createTransferIngestRouter } = require('./transferIngestRoutes');
const { createRepository } = require('./transferRepository');
const { createTransferService } = require('./transferService');
const { createTransferDb, botRequest } = require('./testHelpers');

const SECRET = 's'.repeat(40);

async function serve(router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { method = 'GET', body, secret = SECRET } = {}) => fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(secret != null ? { 'X-Transfer-Bot-Secret': secret } : {}) },
    body: body ? JSON.stringify(body) : undefined
  }).then(async r => ({ status: r.status, body: await r.json() }));
  return { call, close: () => new Promise(resolve => server.close(resolve)) };
}

const silent = { error() {} };
const quietNotifier = { created: async () => {}, approved: async () => {}, canceledAfterApproval: async () => {} };

test('bot API requires the shared secret', async () => {
  const { call, close } = await serve(createTransferIngestRouter({ secret: SECRET, service: {}, logger: silent }));
  try {
    assert.equal((await call('/api/transfer-bot/events', { secret: null })).status, 403);
    assert.equal((await call('/api/transfer-bot/events', { secret: 'short' })).status, 403);
    assert.equal((await call('/api/transfer-bot/events', { secret: 'x'.repeat(40) })).status, 403);
  } finally {
    await close();
  }
  const disabled = await serve(createTransferIngestRouter({ secret: '', service: {}, logger: silent }));
  try {
    assert.equal((await disabled.call('/api/transfer-bot/events')).status, 404);
  } finally {
    await disabled.close();
  }
});

test('bot API: create, duplicate, invalid body, cancel, events + ack', async () => {
  const { db, pool } = await createTransferDb();
  const service = createTransferService({ repository: createRepository({ pool }), notifier: quietNotifier, broadcast: () => {} });
  const { call, close } = await serve(createTransferIngestRouter({ secret: SECRET, service, logger: silent }));
  try {
    const body = botRequest();
    const created = await call('/api/transfer-bot/requests', { method: 'POST', body });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, 'CHO_DUYET');
    const dup = await call('/api/transfer-bot/requests', { method: 'POST', body });
    assert.equal(dup.status, 200);
    assert.equal(dup.body.duplicate, true);
    const bad = await call('/api/transfer-bot/requests', { method: 'POST', body: { ...botRequest(), amountVnd: -5 } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.field, 'amountVnd');
    const cancel = await call(`/api/transfer-bot/requests/${body.requestCode}/cancel`, { method: 'POST', body: { telegramId: '8870151609', reason: 'Gửi nhầm' } });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.status, 'DA_HUY');
    const missing = await call('/api/transfer-bot/requests/YC-20990101-0001/cancel', { method: 'POST', body: { telegramId: '8870151609' } });
    assert.equal(missing.status, 404);
    const events = await call('/api/transfer-bot/events?limit=10');
    assert.deepEqual(events.body.events.map(e => e.type), ['CREATED', 'CANCELED']);
    const ack = await call('/api/transfer-bot/events/ack', { method: 'POST', body: { ids: events.body.events.map(e => e.id) } });
    assert.equal(ack.body.acked, 2);
  } finally {
    await close();
    await db.close();
  }
});

test('database failure returns 503 so the bot retries', async () => {
  const failing = { createFromBot: async () => { throw new Error('connection refused'); } };
  const { call, close } = await serve(createTransferIngestRouter({ secret: SECRET, service: failing, logger: silent }));
  try {
    const res = await call('/api/transfer-bot/requests', { method: 'POST', body: botRequest() });
    assert.equal(res.status, 503);
  } finally {
    await close();
  }
});
