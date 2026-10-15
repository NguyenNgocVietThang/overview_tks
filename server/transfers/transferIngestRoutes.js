'use strict';
// API cho bot Telegram "Yêu cầu chuyển tiền" (repo bot-yeu-cau-ck) — nguoi goi la bot, khong
// phai nguoi dung dang nhap, nen mount TRUOC requireAuth (routes.js). Xac thuc bang header
// X-Transfer-Bot-Secret (so sanh hang thoi gian). Chua cau hinh secret -> 404.
// Ghi DB xong moi tra 2xx; loi DB -> 503 de outbox cua bot thu lai (idempotency_key chong trung).

const express = require('express');
const { timingSafeEqual } = require('node:crypto');
const { createTransferService } = require('./transferService');

function secretMatches(received, expected) {
  const a = Buffer.from(String(received || ''));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

function createTransferIngestRouter({ secret, service = createTransferService(), logger = console } = {}) {
  const router = express.Router();
  router.use('/api/transfer-bot', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!secret) return res.status(404).json({ error: 'Chưa bật kết nối bot.' });
    if (!secretMatches(req.get('X-Transfer-Bot-Secret'), secret)) return res.status(403).json({ error: 'Khóa bí mật không hợp lệ.' });
    return next();
  });

  const handle = (context, fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error && error.statusCode && error.statusCode < 500) {
        const body = { error: error.message, code: error.code };
        if (error.field) body.field = error.field;
        if (error.paidAt !== undefined) Object.assign(body, { paidAt: error.paidAt, paidByName: error.paidByName });
        return res.status(error.statusCode).json(body);
      }
      logger.error(`[transfer-bot ${context}]`, error);
      return res.status(503).json({ error: 'Chưa lưu được, vui lòng thử lại.', code: 'UNAVAILABLE' });
    }
  };

  router.post('/api/transfer-bot/requests', handle('create', async (req, res) => {
    const { duplicate, request } = await service.createFromBot(req.body);
    res.status(duplicate ? 200 : 201).json({ id: request.id, status: request.status, version: request.version, duplicate });
  }));

  router.post('/api/transfer-bot/requests/:code/cancel', handle('cancel', async (req, res) => {
    const request = await service.cancelFromBot(req.params.code, req.body);
    res.json({ status: request.status, version: request.version, canceledByType: request.canceledByType });
  }));

  router.get('/api/transfer-bot/events', handle('events', async (req, res) => {
    res.json({ events: await service.listUndeliveredEvents(req.query.limit) });
  }));

  router.post('/api/transfer-bot/events/ack', handle('ack', async (req, res) => {
    res.json({ acked: await service.ackEvents(req.body && req.body.ids) });
  }));

  router.get('/api/transfer-bot/sales/:telegramId', handle('sale', async (req, res) => {
    res.json(await service.lookupSale(req.params.telegramId));
  }));

  return router;
}

module.exports = { createTransferIngestRouter, secretMatches };
