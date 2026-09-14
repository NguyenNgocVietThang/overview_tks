'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { backfillEntity, buildRunPlan, parseArgs, ENTITY_ORDER } = require('./backfill');

// Fake backfillProgressRepository trong bo nho - khong can Postgres that,
// nhung hieu dung ngu nghia idempotent/resume cua module that.
function createFakeProgressRepo() {
  const rows = new Map();
  const key = (b, e, c) => `${b}|${e}|${c}`;
  return {
    rows,
    async getChunkProgress(pool, branch, entity, chunkKey) {
      const row = rows.get(key(branch, entity, chunkKey));
      return row ? { ...row } : null;
    },
    async markChunkStarted(pool, branch, entity, chunkKey) {
      const k = key(branch, entity, chunkKey);
      const existing = rows.get(k);
      rows.set(k, existing ? { ...existing, status: 'running' } : { status: 'running', next_item: 0, records_synced: 0 });
    },
    async advanceChunkProgress(client, branch, entity, chunkKey, { nextItem, recordsInPage }) {
      const k = key(branch, entity, chunkKey);
      const existing = rows.get(k) || { status: 'running', next_item: 0, records_synced: 0 };
      rows.set(k, { ...existing, next_item: nextItem, records_synced: existing.records_synced + recordsInPage, status: 'running' });
    },
    async markChunkDone(pool, branch, entity, chunkKey) {
      const k = key(branch, entity, chunkKey);
      rows.set(k, { ...rows.get(k), status: 'done' });
    },
    async markChunkError(pool, branch, entity, chunkKey, message) {
      const k = key(branch, entity, chunkKey);
      rows.set(k, { ...rows.get(k), status: 'error', last_error: message });
    }
  };
}

// Fake pool: `.query` truc tiep (dung cho progressRepo doc/ghi ngoai
// transaction) + `.connect()` tra ve 1 client gia dung cho 1 transaction/trang.
function createFakePool() {
  const clientCalls = [];
  return {
    clientCalls,
    async query() { return { rows: [] }; },
    async connect() {
      const calls = [];
      clientCalls.push(calls);
      return {
        calls,
        async query(sql) { calls.push(sql); },
        release() {}
      };
    }
  };
}

// Fake kiotVietClient: moi lan goi fetchAllPages tra ve danh sach "trang" cau
// hinh san theo thu tu goi (mo phong dung 1 chunk = 1 lan goi fetchAllPages,
// dung cach backfill.js dang dung).
function createFakeKiotVietClient(pagesByCall) {
  let callIndex = 0;
  const calls = [];
  return {
    calls,
    async fetchAllPages(endpoint, query, onPage, options = {}) {
      const thisCall = callIndex++;
      calls.push({ endpoint, query, options });
      const pages = pagesByCall[thisCall] || [];
      for (const page of pages) {
        if (page.throwMessage) throw new Error(page.throwMessage);
        await onPage(page.items, { nextItem: page.nextItem, total: page.total || 999, pagesLoaded: 1, recordsLoaded: page.items.length });
      }
    }
  };
}

function createFakeEntity(overrides = {}) {
  const upserted = [];
  return {
    entity: 'fake_docs',
    endpoint: 'fake',
    listQuery: {},
    backfillRangeParam: { from: 'fromDate', to: 'toDate' },
    upserted,
    async upsertPage(client, branch, items) {
      upserted.push({ branch, items });
    },
    ...overrides
  };
}

test('lan dau chay (chua co backfill_progress) - tat ca chunk pending, chay tu dau', async () => {
  const entityModule = createFakeEntity();
  const fromDate = new Date('2026-01-01T00:00:00Z');
  const now = new Date('2026-02-15T00:00:00Z'); // 2 chunk: 2026-01, 2026-02
  const progressRepo = createFakeProgressRepo();
  const pool = createFakePool();
  const kiotVietClient = createFakeKiotVietClient([
    [{ items: [{ id: 1 }], nextItem: 100 }],
    [{ items: [{ id: 2 }], nextItem: 50 }]
  ]);

  await backfillEntity(kiotVietClient, pool, 'hanoi', entityModule, { fromDate, now, progressRepo, log: () => {} });

  assert.equal(kiotVietClient.calls.length, 2);
  assert.equal(entityModule.upserted.length, 2);
  assert.equal(progressRepo.rows.get('hanoi|fake_docs|2026-01').status, 'done');
  assert.equal(progressRepo.rows.get('hanoi|fake_docs|2026-02').status, 'done');
});

test('dung giua chung o 1 chunk, chay lai giong nguyen - chunk done bi bo qua, chunk loi resume dung next_item, chunk sau van chay', async () => {
  const fromDate = new Date('2026-01-01T00:00:00Z');
  const now = new Date('2026-04-15T00:00:00Z'); // 4 chunk: 01,02,03,04
  const progressRepo = createFakeProgressRepo();
  const pool = createFakePool();

  // Lan chay 1: chunk 01, 02 thanh cong; chunk 03 thanh cong 1 trang roi loi o trang 2 (mang lai next_item=30).
  const entityModuleRun1 = createFakeEntity();
  const clientRun1 = createFakeKiotVietClient([
    [{ items: [{ id: 'a' }], nextItem: 10 }],
    [{ items: [{ id: 'b' }], nextItem: 20 }],
    [{ items: [{ id: 'c' }], nextItem: 30 }, { items: [], throwMessage: 'mang loi giua chung' }]
  ]);

  await assert.rejects(
    () => backfillEntity(clientRun1, pool, 'hanoi', entityModuleRun1, { fromDate, now, progressRepo, log: () => {} }),
    /mang loi giua chung/
  );

  assert.equal(progressRepo.rows.get('hanoi|fake_docs|2026-01').status, 'done');
  assert.equal(progressRepo.rows.get('hanoi|fake_docs|2026-02').status, 'done');
  assert.equal(progressRepo.rows.get('hanoi|fake_docs|2026-03').status, 'error');
  assert.equal(progressRepo.rows.get('hanoi|fake_docs|2026-03').next_item, 30);
  assert.equal(progressRepo.rows.has('hanoi|fake_docs|2026-04'), false, 'chunk sau chunk loi khong duoc chay trong lan nay');
  assert.equal(clientRun1.calls.length, 3, 'chi goi toi chunk thu 3 (chunk 4 khong duoc thu trong lan chay bi loi)');

  // Lan chay 2 (lenh giong nguyen): chunk 01/02 phai bi bo qua hoan toan (khong goi API), chunk 03 resume tu next_item=30, chunk 04 chay binh thuong.
  const entityModuleRun2 = createFakeEntity();
  const clientRun2 = createFakeKiotVietClient([
    [{ items: [{ id: 'c2' }], nextItem: 999 }], // se la chunk 03 (resume)
    [{ items: [{ id: 'd' }], nextItem: 5 }] // se la chunk 04
  ]);

  await backfillEntity(clientRun2, pool, 'hanoi', entityModuleRun2, { fromDate, now, progressRepo, log: () => {} });

  assert.equal(clientRun2.calls.length, 2, 'chunk 01 va 02 (da done) khong duoc goi lai API');
  assert.equal(clientRun2.calls[0].options.startItem, 30, 'chunk 03 phai resume dung tu next_item da luu, khong tai lai tu 0');
  assert.equal(progressRepo.rows.get('hanoi|fake_docs|2026-03').status, 'done');
  assert.equal(progressRepo.rows.get('hanoi|fake_docs|2026-04').status, 'done');
});

test('moi trang la 1 transaction rieng: BEGIN/COMMIT tung trang, ROLLBACK dung trang loi', async () => {
  const fromDate = new Date('2026-01-01T00:00:00Z');
  const now = new Date('2026-01-15T00:00:00Z'); // 1 chunk duy nhat
  const progressRepo = createFakeProgressRepo();
  const pool = createFakePool();
  const entityModule = createFakeEntity();
  const kiotVietClient = createFakeKiotVietClient([
    [
      { items: [{ id: 1 }], nextItem: 100 },
      { items: [{ id: 2 }], nextItem: 200 },
      { items: [], throwMessage: 'loi trang 3' }
    ]
  ]);

  await assert.rejects(() => backfillEntity(kiotVietClient, pool, 'hanoi', entityModule, { fromDate, now, progressRepo, log: () => {} }));

  assert.equal(pool.clientCalls.length, 2, 'chi 2 trang dau thuc su mo transaction (trang 3 loi truoc khi toi luc pool.connect())');
  assert.deepEqual(pool.clientCalls[0], ['BEGIN', 'COMMIT']);
  assert.deepEqual(pool.clientCalls[1], ['BEGIN', 'COMMIT']);
  assert.equal(progressRepo.rows.get('hanoi|fake_docs|2026-01').next_item, 200, 'tien do giu nguyen o cuoi trang 2 da commit');
});

test('backfillEntity tra loi cua 1 entity khong chan runWithConcurrencyLimit chay cac tac vu khac', async () => {
  const { runWithConcurrencyLimit } = require('./runWithConcurrencyLimit');
  const progressRepo = createFakeProgressRepo();
  const pool = createFakePool();
  const fromDate = new Date('2026-01-01T00:00:00Z');
  const now = new Date('2026-01-15T00:00:00Z');

  const failingClient = createFakeKiotVietClient([[{ items: [], throwMessage: 'entity nay hong' }]]);
  const okClient = createFakeKiotVietClient([[{ items: [{ id: 1 }], nextItem: 10 }]]);

  const tasks = [
    () => backfillEntity(failingClient, pool, 'hanoi', createFakeEntity({ entity: 'broken_entity' }), { fromDate, now, progressRepo, log: () => {} }),
    () => backfillEntity(okClient, pool, 'hanoi', createFakeEntity({ entity: 'healthy_entity' }), { fromDate, now, progressRepo, log: () => {} })
  ];

  const results = await runWithConcurrencyLimit(tasks, 2);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'fulfilled');
  assert.equal(progressRepo.rows.get('hanoi|healthy_entity|2026-01').status, 'done');
});

test('ENTITY_ORDER dung thu tu khoi luong tang dan da chot trong ke hoach', () => {
  assert.deepEqual(ENTITY_ORDER, ['categories', 'suppliers', 'customers', 'products', 'returns', 'purchases', 'cash_flows', 'orders', 'invoices']);
});

test('parseArgs: mac dinh dry-run (execute=false), --execute moi bat che do chay that', () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.execute, false);
  assert.equal(defaults.branch, 'all');
  assert.equal(defaults.entity, 'all');
  const withExecute = parseArgs(['--branch=hanoi', '--entity=categories', '--from=2026-03-01', '--execute']);
  assert.equal(withExecute.execute, true);
  assert.equal(withExecute.branch, 'hanoi');
  assert.equal(withExecute.entity, 'categories');
  assert.equal(withExecute.from, '2026-03-01');
});

test('buildRunPlan: tinh dung so chunk cho tung (branch, entity) - chi tinh toan, khong goi API/DB', () => {
  const entityModules = { categories: require('./entities/categories'), invoices: require('./entities/invoices') };
  const plan = buildRunPlan({
    branches: [{ branch: 'hanoi' }, { branch: 'saigon' }],
    entityNames: ['categories', 'invoices'],
    fromDate: new Date('2026-01-01T00:00:00Z'),
    now: new Date('2026-03-15T00:00:00Z'),
    entityModules
  });
  assert.equal(plan.length, 4);
  const invoicesHanoi = plan.find((p) => p.branch === 'hanoi' && p.entity === 'invoices');
  assert.deepEqual(invoicesHanoi.chunkKeys, ['2026-01', '2026-02', '2026-03']);
  const categoriesSaigon = plan.find((p) => p.branch === 'saigon' && p.entity === 'categories');
  assert.deepEqual(categoriesSaigon.chunkKeys, ['full']);
});
