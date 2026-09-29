'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeClient } = require('./entityTestUtils');
const entity = require('./products');
test('products maps verified fields and preserves raw JSON', async () => {
  const item = { Id: 1, Code: 'SP1', Name: 'Tea', CategoryId: 2, BasePrice: 12000, Unit: 'box', IsActive: true, CreatedDate: 'c', ModifiedDate: 'm' };
  const client = fakeClient();
  await entity.upsertPage(client, 'hanoi', [item]);
  const upsert = client.calls.find((call) => /ON CONFLICT \(branch, id\) DO UPDATE/.test(call[0]));
  assert.deepEqual(upsert[1], ['hanoi', 1, 'SP1', 'Tea', 2, 12000, 'box', true, 'c', 'm', item]);
});

test('KiotViet dung lai ma cua san pham cu (id khac): doi ma dong cu truoc khi upsert, tranh vi pham UNIQUE (branch, code)', async () => {
  const items = [{ Id: 99, Code: 'KCCK16', Name: 'Moi' }, { Id: 100, Code: 'SP2', Name: 'Khac' }];
  const client = fakeClient();
  await entity.upsertPage(client, 'hanoi', items);
  const [release, ...upserts] = client.calls;
  assert.match(release[0], /^\s*UPDATE products/);
  assert.deepEqual(release[1], ['hanoi', ['KCCK16', 'SP2'], ['99', '100']]);
  assert.equal(upserts.length, 2);
  assert.ok(upserts.every((call) => /ON CONFLICT \(branch, id\)/.test(call[0])));
});

test('trang rong khong goi query nao', async () => {
  const client = fakeClient();
  await entity.upsertPage(client, 'hanoi', []);
  assert.equal(client.calls.length, 0);
});
