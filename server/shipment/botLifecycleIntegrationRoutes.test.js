'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createBotLifecycleIntegrationRouter } = require('./botLifecycleIntegrationRoutes');

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = code => { res.statusCode = code; return res; };
  res.json = payload => { res.body = payload; return res; };
  return res;
}

async function callLookup(router, req) {
  const layer = router.stack.find(item => item.route && item.route.path === '/:orderCode');
  if (!layer) throw new Error('Không tìm thấy route tra cứu bot');
  const res = fakeRes();
  for (const entry of layer.route.stack) {
    let nextCalled = false;
    await entry.handle(req, res, () => { nextCalled = true; });
    if (!nextCalled) break;
  }
  return res;
}

test('bot integration rejects a request without the private token', async () => {
  const router = createBotLifecycleIntegrationRouter({
    token: 'private-token',
    findOrder: async () => { throw new Error('must not read order'); }
  });

  const res = await callLookup(router, { headers: {}, params: { orderCode: 'DH046861' }, query: {} });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Không có quyền truy cập.', code: 'BOT_TOKEN_REQUIRED' });
});

test('bot integration returns only the lifecycle fields needed to reconcile an exact order', async () => {
  const router = createBotLifecycleIntegrationRouter({
    token: 'private-token',
    findOrder: async code => ({
      found: true,
      branch: 'HN',
      flow: 'DELIVERY',
      summary: { code: 'DELIVERING', label: 'Đơn đang được giao', at: '28/10/2026 12:16' },
      warnings: ['DRIVER_FORGOT_PHOTO'],
      detail: {
        orderCode: code,
        saleName: 'Nguyễn Thị Ngọc Lan',
        customerName: 'KH C Quỳnh Hải Dương',
        driverName: 'Tài xế 122',
        saleSentAt: '28/10/2026 08:21',
        accountantApprovedAt: '28/10/2026 08:21',
        driverConfirmedDeliveryAt: '28/10/2026 12:16',
        deliveryConfirmedAt: '',
        shipReceivedAt: '',
        orderSignedAt: ''
      },
      internalOnly: 'must not leak'
    })
  });

  const res = await callLookup(router, {
    headers: { 'x-bot-lifecycle-token': 'private-token' },
    params: { orderCode: 'DH046861' },
    query: {}
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    found: true,
    branch: 'HN',
    flow: 'DELIVERY',
    summary: { code: 'DELIVERING', label: 'Đơn đang được giao', at: '28/10/2026 12:16' },
    warnings: ['DRIVER_FORGOT_PHOTO'],
    detail: {
      orderCode: 'DH046861',
      saleName: 'Nguyễn Thị Ngọc Lan',
      customerName: 'KH C Quỳnh Hải Dương',
      driverName: 'Tài xế 122',
      saleSentAt: '28/10/2026 08:21',
      accountantApprovedAt: '28/10/2026 08:21',
      driverConfirmedDeliveryAt: '28/10/2026 12:16',
      deliveryConfirmedAt: '',
      shipReceivedAt: '',
      orderSignedAt: ''
    }
  });
});

test('bot integration can enforce the requested branch', async () => {
  const router = createBotLifecycleIntegrationRouter({
    token: 'private-token',
    findOrder: async () => ({ found: true, branch: 'HN', flow: 'DELIVERY', summary: {}, warnings: [], detail: {} })
  });

  const res = await callLookup(router, {
    headers: { 'x-bot-lifecycle-token': 'private-token' },
    params: { orderCode: 'DH046861' },
    query: { branch: 'SG' }
  });

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: 'Mã đơn không thuộc cơ sở được yêu cầu.', code: 'BRANCH_MISMATCH', branch: 'HN' });
});
