// ==========================================
// WEBHOOK KIOTVIET — /api/kiotviet/webhook/<secret>
//
// Nguoi goi la KiotViet (khong phai nguoi dung dang nhap) nen khong di qua
// requireAuth duoc. Thay vao do duong dan mang mot BI MAT dung chung
// (CONFIG.KIOTVIET_WEBHOOK_SECRET) — KiotViet khong gui header tuy y duoc nen
// dat secret tren duong dan la cach xac thuc kha thi duy nhat.
//
// Secret sai -> 404 (khong phai 401/403): khong xac nhan endpoint ton tai.
// Duong dan cu khong secret van chay trong giai doan chuyen tiep, co canh bao
// moi lan goi — tat bang KIOTVIET_WEBHOOK_LEGACY_PATH_ENABLED=false sau khi da
// doi URL trong cau hinh webhook ben KiotViet.
// ==========================================
'use strict';

const express = require('express');
const crypto = require('crypto');
const CONFIG = require('../config');
const { createWebhookEventQueue } = require('./webhookEventQueue');
const defaultQueue = createWebhookEventQueue();

const WEBHOOK_BASE_PATH = '/api/kiotviet/webhook';

/** So sanh chuoi theo thoi gian hang so — tranh ro ri secret qua do tre. */
function secretMatches(expected, received) {
  const expectedStr = String(expected || '');
  const receivedStr = String(received || '');
  if (!expectedStr || !receivedStr) return false;
  const expectedBuf = Buffer.from(expectedStr, 'utf8');
  const receivedBuf = Buffer.from(receivedStr, 'utf8');
  // timingSafeEqual nem loi khi khac do dai — bam HAM BAM truoc de hai buffer
  // luon cung do dai, van khong ro ri do dai secret that.
  const expectedHash = crypto.createHash('sha256').update(expectedBuf).digest();
  const receivedHash = crypto.createHash('sha256').update(receivedBuf).digest();
  return crypto.timingSafeEqual(expectedHash, receivedHash);
}

/** Moi duong dan webhook (co hoac khong secret) deu bat dau bang base path. */
function isWebhookUrl(url) {
  const path = String(url || '').split('?')[0];
  return path === WEBHOOK_BASE_PATH || path.startsWith(`${WEBHOOK_BASE_PATH}/`);
}

/** Doan secret tren duong dan, hoac '' voi duong dan cu khong secret. */
function secretFromUrl(url) {
  const path = String(url || '').split('?')[0];
  if (!path.startsWith(`${WEBHOOK_BASE_PATH}/`)) return '';
  return decodeURIComponent(path.slice(WEBHOOK_BASE_PATH.length + 1).split('/')[0]);
}

function createKiotVietWebhookRouter({
  enabled = CONFIG.KIOTVIET_SYNC_ENABLED,
  enqueue,
  secret = CONFIG.KIOTVIET_WEBHOOK_SECRET,
  legacyPathEnabled = CONFIG.KIOTVIET_WEBHOOK_LEGACY_PATH_ENABLED
} = {}) {
  const router = express.Router();
  const push = enqueue || defaultQueue.enqueue;

  function accept(req, res) {
    res.status(200).json({ received: true });
    if (enabled) push(req.body);
  }

  router.post(`${WEBHOOK_BASE_PATH}/:secret`, (req, res) => {
    if (!secretMatches(secret, req.params.secret)) {
      return res.status(404).json({ error: 'Không tìm thấy.' });
    }
    return accept(req, res);
  });

  router.post(WEBHOOK_BASE_PATH, (req, res) => {
    if (!legacyPathEnabled) {
      return res.status(404).json({ error: 'Không tìm thấy.' });
    }
    console.warn('[KiotViet] Webhook goi vao duong dan CU khong co secret — doi URL ben KiotViet sang /api/kiotviet/webhook/<secret> roi dat KIOTVIET_WEBHOOK_LEGACY_PATH_ENABLED=false.');
    return accept(req, res);
  });

  return router;
}

function captureWebhookRawBody(req, _res, buffer) {
  if (isWebhookUrl(req.originalUrl)) req.kiotvietRawBody = buffer.toString('utf8');
}

/**
 * express.json() nem SyntaxError TRUOC khi request toi duoc router, nen phai
 * xac thuc secret LAI o day — neu khong, bat ky ai cung co the nhet du lieu
 * rac vao hang doi su kien bang cach gui JSON hong.
 */
function createWebhookJsonErrorHandler({
  enabled = CONFIG.KIOTVIET_SYNC_ENABLED,
  enqueue = defaultQueue.enqueue,
  secret = CONFIG.KIOTVIET_WEBHOOK_SECRET,
  legacyPathEnabled = CONFIG.KIOTVIET_WEBHOOK_LEGACY_PATH_ENABLED
} = {}) {
  return function webhookJsonErrorHandler(error, req, res, next) {
    if (!(error instanceof SyntaxError) || !isWebhookUrl(req.originalUrl)) return next(error);
    const provided = secretFromUrl(req.originalUrl);
    const authorized = provided ? secretMatches(secret, provided) : legacyPathEnabled;
    if (!authorized) return res.status(404).json({ error: 'Không tìm thấy.' });
    res.status(200).json({ received: true });
    if (enabled) enqueue(req.kiotvietRawBody || '');
  };
}

const router = createKiotVietWebhookRouter();
module.exports = router;
module.exports.WEBHOOK_BASE_PATH = WEBHOOK_BASE_PATH;
module.exports.isWebhookUrl = isWebhookUrl;
module.exports.secretFromUrl = secretFromUrl;
module.exports.createKiotVietWebhookRouter = createKiotVietWebhookRouter;
module.exports.captureWebhookRawBody = captureWebhookRawBody;
module.exports.createWebhookJsonErrorHandler = createWebhookJsonErrorHandler;
module.exports.webhookJsonErrorHandler = createWebhookJsonErrorHandler();
