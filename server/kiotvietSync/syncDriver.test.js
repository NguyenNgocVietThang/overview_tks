'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSyncDriver } = require('./syncDriver');

function fakePool({ failUpsertAt = 0 } = {}) {
  const transactions = [];
  let upserts = 0;
  return {
    transactions,
    async connect() {
      const commands = [];
      transactions.push(commands);
      return {
        async query(sql) { commands.push(sql); },
        release() { commands.push('RELEASE'); }
      };
    },
    upsert: async () => {
      upserts++;
      if (upserts === failUpsertAt) throw new Error('page failed');
    }
  };
}

test('empty checkpoint polls from exactly one hour ago and commits checkpoint with each page', async () => {
  const pool = fakePool();
  const advances = [];
  const queries = [];
  const driver = createSyncDriver({ pool, now: () => Date.parse('2026-09-14T02:00:00Z'), checkpointRepository: {
    getCheckpoint: async () => null,
    advanceCheckpoint: async (...args) => advances.push(args)
  }});
  const api = { fetchAllPages: async (endpoint, query, onPage) => {
    queries.push([endpoint, query]);
    await onPage([{ id: 1 }]);
    await onPage([{ id: 2 }]);
  }};
  const entity = { entity: 'products', endpoint: 'products', listQuery: { includeInventory: 'true' }, incrementalParam: 'lastModifiedFrom', upsertPage: pool.upsert };
  await driver.pollEntityOnce(api, 'hanoi', entity);
  assert.deepEqual(queries[0], ['products', { includeInventory: 'true', lastModifiedFrom: '2026-09-14T01:00:00.000Z' }]);
  assert.equal(advances.length, 2);
  assert.ok(pool.transactions.every((tx) => tx.join(',') === 'BEGIN,COMMIT,RELEASE'));
});

test('a failed page rolls back only that page and does not advance its checkpoint', async () => {
  const pool = fakePool({ failUpsertAt: 2 });
  let advances = 0;
  const driver = createSyncDriver({ pool, checkpointRepository: {
    getCheckpoint: async () => ({ last_synced_at: '2026-09-14T00:00:00Z' }),
    advanceCheckpoint: async () => { advances++; }
  }});
  const api = { fetchAllPages: async (_e, _q, onPage) => { await onPage([1]); await onPage([2]); } };
  await assert.rejects(driver.pollEntityOnce(api, 'hanoi', { entity:'orders', endpoint:'orders', listQuery:{}, incrementalParam:'lastModifiedFrom', hasUpperBound:false, upsertPage:pool.upsert }), /page failed/);
  assert.equal(advances, 1);
  assert.deepEqual(pool.transactions.map((tx) => tx.slice(0, -1)), [['BEGIN','COMMIT'], ['BEGIN','ROLLBACK']]);
});

test('cash flows use two independently paginated receipt branches and persist the window end in note', async () => {
  const pool = fakePool();
  const apiCalls = [];
  const pages = [];
  const advances = [];
  const driver = createSyncDriver({ pool, now: () => Date.parse('2026-09-14T02:00:00Z'), checkpointRepository: {
    getCheckpoint: async () => ({ note: '2026-09-14T00:00:00.000Z' }),
    advanceCheckpoint: async (...args) => advances.push(args)
  }});
  const api = { fetchAllPages: async (endpoint, query, onPage) => { apiCalls.push([endpoint, query]); await onPage([{ id: query.isReceipt }]); } };
  await driver.pollEntityOnce(api, 'saigon', { entity:'cash_flows', endpoint:'cashflow', listQuery:{ includeUser:'true' }, upsertPage:async (_c,_b,items)=>pages.push(items) });
  assert.deepEqual(apiCalls.map((x)=>x[1]), [
    { includeUser:'true', startDate:'2026-09-14T00:00:00.000Z', endDate:'2026-09-14T02:00:00.000Z', isReceipt:'true' },
    { includeUser:'true', startDate:'2026-09-14T00:00:00.000Z', endDate:'2026-09-14T02:00:00.000Z', isReceipt:'false' }
  ]);
  assert.deepEqual(pages[0], [{ id:'true' }, { id:'false' }]);
  assert.equal(advances[0][3].note, '2026-09-14T02:00:00.000Z');
});

test('cash flow recovery ignores an error note and resumes from the last successful window', async () => {
  const pool=fakePool();
  const queries=[];
  const driver=createSyncDriver({pool,now:()=>Date.parse('2026-09-14T02:00:00Z'),checkpointRepository:{
    getCheckpoint:async()=>({note:'network down',last_synced_at:'2026-09-14T00:30:00Z'}),advanceCheckpoint:async()=>{}
  }});
  const api={fetchAllPages:async(_endpoint,query,onPage)=>{queries.push(query);await onPage([]);}};
  await driver.pollEntityOnce(api,'hanoi',{entity:'cash_flows',endpoint:'cashflow',listQuery:{},upsertPage:async()=>{}});
  assert.equal(queries[0].startDate,'2026-09-14T00:30:00.000Z');
});
