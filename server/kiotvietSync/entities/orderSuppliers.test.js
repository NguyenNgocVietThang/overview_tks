'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertChildReplacement, fakeClient } = require('./entityTestUtils');
const entity = require('./orderSuppliers');

test('orderSuppliers dung /ordersuppliers (khac /purchaseorders) va thay toan bo dong chi tiet', async () => {
  assert.equal(entity.endpoint, 'ordersuppliers');
  assert.equal(entity.entity, 'order_suppliers');
  await assertChildReplacement(
    entity,
    { id: 1297169, code: 'PDN000346', orderSupplierDetails: [{ productId: 48058241, quantity: 720 }, { productId: 48057065, quantity: 1080 }] },
    'order_supplier_details',
    1 // batchDetails: 2 dong chi tiet gop thanh 1 cau INSERT
  );
});

test('orderSuppliers map cot cha va dong chi tiet (chi co productId, khong co productCode)', async () => {
  const item = {
    id: 1297169, code: 'PDN000346', orderDate: '2026-09-28T07:49:28.2500000', supplierId: 1823550,
    total: 578482206, status: 1, statusValue: 'Đã xác nhận NCC', createdDate: '2026-09-28T07:49:28.2600000',
    orderSupplierDetails: [{ productId: 48058241, quantity: 720, price: 62739.5 }]
  };
  const client = fakeClient();
  await entity.upsertPage(client, 'saigon', [item]);
  const parent = client.calls.find(([sql]) => sql.startsWith('INSERT INTO order_suppliers'));
  assert.deepEqual(parent[1], [
    'saigon', 1297169, 'PDN000346', '2026-09-28T07:49:28.2500000', 1823550, 578482206, 1, '2026-09-28T07:49:28.2600000', item
  ]);
  const detail = client.calls.find(([sql]) => sql.startsWith('INSERT INTO order_supplier_details'));
  assert.deepEqual(detail[1], ['saigon', 1297169, 0, 48058241, 720, 62739.5, item.orderSupplierDetails[0]]);
});

test('orderSuppliers khong upsert bang staff (payload chi co userId, khong co ten)', async () => {
  const client = fakeClient();
  await entity.upsertPage(client, 'saigon', [{ id: 5, code: 'PDN5', userId: 1495024, createdBy: 1495024, orderSupplierDetails: [] }]);
  assert.equal(client.calls.some(([sql]) => /staff/i.test(sql)), false);
});

test('orderSuppliers doi soat toan bo danh sach, khong dua vao lastModifiedFrom', () => {
  assert.equal(entity.pollFullSnapshot, true);
});

test('orderSuppliers reconcile chi ghi phieu moi hoac doi trang thai, bo qua phieu khong doi', async () => {
  const same = { id: 1, code: 'PDN1', status: 1, statusValue: 'Đã xác nhận NCC', orderSupplierDetails: [{ productId: 3, quantity: 5 }] };
  const received = { id: 2, code: 'PDN2', status: 3, statusValue: 'Hoàn thành', orderSupplierDetails: [] };
  const added = { id: 3, code: 'PDN3', status: 1, statusValue: 'Đã xác nhận NCC', orderSupplierDetails: [{ productId: 4, quantity: 9 }] };
  const calls = [];
  const pg = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT')) return { rows: [
      { id: '1', raw: { statusValue: 'Đã xác nhận NCC', status: 1, code: 'PDN1', id: 1, orderSupplierDetails: [{ quantity: 5, productId: 3 }] } },
      { id: '2', raw: { ...received, status: 1, statusValue: 'Đã xác nhận NCC' } }
    ] };
    return { rows: [] };
  } };
  await entity.reconcilePage(pg, 'saigon', [same, received, added]);
  assert.deepEqual(calls[0].params, ['saigon', [1, 2, 3]]);
  assert.deepEqual(calls.filter(x => x.sql.startsWith('INSERT INTO order_suppliers')).map(x => x.params[1]), [2, 3]);
  assert.deepEqual(calls.filter(x => x.sql.startsWith('DELETE FROM order_supplier_details')).map(x => x.params), [['saigon', 2], ['saigon', 3]]);
});

test('orderSuppliers reconcile trang rong khong goi truy van nao', async () => {
  const calls = [];
  await entity.reconcilePage({ query: async (...args) => calls.push(args) }, 'saigon', []);
  assert.equal(calls.length, 0);
});
