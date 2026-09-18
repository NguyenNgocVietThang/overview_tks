'use strict';

const { getPool } = require('../db/pool');

function createWebhookEventQueue({ pool = getPool(), logger = console, schedule = queueMicrotask, processEvent = null } = {}) {
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
      const { branch, eventType, payload: rawPayload } = pending.shift();
      const payload = normalizePayload(rawPayload);
      try {
        await pool.query('INSERT INTO webhook_events_raw (payload) VALUES ($1)', [payload]);
      } catch (error) {
        logger.error(`[KiotViet Webhook] Không lưu được raw event: ${error.message}`);
      }
      // Ghi tho luon thuc hien truoc, du xu ly ap dung du lieu that ben duoi
      // co that bai - webhook_events_raw la nguon phuc hoi/audit doc lap.
      if (processEvent) {
        try {
          await processEvent({ branch, eventType, payload });
        } catch (error) {
          logger.error(`[KiotViet Webhook] Xử lý sự kiện thất bại (branch=${branch}, eventType=${eventType}): ${error.message}`);
        }
      }
    }
    running = false;
    if (resolveIdle) resolveIdle();
    resolveIdle = null;
  }

  // Chap nhan ca 2 dang: enqueue(payloadTho) (tuong thich nguoc, khong co
  // branch/eventType - vd goi truc tiep tu test) va enqueue({branch,
  // eventType, payload}) (dang thuc te tu kiotvietWebhookRoutes.js).
  function enqueue(event) {
    const normalized = (event && typeof event === 'object' && 'payload' in event)
      ? event
      : { branch: null, eventType: null, payload: event };
    pending.push(normalized);
    if (!resolveIdle) idlePromise = new Promise((resolve) => { resolveIdle = resolve; });
    schedule(drain);
  }

  return { enqueue, onIdle: () => idlePromise };
}

module.exports = { createWebhookEventQueue };
