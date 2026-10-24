'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const notificationRoutes = require('./notificationRoutes');
const { useNotificationTestPool } = require('./testHelpers/notificationTestPool');

const N1 = '00000000-0000-4000-8000-000000000001';
const N2 = '00000000-0000-4000-8000-000000000002';
const N3 = '00000000-0000-4000-8000-000000000003';
let store;
test.before(async () => { store = await useNotificationTestPool(); });
test.after(() => store.close());

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = code => { res.statusCode = code; return res; };
  res.json = payload => { res.body = payload; return res; };
  return res;
}

function getRouteHandler(router, method, routePath) {
  const layer = router.stack.find(l => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`Không tìm thấy route: ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

test('GET /api/notifications trả về danh sách của đúng người dùng đang đăng nhập', async () => {
  await store.seed([
    { id: N1, recipientUserId: 'u1', type: 't', title: 'A', message: '', isRead: false, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: N2, recipientUserId: 'u2', type: 't', title: 'B', message: '', isRead: false, createdAt: '2026-01-01T00:00:00.000Z' }
  ]);
  const handler = getRouteHandler(notificationRoutes, 'get', '/api/notifications');
  const req = { user: { id: 'u1' }, query: {} };
  const res = fakeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.notifications.length, 1);
  assert.equal(res.body.notifications[0].id, N1);
});

test('GET /api/notifications/unread-count đếm đúng số chưa đọc', async () => {
  await store.seed([
    { id: N1, recipientUserId: 'u1', type: 't', title: 'A', message: '', isRead: false, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: N2, recipientUserId: 'u1', type: 't', title: 'B', message: '', isRead: true, createdAt: '2026-01-01T00:00:00.000Z' }
  ]);
  const handler = getRouteHandler(notificationRoutes, 'get', '/api/notifications/unread-count');
  const req = { user: { id: 'u1' } };
  const res = fakeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.count, 1);
});

test('PATCH /api/notifications/:id/read đánh dấu đã đọc', async () => {
  await store.seed([
    { id: N1, recipientUserId: 'u1', type: 't', title: 'A', message: '', isRead: false, createdAt: '2026-01-01T00:00:00.000Z' }
  ]);
  const handler = getRouteHandler(notificationRoutes, 'patch', '/api/notifications/:id/read');
  const req = { user: { id: 'u1' }, params: { id: N1 } };
  const res = fakeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.notification.isRead, true);
});

test('PATCH /api/notifications/:id/read trả 404 nếu không thuộc user', async () => {
  await store.seed([
    { id: N1, recipientUserId: 'someone-else', type: 't', title: 'A', message: '', isRead: false, createdAt: '2026-01-01T00:00:00.000Z' }
  ]);
  const handler = getRouteHandler(notificationRoutes, 'patch', '/api/notifications/:id/read');
  const req = { user: { id: 'u1' }, params: { id: N1 } };
  const res = fakeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 404);
});

test('PATCH /api/notifications/read-all đánh dấu toàn bộ đã đọc', async () => {
  await store.seed([
    { id: N1, recipientUserId: 'u1', type: 't', title: 'A', message: '', isRead: false, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: N2, recipientUserId: 'u1', type: 't', title: 'B', message: '', isRead: false, createdAt: '2026-01-01T00:00:00.000Z' }
  ]);
  const handler = getRouteHandler(notificationRoutes, 'patch', '/api/notifications/read-all');
  const req = { user: { id: 'u1' } };
  const res = fakeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.changed, 2);
});

test('DELETE /api/notifications/:id xóa đúng thông báo của user', async () => {
  await store.seed([
    { id: N1, recipientUserId: 'u1', type: 't', title: 'A', message: '', isRead: false, createdAt: '2026-01-01T00:00:00.000Z' }
  ]);
  const handler = getRouteHandler(notificationRoutes, 'delete', '/api/notifications/:id');
  const req = { user: { id: 'u1' }, params: { id: N1 } };
  const res = fakeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.deleted, true);
});

test('DELETE /api/notifications/:id trả 404 nếu không thuộc user', async () => {
  await store.seed([
    { id: N1, recipientUserId: 'someone-else', type: 't', title: 'A', message: '', isRead: false, createdAt: '2026-01-01T00:00:00.000Z' }
  ]);
  const handler = getRouteHandler(notificationRoutes, 'delete', '/api/notifications/:id');
  const req = { user: { id: 'u1' }, params: { id: N1 } };
  const res = fakeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 404);
});

test('DELETE /api/notifications xóa toàn bộ thông báo của user', async () => {
  await store.seed([
    { id: N1, recipientUserId: 'u1', type: 't', title: 'A', message: '', isRead: false, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: N2, recipientUserId: 'u1', type: 't', title: 'B', message: '', isRead: false, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: N3, recipientUserId: 'u2', type: 't', title: 'C', message: '', isRead: false, createdAt: '2026-01-01T00:00:00.000Z' }
  ]);
  const handler = getRouteHandler(notificationRoutes, 'delete', '/api/notifications');
  const req = { user: { id: 'u1' } };
  const res = fakeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.deleted, 2);
});
