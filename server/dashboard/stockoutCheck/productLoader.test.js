'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadActiveCandidates } = require('./productLoader');

function makeClient(pages) {
  return {
    async fetchAllPages(endpoint, query, onPage) {
      assert.equal(endpoint, 'products');
      assert.equal(query.includeInventory, 'true');
      for (const page of pages) await onPage(page);
    }
  };
}

test('loadActiveCandidates loc dung isActive, mac dinh thieu field la dang kinh doanh', async () => {
  const client = makeClient([[
    { productCode: 'SP001', fullName: 'Con hang', isActive: true, inventories: [] },
    { productCode: 'SP002', fullName: 'Ngung kinh doanh', isActive: false, inventories: [] },
    { productCode: 'SP003', fullName: 'Khong ghi isActive', inventories: [] }
  ]]);
  const { candidates, totalProductsScanned } = await loadActiveCandidates(client);
  assert.equal(totalProductsScanned, 3);
  assert.deepEqual(candidates.map((c) => c.code).sort(), ['SP001', 'SP003']);
});

test('loadActiveCandidates tinh tong ton kho qua nhieu chi nhanh (inventories)', async () => {
  const client = makeClient([[
    { productCode: 'SP001', name: 'Nhieu chi nhanh', isActive: true, inventories: [{ onHand: 100 }, { onHand: 251 }] }
  ]]);
  const { candidates } = await loadActiveCandidates(client);
  assert.equal(candidates[0].currentOnHand, 351);
});

test('loadActiveCandidates dung fullName truoc, roi moi den name', async () => {
  const client = makeClient([[
    { productCode: 'SP001', fullName: 'Ten day du', name: 'Ten ngan', isActive: true, inventories: [] },
    { productCode: 'SP002', name: 'Chi co name', isActive: true, inventories: [] }
  ]]);
  const { candidates } = await loadActiveCandidates(client);
  assert.equal(candidates.find((c) => c.code === 'SP001').name, 'Ten day du');
  assert.equal(candidates.find((c) => c.code === 'SP002').name, 'Chi co name');
});

test('loadActiveCandidates doc createdDateKey qua toVnDateKey, null neu thieu', async () => {
  const client = makeClient([[
    { productCode: 'SP001', isActive: true, inventories: [], createdDate: '2026-08-04T09:44:00' },
    { productCode: 'SP002', isActive: true, inventories: [] }
  ]]);
  const { candidates } = await loadActiveCandidates(client);
  assert.equal(candidates.find((c) => c.code === 'SP001').createdDateKey, '2026-08-04');
  assert.equal(candidates.find((c) => c.code === 'SP002').createdDateKey, null);
});

test('loadActiveCandidates bo qua ma trong, khong dem vao totalProductsScanned', async () => {
  const client = makeClient([[
    { productCode: '', isActive: true, inventories: [] },
    { productCode: 'SP001', isActive: true, inventories: [] }
  ]]);
  const { candidates, totalProductsScanned } = await loadActiveCandidates(client);
  assert.equal(totalProductsScanned, 1);
  assert.equal(candidates.length, 1);
});

test('loadActiveCandidates gop nhieu trang phan trang', async () => {
  const client = makeClient([
    [{ productCode: 'SP001', isActive: true, inventories: [] }],
    [{ productCode: 'SP002', isActive: true, inventories: [] }]
  ]);
  const { candidates, totalProductsScanned } = await loadActiveCandidates(client);
  assert.equal(totalProductsScanned, 2);
  assert.deepEqual(candidates.map((c) => c.code).sort(), ['SP001', 'SP002']);
});

test('loadActiveCandidates khong tu bat loi tu client — de loi API tu tran ra ngoai', async () => {
  const client = { async fetchAllPages() { throw new Error('KiotViet products API timeout'); } };
  await assert.rejects(loadActiveCandidates(client), /KiotViet products API timeout/);
});
