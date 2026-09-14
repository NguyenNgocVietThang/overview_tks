'use strict';

const { getPool } = require('../db/pool');

function createWebhookEventQueue({ pool = getPool(), logger = console, schedule = queueMicrotask } = {}) {
  const pending = [];
  let running = false;
  let idlePromise = Promise.resolve();
  let resolveIdle = null;

  function normalizePayload(payload) {
    if (typeof payload !== 'string') return payload ?? null;
    try { return JSON.parse(payload); } catch (_error) {
      logger.error('[KiotViet Webhook] Payload không phải JSON hợp lệ; đã lưu dạng raw.');
      return { raw: payload, parseError: true };
    }
  }

  async function drain() {
    if (running) return;
    running = true;
    while (pending.length) {
      const payload = normalizePayload(pending.shift());
      try {
        await pool.query('INSERT INTO webhook_events_raw (payload) VALUES ($1)', [payload]);
      } catch (error) {
        logger.error(`[KiotViet Webhook] Không lưu được raw event: ${error.message}`);
      }
    }
    running = false;
    if (resolveIdle) resolveIdle();
    resolveIdle = null;
  }

  function enqueue(payload) {
    pending.push(payload);
    if (!resolveIdle) idlePromise = new Promise((resolve) => { resolveIdle = resolve; });
    schedule(drain);
  }

  return { enqueue, onIdle: () => idlePromise };
}

module.exports = { createWebhookEventQueue };
