'use strict';

const express = require('express');
const { timingSafeEqual } = require('node:crypto');

function createManagerLeaveWebhook({ enabled, secret, store, wake = () => {}, acknowledge = () => {}, logger = console } = {}) {
  const router = express.Router();
  router.post('/api/telegram/manager-leave/webhook', async (req, res) => {
    if (!enabled || !secret) return res.status(404).json({ error: 'Bot chưa được bật.' });
    const received = Buffer.from(String(req.get('X-Telegram-Bot-Api-Secret-Token') || ''));
    const expected = Buffer.from(secret);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      return res.status(403).json({ error: 'Webhook không hợp lệ.' });
    }
    const update = req.body;
    if (!update || !Number.isSafeInteger(update.update_id) || update.update_id < 0) {
      return res.status(400).json({ error: 'Update không hợp lệ.' });
    }
    if (!update.message && !update.callback_query) return res.status(200).json({ ok: true });
    try {
      const started=Date.now();
      const inserted = await store.enqueueUpdate(update);
      if(logger.info)logger.info('[Telegram manager] timing',{stage:'enqueue',ms:Date.now()-started,updateId:update.update_id});
      if(inserted && update.callback_query) Promise.resolve().then(()=>acknowledge(update)).catch(()=>logger.error('[Telegram manager] Không thể phản hồi callback sớm.'));
      res.status(200).json({ ok: true });
      if (inserted) Promise.resolve().then(wake).catch(() => logger.error('[Telegram manager] Không thể đánh thức tác vụ nền.'));
    } catch (_) {
      // Acknowledge only after a durable insert. Telegram will retry 503.
      res.status(503).json({ error: 'Chưa thể lưu thao tác, Telegram sẽ thử lại.' });
    }
  });
  return router;
}

module.exports = { createManagerLeaveWebhook };
