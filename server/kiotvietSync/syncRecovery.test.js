'use strict';

// Test "duong noi" giua syncDriver + checkpointRepository qua NHIEU lan goi
// pollEntityOnce lien tiep (mo phong crash giua chung roi tu phuc hoi). Khac
// syncDriver.test.js (chi test 1 lan goi don le, checkpointRepository duoc mock
// truc tiep bang getCheckpoint/advanceCheckpoint tra san gia tri) - o day
// checkpointRepository la THAT (createCheckpointRepository that), chay tren 1
// pg pool gia lap trong bo nho co BEGIN/COMMIT/ROLLBACK, de xac nhan hanh vi
// tien do tich luy dung qua nhieu vong poll, khong chi dung trong 1 vong.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSyncDriver } = require('./syncDriver');
const { createCheckpointRepository } = require('./checkpointRepository');

function createFakeCheckpointPool() {
  const store = new Map();
  const key = (branch, entity) => `${branch}::${entity}`;

  async function apply(sql, params) {
    if (sql.startsWith('SELECT branch, entity')) {
      const [branch, entity] = params;
      const row = store.get(key(branch, entity));
      return { rows: row ? [row] : [] };
    }
    if (sql.startsWith('INSERT INTO sync_checkpoints')) {
      const [branch, entity, syncedAt, note] = params;
      store.set(key(branch, entity), {
        branch, entity, last_synced_at: syncedAt, last_success_at: new Date().toISOString(), note: note ?? null
      });
      return { rows: [] };
    }
    // Cac cau lenh khac (vd upsertPage cua entity module that goi qua client
    // trong cung transaction) khong lien quan sync_checkpoints - fake nay chi
    // mo phong bang sync_checkpoints, khong phai toan bo schema.
    return { rows: [] };
  }

  return {
    async query(sql, params) { return apply(sql, params); },
    async connect() {
      let pending = [];
      return {
        async query(sql, params) {
          if (sql === 'BEGIN') { pending = []; return; }
          if (sql === 'COMMIT') { const staged = pending; pending = []; for (const [s, p] of staged) await apply(s, p); return; }
          if (sql === 'ROLLBACK') { pending = []; return; }
          pending.push([sql, params]);
        },
        release() {}
      };
    }
  };
}

function pagedKiotVietClient(pages, { failOnPage } = {}) {
  const calls = [];
  return {
    calls,
    async fetchAllPages(_endpoint, query, onPage) {
      calls.push(query);
      for (let i = 0; i < pages.length; i++) {
        if (failOnPage === i + 1) throw new Error(`crash giua trang ${i + 1}`);
        await onPage(pages[i]);
      }
    }
  };
}

test('loi giua trang 3/4 roi goi lai pollEntityOnce: tu phuc hoi dung, khong mat va khong tua lai tien do da luu', async () => {
  const pool = createFakeCheckpointPool();
  const checkpoints = createCheckpointRepository({ pool });
  let upsertedCount = 0;
  const entity = {
    entity: 'purchases', endpoint: 'purchaseorders', listQuery: {}, incrementalParam: 'lastModifiedFrom',
    async upsertPage(_client, _branch, items) { upsertedCount += items.length; }
  };

  const run1Client = pagedKiotVietClient([[1], [2], [3], [4]], { failOnPage: 3 });
  const driver1 = createSyncDriver({ pool, checkpointRepository: checkpoints, now: () => Date.parse('2026-09-14T02:00:00Z') });
  await assert.rejects(
    driver1.pollEntityOnce(run1Client, 'hanoi', entity),
    /crash giua trang 3/
  );

  const afterRun1 = await checkpoints.getCheckpoint('hanoi', 'purchases');
  assert.equal(new Date(afterRun1.last_synced_at).toISOString(), '2026-09-14T02:00:00.000Z');
  assert.equal(upsertedCount, 2, 'chi trang 1 va 2 duoc upsert, trang 3 chua bao gio chay upsertPage');

  const run2Client = pagedKiotVietClient([[1], [2], [3], [4]]);
  const driver2 = createSyncDriver({ pool, checkpointRepository: checkpoints, now: () => Date.parse('2026-09-14T02:10:00Z') });
  await driver2.pollEntityOnce(run2Client, 'hanoi', entity);

  assert.equal(
    run2Client.calls[0].lastModifiedFrom,
    '2026-09-14T02:00:00.000Z',
    'lan goi lai phai tiep tuc dung tu checkpoint da luu o lan truoc, khong phai now()-1h va khong tua lai tu dau'
  );
  const afterRun2 = await checkpoints.getCheckpoint('hanoi', 'purchases');
  assert.equal(new Date(afterRun2.last_synced_at).toISOString(), '2026-09-14T02:10:00.000Z');
  assert.equal(upsertedCount, 2 + 4, 'lan 2 chay het 4 trang khong loi');
});

test('hanoi va saigon poll dong thoi cung 1 entity khong lam lan checkpoint cua nhau', async () => {
  const pool = createFakeCheckpointPool();
  const checkpoints = createCheckpointRepository({ pool });
  const entity = {
    entity: 'categories', endpoint: 'categories', listQuery: {}, incrementalParam: 'lastModifiedFrom',
    async upsertPage() {}
  };
  const driverHanoi = createSyncDriver({ pool, checkpointRepository: checkpoints, now: () => Date.parse('2026-09-14T03:00:00Z') });
  const driverSaigon = createSyncDriver({ pool, checkpointRepository: checkpoints, now: () => Date.parse('2026-09-14T03:05:00Z') });

  await Promise.all([
    driverHanoi.pollEntityOnce(pagedKiotVietClient([[1]]), 'hanoi', entity),
    driverSaigon.pollEntityOnce(pagedKiotVietClient([[1]]), 'saigon', entity)
  ]);

  const hanoiCheckpoint = await checkpoints.getCheckpoint('hanoi', 'categories');
  const saigonCheckpoint = await checkpoints.getCheckpoint('saigon', 'categories');
  assert.equal(new Date(hanoiCheckpoint.last_synced_at).toISOString(), '2026-09-14T03:00:00.000Z');
  assert.equal(new Date(saigonCheckpoint.last_synced_at).toISOString(), '2026-09-14T03:05:00.000Z');
});
