'use strict';
// API trang /transfers/ — mount o routes.js: router.use('/api/transfers', requireAuth, ...).
// Kiem quyen chi tiet nam trong transferService (day la ranh gioi bao mat that su).

const express = require('express');
const { requireFeature } = require('../auth/authMiddleware');
const { transferEvents } = require('./transferEvents');
const { createTransferService, can } = require('./transferService');
const { hasFeature } = require('../auth/featureRegistry');

const ANY_TRANSFER_FEATURE = ['transfers.view', 'transfers.own', 'transfers.review', 'transfers.markPaid'];

function sendError(res, error, context) {
  if (error && error.statusCode && error.statusCode < 500) {
    const body = { error: error.message, code: error.code };
    if (error.field) body.field = error.field;
    if (error.current) body.request = error.current;
    if (error.request) body.request = error.request;
    return res.status(error.statusCode).json(body);
  }
  console.error(`[transfers ${context}]`, error);
  return res.status(500).json({ error: 'Lỗi hệ thống, vui lòng thử lại sau.', code: 'TRANSFER_ERROR' });
}

function createTransferRouter({ service = createTransferService(), events = transferEvents } = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(requireFeature(...ANY_TRANSFER_FEATURE));

  const handle = (context, fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      sendError(res, error, context);
    }
  };

  // SSE: chi bao "co thay doi" (id/version/status); client tai lai qua API da kiem quyen.
  router.get('/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(': connected\n\n');
    const seesAll = hasFeature(req.user, 'transfers.view', 'transfers.review');
    const ownId = String(req.user.telegramId || '').trim();
    const onEvent = (payload) => {
      if (!seesAll && (!ownId || payload.saleTelegramId !== ownId)) return;
      try {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch (_) {}
    };
    events.on('transfer-event', onEvent);
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (_) { clearInterval(heartbeat); }
    }, 25000);
    req.on('close', () => {
      events.removeListener('transfer-event', onEvent);
      clearInterval(heartbeat);
    });
  });

  router.get('/', handle('list', async (req, res) => {
    const { status, q, from, to, page, pageSize } = req.query;
    const result = await service.listForUser(req.user, { status: status || null, q, from: from || null, to: to || null, page, pageSize });
    res.json({
      ...result,
      permissions: {
        review: can.review(req.user),
        markPaid: can.markPaid(req.user),
        viewAll: can.viewAll(req.user) || can.review(req.user)
      }
    });
  }));

  router.get('/banks', handle('banks', async (req, res) => {
    if (!can.review(req.user)) return res.status(403).json({ error: 'Tài khoản không có quyền.', code: 'FORBIDDEN' });
    res.json({ banks: await service.listBanks() });
  }));

  const id = req => {
    const value = Number(req.params.id);
    if (!Number.isSafeInteger(value) || value < 1) {
      const error = new Error('Mã yêu cầu không hợp lệ.');
      error.statusCode = 400;
      error.code = 'INVALID';
      throw error;
    }
    return value;
  };

  router.get('/:id', handle('detail', async (req, res) => res.json(await service.getForUser(req.user, id(req)))));
  router.get('/:id/vietqr', handle('vietqr', async (req, res) => res.json(await service.vietQr(req.user, id(req)))));
  router.patch('/:id', handle('edit', async (req, res) => res.json({ request: await service.edit(req.user, id(req), req.body) })));
  for (const [path, method] of [
    ['approve', 'approve'], ['unapprove', 'unapprove'], ['cancel', 'cancel'],
    ['mark-paid', 'markPaid'], ['revert-paid', 'revertPaid']
  ]) {
    router.post(`/:id/${path}`, handle(path, async (req, res) => res.json({ request: await service[method](req.user, id(req), req.body) })));
  }

  return router;
}

module.exports = { createTransferRouter, sendError };
