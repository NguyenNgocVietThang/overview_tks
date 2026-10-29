'use strict';

const crypto = require('crypto');
const express = require('express');

function tokenMatches(received, expected) {
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(String(expected));
  const receivedBuffer = Buffer.from(String(received));
  return expectedBuffer.length === receivedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function publicOrder(order) {
  const detail = order.detail || {};
  return {
    found: !!order.found,
    identitySource: order.identitySource || null,
    branch: order.branch || null,
    flow: order.flow || null,
    summary: order.summary || null,
    warnings: Array.isArray(order.warnings) ? order.warnings : [],
    detail: order.found ? {
      orderCode: detail.orderCode || null,
      saleName: detail.saleName || '',
      customerName: detail.customerName || '',
      saleTelegramId: detail.saleTelegramId || '',
      orderDate: detail.orderDate || '',
      orderTotal: detail.orderTotal ?? null,
      driverName: detail.driverName || '',
      saleSentAt: detail.saleSentAt || '',
      accountantApprovedAt: detail.accountantApprovedAt || '',
      driverConfirmedDeliveryAt: detail.driverConfirmedDeliveryAt || '',
      deliveryConfirmedAt: detail.deliveryConfirmedAt || '',
      shipReceivedAt: detail.shipReceivedAt || '',
      orderSignedAt: detail.orderSignedAt || ''
    } : null
  };
}

function createBotLifecycleIntegrationRouter({ token, findOrder }) {
  const router = express.Router();

  router.get('/:orderCode', async (req, res) => {
    if (!tokenMatches(req.get ? req.get('x-bot-lifecycle-token') : req.headers['x-bot-lifecycle-token'], token)) {
      return res.status(401).json({ error: 'Không có quyền truy cập.', code: 'BOT_TOKEN_REQUIRED' });
    }

    const orderCode = String(req.params.orderCode || '').trim();
    if (!orderCode || orderCode.length > 100) {
      return res.status(400).json({ error: 'Mã đơn không hợp lệ.', code: 'INVALID_ORDER_CODE' });
    }

    try {
      const requestedBranch = String(req.query.branch || '').trim().toUpperCase();
      const order = await findOrder(orderCode, requestedBranch);
      if (order.found && requestedBranch && order.branch !== requestedBranch) {
        return res.status(409).json({
          error: 'Mã đơn không thuộc cơ sở được yêu cầu.',
          code: 'BRANCH_MISMATCH',
          branch: order.branch
        });
      }
      return res.status(200).json(publicOrder(order));
    } catch (error) {
      console.error('[bot-lifecycle-integration] lookup failed', error.message);
      return res.status(503).json({ error: 'Chưa thể tra cứu trạng thái đơn.', code: 'LIFECYCLE_UNAVAILABLE' });
    }
  });

  return router;
}

// Read identity directly from Kiot's repository, never from bot-written Sheet rows.
async function findKiotIdentity(orderCode, branch, repository) {
  if (!['HN', 'SG'].includes(branch)) throw new Error('Explicit branch required');
  const result = await repository.readOrders();
  if (!result.ok || result.stale) throw new Error('Fresh Kiot data unavailable');
  const target = String(orderCode).trim().toUpperCase();
  const order = result.orders.find(o => o.branch === branch && String(o.code).trim().toUpperCase() === target);
  return {
    found: !!order, branch, identitySource: 'kiotviet',
    detail: order ? { orderCode: order.code, saleName: order.saleName,
      saleTelegramId: order.saleTelegramId, customerName: order.customerName,
      orderDate: order.orderDate, orderTotal: order.total } : null
  };
}

module.exports = { createBotLifecycleIntegrationRouter, publicOrder, tokenMatches, findKiotIdentity };
