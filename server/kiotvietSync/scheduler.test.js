'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const config = require('../config');
const { runMigrations } = require('../db/migrate');
const { getCheckpoint } = require('./syncCheckpointRepository');
const { startBranchLoops, runEntitySync } = require('./scheduler');

function makeSchemaName() {
  return 'test_scheduler_' + Math.random().toString(36).slice(2, 10);
}

async function withTestPool(fn) {
  const schemaName = makeSchemaName();
  const setupPool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 2,
    ssl: config.PGSSL ? { rejectUnauthorized: false } : false
  });
  await setupPool.query(`CREATE SCHEMA "${schemaName}"`);

  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 2,
    ssl: config.PGSSL ? { rejectUnauthorized: false } : false,
    options: `-c search_path="${schemaName}"`
  });

  try {
    const setupClient = await pool.connect();
    try {
      await runMigrations(setupClient);
    } finally {
      setupClient.release();
    }
    const branches = (await pool.query(`SELECT id, code FROM branches ORDER BY code`)).rows;
    const hanoi = { id: branches.find((b) => b.code === 'hanoi').id, code: 'hanoi' };
    const saigon = { id: branches.find((b) => b.code === 'saigon').id, code: 'saigon' };
    await fn(pool, { hanoi, saigon });
  } finally {
    await pool.end();
    await setupPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await setupPool.end();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('runEntitySync: thanh cong thi goi recordSuccess, checkpoint tien len', async () => {
  await withTestPool(async (pool, { hanoi }) => {
    const syncFn = async () => ({ fetched: 3, upserted: 3 });
    await runEntitySync(pool, {}, hanoi, 'categories', syncFn);

    const checkpoint = await getCheckpoint(pool, hanoi.id, 'categories');
    assert.ok(checkpoint.lastCheckpointAt);
    assert.equal(checkpoint.consecutiveErrorCount, 0);
  });
});

test('runEntitySync: loi thi goi recordError, KHONG day checkpoint (lastCheckpointAt van null)', async () => {
  await withTestPool(async (pool, { hanoi }) => {
    const syncFn = async () => { throw new Error('KiotViet 500'); };
    await runEntitySync(pool, {}, hanoi, 'categories', syncFn);

    const checkpoint = await getCheckpoint(pool, hanoi.id, 'categories');
    assert.equal(checkpoint.lastCheckpointAt, null);
    assert.equal(checkpoint.consecutiveErrorCount, 1);
  });
});

test('runEntitySync: khong throw ra ngoai ke ca khi syncFn loi (da tu bat va ghi recordError)', async () => {
  await withTestPool(async (pool, { hanoi }) => {
    const syncFn = async () => { throw new Error('boom'); };
    await assert.doesNotReject(() => runEntitySync(pool, {}, hanoi, 'categories', syncFn));
  });
});

test('runEntitySync: lan sync thu 2 dung sinceIso tinh tu checkpoint (tru buffer) cua lan truoc', async () => {
  await withTestPool(async (pool, { hanoi }) => {
    await runEntitySync(pool, {}, hanoi, 'categories', async () => ({ fetched: 1, upserted: 1 }));

    let capturedSinceIso;
    await runEntitySync(pool, {}, hanoi, 'categories', async (_pool, _client, _branch, sinceIso) => {
      capturedSinceIso = sinceIso;
      return { fetched: 0, upserted: 0 };
    });

    assert.ok(capturedSinceIso, 'phai tinh duoc sinceIso tu checkpoint da co');
    assert.match(capturedSinceIso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });
});

test('runEntitySync: lan dau tien (chua co checkpoint) sinceIso la null (full-poll)', async () => {
  await withTestPool(async (pool, { hanoi }) => {
    let capturedSinceIso = 'chua-goi';
    await runEntitySync(pool, {}, hanoi, 'categories', async (_pool, _client, _branch, sinceIso) => {
      capturedSinceIso = sinceIso;
      return { fetched: 0, upserted: 0 };
    });
    assert.equal(capturedSinceIso, null);
  });
});

test('startBranchLoops: 1 entity loi trong 1 vong khong chan entity ke tiep trong CUNG vong', async () => {
  await withTestPool(async (pool, { hanoi }) => {
    const calledEntities = [];
    const entities = [
      { name: 'categories', sync: async () => { calledEntities.push('categories'); throw new Error('loi categories'); } },
      { name: 'products', sync: async () => { calledEntities.push('products'); return { fetched: 0, upserted: 0 }; } }
    ];

    const stop = startBranchLoops(pool, {}, hanoi, {
      fastEntities: entities, slowEntities: [], fastIntervalMs: 100000, slowIntervalMs: 100000, startDelayMs: 0
    });
    await sleep(50);
    stop();

    assert.deepEqual(calledEntities, ['categories', 'products']);
  });
});

test('startBranchLoops: loi lien tiep o 1 branch KHONG anh huong checkpoint cua branch kia', async () => {
  await withTestPool(async (pool, { hanoi, saigon }) => {
    const hanoiEntities = [{ name: 'categories', sync: async () => { throw new Error('Ha Noi loi'); } }];
    const saigonEntities = [{ name: 'categories', sync: async () => ({ fetched: 1, upserted: 1 }) }];

    const stopHanoi = startBranchLoops(pool, {}, hanoi, {
      fastEntities: hanoiEntities, slowEntities: [], fastIntervalMs: 20, slowIntervalMs: 100000, startDelayMs: 0
    });
    const stopSaigon = startBranchLoops(pool, {}, saigon, {
      fastEntities: saigonEntities, slowEntities: [], fastIntervalMs: 100000, slowIntervalMs: 100000, startDelayMs: 0
    });

    await sleep(80);
    stopHanoi();
    stopSaigon();

    const hanoiCheckpoint = await getCheckpoint(pool, hanoi.id, 'categories');
    const saigonCheckpoint = await getCheckpoint(pool, saigon.id, 'categories');

    assert.ok(hanoiCheckpoint.consecutiveErrorCount >= 1);
    assert.equal(hanoiCheckpoint.lastCheckpointAt, null);
    assert.ok(saigonCheckpoint.lastCheckpointAt);
    assert.equal(saigonCheckpoint.consecutiveErrorCount, 0);
  });
});

test('startBranchLoops: fast loop chay lai nhieu lan theo fastIntervalMs cho den khi stop()', async () => {
  await withTestPool(async (pool, { hanoi }) => {
    let callCount = 0;
    const entities = [{ name: 'categories', sync: async () => { callCount++; return { fetched: 0, upserted: 0 }; } }];

    const stop = startBranchLoops(pool, {}, hanoi, {
      fastEntities: entities, slowEntities: [], fastIntervalMs: 20, slowIntervalMs: 100000, startDelayMs: 0
    });
    await sleep(90);
    stop();
    const countAtStop = callCount;
    await sleep(60);

    assert.ok(countAtStop >= 2, `ky vong chay it nhat 2 lan trong 90ms voi interval 20ms, thuc te ${countAtStop}`);
    assert.equal(callCount, countAtStop, 'khong duoc chay them sau khi stop() da goi');
  });
});

test('startBranchLoops: stagger startDelayMs tri hoan lan chay dau tien', async () => {
  await withTestPool(async (pool, { hanoi }) => {
    let called = false;
    const entities = [{ name: 'categories', sync: async () => { called = true; return { fetched: 0, upserted: 0 }; } }];

    const stop = startBranchLoops(pool, {}, hanoi, {
      fastEntities: entities, slowEntities: [], fastIntervalMs: 100000, slowIntervalMs: 100000, startDelayMs: 60
    });
    await sleep(20);
    assert.equal(called, false, 'chua den startDelayMs thi chua duoc chay');
    await sleep(60);
    stop();
    assert.equal(called, true);
  });
});
