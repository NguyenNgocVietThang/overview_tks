'use strict';

const express = require('express');
const CONFIG = require('../config');
const { createWebhookEventQueue } = require('./webhookEventQueue');
const defaultQueue = createWebhookEventQueue();

function createKiotVietWebhookRouter({ enabled = CONFIG.KIOTVIET_SYNC_ENABLED, enqueue } = {}) {
  const router = express.Router();
  const push = enqueue || defaultQueue.enqueue;
  router.post('/api/kiotviet/webhook', (req, res) => {
    res.status(200).json({ received: true });
    if (enabled) push(req.body);
  });
  return router;
}

function captureWebhookRawBody(req, _res, buffer) {
  if (req.originalUrl === '/api/kiotviet/webhook') req.kiotvietRawBody = buffer.toString('utf8');
}

function createWebhookJsonErrorHandler({ enabled = CONFIG.KIOTVIET_SYNC_ENABLED, enqueue = defaultQueue.enqueue } = {}) {
  return function webhookJsonErrorHandler(error, req, res, next) {
    if (!(error instanceof SyntaxError) || req.originalUrl !== '/api/kiotviet/webhook') return next(error);
    res.status(200).json({ received: true });
    if (enabled) enqueue(req.kiotvietRawBody || '');
  };
}

const router = createKiotVietWebhookRouter();
module.exports = router;
module.exports.createKiotVietWebhookRouter = createKiotVietWebhookRouter;
module.exports.captureWebhookRawBody = captureWebhookRawBody;
module.exports.createWebhookJsonErrorHandler = createWebhookJsonErrorHandler;
module.exports.webhookJsonErrorHandler = createWebhookJsonErrorHandler();
