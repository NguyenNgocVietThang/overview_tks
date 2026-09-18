'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeNotifications, resolveRoute, extractId, hydrateItems, deleteItems, processWebhookEvent
} = require('./webhookConsumer');

test('normalizeNotifications doc dang Notifications[] chuan, gan Action mac dinh tu eventType neu thieu', () => {
  const payload = { Notifications: [{ Data: [{ Id: 1 }] }] };
  const result = normalizeNotifications(payload, 'invoice.update');
  assert.deepEqual(result, [{ Data: [{ Id: 1 }], Action: 'invoice.update' }]);
});

test('normalizeNotifications giu nguyen Action da co san trong notification', () => {
  const payload = { Notifications: [{ Action: 'product.delete', Data: [{ Id: 9 }] }] };
  const result = normalizeNotifications(payload, 'product.update');
  assert.deepEqual(result, [{ Action: 'product.delete', Data: [{ Id: 9 }] }]);
});

test('normalizeNotifications nhan dang payload phang co Action rieng', () => {
  const payload = { Action: 'category.update', Data: { Id: 5 } };
  assert.deepEqual(normalizeNotifications(payload, ''), [payload]);
});

test('normalizeNotifications suy ra tu RemoveId cho su kien .delete', () => {
  const payload = { RemoveId: [10, 11] };
  const result = normalizeNotifications(payload, 'customer.delete');
  assert.deepEqual(result, [{ Action: 'customer.delete', Data: [{ Id: 10, id: 10 }, { Id: 11, id: 11 }] }]);
});

test('normalizeNotifications suy ra tu Data phang khi co eventType nhung khong co Action/Notifications', () => {
  const payload = { Data: [{ Id: 1 }] };
  const result = normalizeNotifications(payload, 'order.update');
  assert.deepEqual(result, [{ Action: 'order.update', Data: [{ Id: 1 }] }]);
});

test('normalizeNotifications tra mang rong khi payload khong nhan dien duoc', () => {
  assert.deepEqual(normalizeNotifications({}, 'invoice.update'), []);
  assert.deepEqual(normalizeNotifications(null, 'invoice.update'), []);
  assert.deepEqual(normalizeNotifications('not-an-object', 'invoice.update'), []);
});

test('resolveRoute anh xa dung entity, chi cho .delete o cac loai KiotViet thuc su ho tro xoa', () => {
  assert.deepEqual(resolveRoute('invoice.update'), { entity: 'invoices', isDelete: false });
  assert.deepEqual(resolveRoute('order.update'), { entity: 'orders', isDelete: false });
  assert.deepEqual(resolveRoute('product.update'), { entity: 'products', isDelete: false });
  assert.deepEqual(resolveRoute('product.delete'), { entity: 'products', isDelete: true });
  assert.deepEqual(resolveRoute('stock.update'), { entity: 'products', isDelete: false });
  assert.deepEqual(resolveRoute('customer.delete'), { entity: 'customers', isDelete: true });
  assert.deepEqual(resolveRoute('category.delete'), { entity: 'categories', isDelete: true });
  assert.equal(resolveRoute('unknown.update'), null);
  assert.equal(resolveRoute(''), null);
});

test('extractId doc Id hoac id, tra null neu khong co', () => {
  assert.equal(extractId({ Id: 5 }), 5);
  assert.equal(extractId({ id: 7 }), 7);
  assert.equal(extractId({}), null);
  assert.equal(extractId(null), null);
});

test('hydrateItems goi fetchById dung endpoint/listQuery, uu tien field cua item webhook khi trung', async () => {
  const calls = [];
  const kiotVietClient = {
    async fetchById(endpoint, id, query) {
      calls.push({ endpoint, id, query });
      return { Id: id, Code: 'HD' + id, Total: 1000, CustomerId: 99 };
    }
  };
  const entityModule = { endpoint: 'invoices', listQuery: { includePayment: 'true' } };
  const result = await hydrateItems(kiotVietClient, entityModule, [{ Id: 1, Total: 2000 }]);
  assert.deepEqual(calls, [{ endpoint: 'invoices', id: 1, query: { includePayment: 'true' } }]);
  assert.deepEqual(result, [{ Id: 1, Code: 'HD1', Total: 2000, CustomerId: 99 }], 'Total tu webhook (2000) phai thang Total tu hydrate (1000)');
});

test('hydrateItems giu nguyen item khong co Id (khong goi API)', async () => {
  let called = false;
  const kiotVietClient = { async fetchById() { called = true; return {}; } };
  const result = await hydrateItems(kiotVietClient, { endpoint: 'invoices', listQuery: {} }, [{ Code: 'no-id' }]);
  assert.equal(called, false);
  assert.deepEqual(result, [{ Code: 'no-id' }]);
});

test('deleteItems xoa dung branch+id, bo qua item khong co id', async () => {
  const calls = [];
  const client = { query: async (sql, params) => calls.push({ sql, params }) };
  await deleteItems(client, 'hanoi', 'products', [{ Id: 1 }, {}, { Id: 3 }], { log: () => {} });
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /DELETE FROM products WHERE branch=\$1 AND id=\$2/);
  assert.deepEqual(calls[0].params, ['hanoi', 1]);
  assert.deepEqual(calls[1].params, ['hanoi', 3]);
});

function fakePool() {
  const clientCalls = [];
  const client = {
    query: async (sql) => clientCalls.push(sql),
    release: () => {}
  };
  return { client, clientCalls, connect: async () => client };
}

test('processWebhookEvent: su kien update hydrate roi goi upsertPage trong 1 transaction', async () => {
  const pool = fakePool();
  const upsertCalls = [];
  const entityModules = {
    invoices: { endpoint: 'invoices', listQuery: {}, async upsertPage(_c, branch, items) { upsertCalls.push({ branch, items }); } }
  };
  const kiotVietClient = { async fetchById(_e, id) { return { Id: id, Full: true }; } };

  const result = await processWebhookEvent({
    branch: 'hanoi', eventType: 'invoice.update',
    payload: { Notifications: [{ Data: [{ Id: 1 }] }] },
    pool, kiotVietClient, entityModules, log: () => {}
  });

  assert.equal(result.processed, 1);
  assert.deepEqual(upsertCalls, [{ branch: 'hanoi', items: [{ Id: 1, Full: true }] }]);
  assert.deepEqual(pool.clientCalls, ['BEGIN', 'COMMIT']);
});

test('processWebhookEvent: su kien delete goi DELETE, khong hydrate/khong goi upsertPage', async () => {
  const pool = fakePool();
  let upsertCalled = false;
  const entityModules = { products: { endpoint: 'products', listQuery: {}, async upsertPage() { upsertCalled = true; } } };
  let hydrateCalled = false;
  const kiotVietClient = { async fetchById() { hydrateCalled = true; return {}; } };

  const result = await processWebhookEvent({
    branch: 'saigon', eventType: 'product.delete',
    payload: { RemoveId: [42] },
    pool, kiotVietClient, entityModules, log: () => {}
  });

  assert.equal(result.processed, 1);
  assert.equal(upsertCalled, false);
  assert.equal(hydrateCalled, false);
  assert.ok(pool.clientCalls.some((sql) => sql.includes('DELETE FROM products')));
});

test('processWebhookEvent: rollback khi upsertPage that bai, khong nuot loi', async () => {
  const client = { query: async (sql) => { if (sql === 'BEGIN' || sql === 'ROLLBACK') return; }, release: () => {} };
  const pool = { connect: async () => client };
  const entityModules = { orders: { endpoint: 'orders', listQuery: {}, async upsertPage() { throw new Error('db loi'); } } };
  const kiotVietClient = { async fetchById(_e, id) { return { Id: id }; } };

  await assert.rejects(
    processWebhookEvent({
      branch: 'hanoi', eventType: 'order.update',
      payload: { Data: [{ Id: 1 }] },
      pool, kiotVietClient, entityModules, log: () => {}
    }),
    /db loi/
  );
});

test('processWebhookEvent: eventType chua ho tro thi bo qua, khong loi, processed=0', async () => {
  const pool = fakePool();
  const result = await processWebhookEvent({
    branch: 'hanoi', eventType: 'supplier.update',
    payload: { Data: [{ Id: 1 }] },
    pool, kiotVietClient: {}, entityModules: {}, log: () => {}
  });
  assert.equal(result.processed, 0);
});
