'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadActiveCandidates } = require('./productLoader');

function makeSource(products) {
  return { async listProducts() { return products; } };
}

test('loadActiveCandidates loc dung isActive, mac dinh thieu field la dang kinh doanh', async () => {
  const source = makeSource([
    { code: 'SP001', name: 'Con hang', isActive: true, onHand: 0 },
    { code: 'SP002', name: 'Ngung kinh doanh', isActive: false, onHand: 0 },
    { code: 'SP003', name: 'Khong ghi isActive', isActive: null, onHand: 0 }
  ]);
  const { candidates, totalProductsScanned } = await loadActiveCandidates(source);
  assert.equal(totalProductsScanned, 3);
  assert.deepEqual(candidates.map((c) => c.code).sort(), ['SP001', 'SP003']);
});

test('loadActiveCandidates lay ton kho hien tai tu onHand da cong don theo chi nhanh', async () => {
  const source = makeSource([{ code: 'SP001', name: 'Nhieu chi nhanh', isActive: true, onHand: 351 }]);
  const { candidates } = await loadActiveCandidates(source);
  assert.equal(candidates[0].currentOnHand, 351);
});

test('loadActiveCandidates doc createdDateKey qua toVnDateKey, null neu thieu', async () => {
  const source = makeSource([
    { code: 'SP001', isActive: true, onHand: 0, createdDate: '2026-08-04T09:44:00' },
    { code: 'SP002', isActive: true, onHand: 0, createdDate: null }
  ]);
  const { candidates } = await loadActiveCandidates(source);
  assert.equal(candidates.find((c) => c.code === 'SP001').createdDateKey, '2026-08-04');
  assert.equal(candidates.find((c) => c.code === 'SP002').createdDateKey, null);
});

test('loadActiveCandidates bo qua ma trong, khong dem vao totalProductsScanned', async () => {
  const source = makeSource([
    { code: '', isActive: true, onHand: 0 },
    { code: '  SP001 ', isActive: true, onHand: 0 }
  ]);
  const { candidates, totalProductsScanned } = await loadActiveCandidates(source);
  assert.equal(totalProductsScanned, 1);
  assert.deepEqual(candidates.map((c) => c.code), ['SP001']);
});

test('loadActiveCandidates khong tu bat loi tu nguon — de loi DB tu tran ra ngoai', async () => {
  const source = { async listProducts() { throw new Error('products db timeout'); } };
  await assert.rejects(loadActiveCandidates(source), /products db timeout/);
});
