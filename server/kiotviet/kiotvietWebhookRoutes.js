'use strict';

const express = require('express');
const CONFIG = require('../config');
const { createWebhookEventQueue } = require('./webhookEventQueue');
const { processWebhookEvent } = require('../kiotvietSync/webhookConsumer');
const { getConfiguredBranches } = require('../kiotvietSync/config');
const { createKiotVietClient } = require('./kiotVietApiClient');
const { getPool } = require('../db/pool');

// Secret tu chon (KIOTVIET_WEBHOOK_SECRET), gan vao query string luc dang ky
// webhook (?secret=...) - KHONG phai chu ky HMAC do KiotViet cap. So khop
// don gian, luon tra 200 du dung/sai (KiotViet tu ngung goi endpoint sau
// nhieu lan nhan ma 4xx - xem ghi chu o cuoi file).
function isValidWebhookSecret(expected, received) {
  return typeof expected === 'string' && expected.length > 0 &&
    typeof received === 'string' && received === expected;
}

function normalizeBranch(value) {
  const branch = String(value || '').toLowerCase();
  return branch === 'hanoi' || branch === 'saigon' ? branch : null;
}

// Cache 1 KiotViet client theo branch (token tu cache 24h ben trong client -
// xem kiotVietApiClient.js) de webhookConsumer hydrate item khong phai tao
// lai client/goi lai token moi lan.
function createBranchClientResolver({ getConfiguredBranches: getBranches = getConfiguredBranches, createKiotVietClient: createClient = createKiotVietClient } = {}) {
  const clients = new Map();
  return function resolve(branch) {
    if (clients.has(branch)) return clients.get(branch);
    const branchConfig = getBranches().find((b) => b.branch === branch);
    if (!branchConfig) return null;
    const client = createClient(branchConfig);
    clients.set(branch, client);
    return client;
  };
}

function createDefaultProcessEvent({ pool = getPool(), resolveClient = createBranchClientResolver(), logger = console } = {}) {
  return async function processEvent({ branch, eventType, payload }) {
    if (!branch) {
      logger.warn(`[KiotViet Webhook] Bo qua event thieu branch (eventType=${eventType}) - kiem tra lai URL dang ky webhook.`);
      return;
    }
    const kiotVietClient = resolveClient(branch);
    if (!kiotVietClient) {
      logger.warn(`[KiotViet Webhook] Bo qua event vi co so "${branch}" chua du credentials.`);
      return;
    }
    const result = await processWebhookEvent({ branch, eventType, payload, pool, kiotVietClient, log: logger.log ? logger.log.bind(logger) : () => {} });
    if (result.processed) logger.log(`[KiotViet Webhook] ${branch}/${eventType}: da ap dung ${result.processed} ban ghi.`);
  };
}

let defaultQueue = null;
function getDefaultQueue() {
  if (!defaultQueue) defaultQueue = createWebhookEventQueue({ processEvent: createDefaultProcessEvent() });
  return defaultQueue;
}

function createKiotVietWebhookRouter({ enabled = CONFIG.KIOTVIET_SYNC_ENABLED, secret = CONFIG.KIOTVIET_WEBHOOK_SECRET, enqueue } = {}) {
  const router = express.Router();
  router.post('/api/kiotviet/webhook', (req, res) => {
    res.status(200).json({ received: true });
    if (!enabled) return;
    if (!isValidWebhookSecret(secret, req.query.secret)) return;
    (enqueue || getDefaultQueue().enqueue)({
      branch: normalizeBranch(req.query.branch),
      eventType: String(req.query.eventType || req.query.type || '').toLowerCase(),
      payload: req.body
    });
  });
  return router;
}

function captureWebhookRawBody(req, _res, buffer) {
  if (req.originalUrl.startsWith('/api/kiotviet/webhook')) req.kiotvietRawBody = buffer.toString('utf8');
}

function createWebhookJsonErrorHandler({ enabled = CONFIG.KIOTVIET_SYNC_ENABLED, secret = CONFIG.KIOTVIET_WEBHOOK_SECRET, enqueue } = {}) {
  return function webhookJsonErrorHandler(error, req, res, next) {
    if (!(error instanceof SyntaxError) || !req.originalUrl.startsWith('/api/kiotviet/webhook')) return next(error);
    res.status(200).json({ received: true });
    if (!enabled) return;
    if (!isValidWebhookSecret(secret, req.query.secret)) return;
    (enqueue || getDefaultQueue().enqueue)({
      branch: normalizeBranch(req.query.branch),
      eventType: String(req.query.eventType || req.query.type || '').toLowerCase(),
      payload: req.kiotvietRawBody || ''
    });
  };
}

const router = createKiotVietWebhookRouter();
module.exports = router;
module.exports.createKiotVietWebhookRouter = createKiotVietWebhookRouter;
module.exports.captureWebhookRawBody = captureWebhookRawBody;
module.exports.createWebhookJsonErrorHandler = createWebhookJsonErrorHandler;
module.exports.webhookJsonErrorHandler = createWebhookJsonErrorHandler();
module.exports.isValidWebhookSecret = isValidWebhookSecret;
module.exports.normalizeBranch = normalizeBranch;
