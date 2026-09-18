'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBackfillPlan } = require('./backfillPlan');

test('invoices (backfillRangeParam) chia theo thang, chunk cuoi cat tai now, khong phai cuoi thang', () => {
  const entityModule = { backfillRangeParam: { from: 'fromPurchaseDate', to: 'toPurchaseDate' } };
  const fromDate = new Date('2026-01-01T00:00:00Z');
  const now = new Date('2026-09-14T08:00:00Z');
  const chunks = buildBackfillPlan(entityModule, { fromDate, now });

  assert.equal(chunks.length, 9);
  assert.deepEqual(chunks.map((c) => c.chunkKey), [
    '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'
  ]);
  assert.equal(chunks[0].query.fromPurchaseDate, '2026-01-01T00:00:00.000Z');
  assert.equal(chunks[0].query.toPurchaseDate, '2026-02-01T00:00:00.000Z');
  const last = chunks[chunks.length - 1];
  assert.equal(last.query.fromPurchaseDate, '2026-09-01T00:00:00.000Z');
  assert.equal(last.query.toPurchaseDate, now.toISOString());
});

test('orders (hasUpperBound:false) tra dung 1 chunk full, khong co tham so chan tren', () => {
  const entityModule = { hasUpperBound: false, incrementalParam: 'lastModifiedFrom' };
  const fromDate = new Date('2026-01-01T00:00:00Z');
  const now = new Date('2026-09-14T08:00:00Z');
  const chunks = buildBackfillPlan(entityModule, { fromDate, now });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunkKey, 'full');
  assert.deepEqual(Object.keys(chunks[0].query), ['lastModifiedFrom']);
  assert.equal(chunks[0].query.lastModifiedFrom, fromDate.toISOString());
});

test('categories (du lieu nen, khong backfillRangeParam) tra dung 1 chunk full, query rong', () => {
  const entityModule = { hasUpperBound: true, incrementalParam: 'lastModifiedFrom' };
  const chunks = buildBackfillPlan(entityModule, { fromDate: new Date('2026-01-01T00:00:00Z'), now: new Date('2026-09-14T08:00:00Z') });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunkKey, 'full');
  assert.deepEqual(chunks[0].query, {});
});

test('fromDate cung thang voi now (case bien) chi tra 1 chunk duy nhat', () => {
  const entityModule = { backfillRangeParam: { from: 'startDate', to: 'endDate' } };
  const fromDate = new Date('2026-09-01T00:00:00Z');
  const now = new Date('2026-09-14T08:00:00Z');
  const chunks = buildBackfillPlan(entityModule, { fromDate, now });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunkKey, '2026-09');
  assert.equal(chunks[0].query.endDate, now.toISOString());
});

test('listQuery cua entity module (vd includeInventory cua products) duoc gop vao MOI chunk - bug 2026-09-16: KiotViet tra ve object thieu inventories/productShelves khi backfill vi truoc day query rong', () => {
  const listQuery = { includeInventory: 'true', includeQuantity: 'true', IncludeProductShelves: 'true' };

  const flatEntity = { hasUpperBound: true, incrementalParam: 'lastModifiedFrom', listQuery };
  const flatChunks = buildBackfillPlan(flatEntity, { fromDate: new Date('2026-01-01T00:00:00Z'), now: new Date('2026-09-14T08:00:00Z') });
  assert.deepEqual(flatChunks[0].query, listQuery);

  const noUpperBoundEntity = { hasUpperBound: false, incrementalParam: 'lastModifiedFrom', listQuery };
  const fromDate = new Date('2026-01-01T00:00:00Z');
  const noUpperBoundChunks = buildBackfillPlan(noUpperBoundEntity, { fromDate, now: new Date('2026-09-14T08:00:00Z') });
  assert.deepEqual(noUpperBoundChunks[0].query, { ...listQuery, lastModifiedFrom: fromDate.toISOString() });

  const rangeEntity = { backfillRangeParam: { from: 'fromPurchaseDate', to: 'toPurchaseDate' }, listQuery };
  const rangeFromDate = new Date('2026-09-01T00:00:00Z');
  const rangeNow = new Date('2026-09-14T08:00:00Z');
  const rangeChunks = buildBackfillPlan(rangeEntity, { fromDate: rangeFromDate, now: rangeNow });
  assert.deepEqual(rangeChunks[0].query, { ...listQuery, fromPurchaseDate: rangeFromDate.toISOString(), toPurchaseDate: rangeNow.toISOString() });
});

test('ham khong goi Date.now() truc tiep - ket qua chi phu thuoc tham so now duoc tiem vao', () => {
  const entityModule = { backfillRangeParam: { from: 'a', to: 'b' } };
  const fromDate = new Date('2020-01-01T00:00:00Z');
  const now = new Date('2020-03-01T00:00:00Z');
  const chunks = buildBackfillPlan(entityModule, { fromDate, now });
  assert.equal(chunks.length, 3);
  assert.equal(chunks[chunks.length - 1].query.b, now.toISOString());
});
