'use strict';

// Script CLI dieu phoi backfill du lieu lich su (Giai doan 3, Task 7). Chay
// on-demand boi nguoi van hanh:
//   node server/kiotvietSync/backfill.js --branch=hanoi --entity=invoices --from=2026-01-01 --execute
// KHONG duoc goi tu server/index.js hay bat ky luong khoi dong server nao -
// day la thao tac thu cong, khac han scheduler.js (polling tu dong) cua Giai
// doan 2. Mac dinh la DRY-RUN (chi in ke hoach chunk, khong goi API/ghi
// Postgres) - phai them --execute moi that su chay, va --execute van bi chan
// (fail-safe) neu SUPABASE_DB_URL chua cau hinh.
//
// Tai dung 100% upsertPage cua tung entity module (Giai doan 2) - khong viet
// logic ghi du lieu nghiep vu rieng cho backfill. Tien do luu o
// backfillProgressRepository.js (bang backfill_progress), doc lap voi
// sync_checkpoints cua polling.

const { buildBackfillPlan } = require('./backfillPlan');
const { runWithConcurrencyLimit } = require('./runWithConcurrencyLimit');
const defaultProgressRepo = require('./backfillProgressRepository');

// Thu tu khoi luong tang dan - phat hien loi som o entity nho truoc khi ton
// thoi gian o entity lon nhat (invoices/orders).
const ENTITY_ORDER = ['categories', 'suppliers', 'customers', 'products', 'returns', 'purchases', 'cash_flows', 'orders', 'invoices'];

function loadEntityModules() {
  return {
    categories: require('./entities/categories'),
    products: require('./entities/products'),
    customers: require('./entities/customers'),
    suppliers: require('./entities/suppliers'),
    invoices: require('./entities/invoices'),
    orders: require('./entities/orders'),
    returns: require('./entities/returns'),
    purchases: require('./entities/purchases'),
    cash_flows: require('./entities/cashFlows')
  };
}

const DEADLOCK_SQLSTATE = '40P01';
const DEADLOCK_MAX_ATTEMPTS = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Deadlock giua cac giao dich ghi dong thoi (vd 2 entity cung upsert bang
// "staff" dung chung) la binh thuong trong Postgres - ben thua phai tu retry,
// khong coi la loi that. Chi retry dung SQLSTATE 40P01, cac loi khac nem lai
// ngay.
async function withDeadlockRetry(work, { attempts = DEADLOCK_MAX_ATTEMPTS, log = console.log } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (error.code !== DEADLOCK_SQLSTATE || attempt === attempts) throw error;
      log(`[backfill] deadlock (lan ${attempt}/${attempts}), thu lai...`);
      await sleep(200 * attempt + Math.floor(Math.random() * 200));
    }
  }
}

// cash_flows: API /cashflow BAT BUOC goi 2 lan (isReceipt=true va
// isReceipt=false) roi gop - API khong tra field phan biet thu/chi trong
// item, chi loc dung khi truyen isReceipt o query (xem API_ENDPOINTS.md).
// syncDriver.js (polling) da lam dung dieu nay; backfill truoc day thieu,
// khien is_receipt bi NULL va vi pham NOT NULL.
async function backfillCashFlowsChunk(kiotVietClient, pool, branch, entityModule, chunk) {
  const items = [];
  for (const isReceipt of ['true', 'false']) {
    await kiotVietClient.fetchAllPages(entityModule.endpoint, { ...chunk.query, isReceipt }, async (pageItems) => {
      // API khong tra field phan biet thu/chi trong item - phai gan tu query
      // da dung de lay item nay, khong doc tu item.
      items.push(...pageItems.map((item) => ({ ...item, IsReceipt: isReceipt === 'true' })));
    });
  }
  await withDeadlockRetry(async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await entityModule.upsertPage(client, branch, items);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}

// Chay backfill cho 1 entity cua 1 co so. Tuan tu tung chunk (khong song song
// trong cung entity) - don gian hoa resume va log tien do.
async function backfillEntity(kiotVietClient, pool, branch, entityModule, {
  fromDate, now, progressRepo = defaultProgressRepo, log = console.log
} = {}) {
  const chunks = buildBackfillPlan(entityModule, { fromDate, now });

  for (const chunk of chunks) {
    const existing = await progressRepo.getChunkProgress(pool, branch, entityModule.entity, chunk.chunkKey);
    if (existing && existing.status === 'done') {
      log(`[backfill] ${branch}/${entityModule.entity}/${chunk.chunkKey}: da xong truoc do, bo qua`);
      continue;
    }

    const startItem = (existing && existing.next_item) || 0;
    await progressRepo.markChunkStarted(pool, branch, entityModule.entity, chunk.chunkKey);

    try {
      if (entityModule.entity === 'cash_flows') {
        await backfillCashFlowsChunk(kiotVietClient, pool, branch, entityModule, chunk);
      } else {
        await kiotVietClient.fetchAllPages(entityModule.endpoint, chunk.query, async (items, pageInfo) => {
          await withDeadlockRetry(async () => {
            const client = await pool.connect();
            try {
              await client.query('BEGIN');
              await entityModule.upsertPage(client, branch, items);
              await progressRepo.advanceChunkProgress(client, branch, entityModule.entity, chunk.chunkKey, {
                nextItem: pageInfo.nextItem, recordsInPage: items.length
              });
              await client.query('COMMIT');
            } catch (error) {
              await client.query('ROLLBACK');
              throw error;
            } finally {
              client.release();
            }
          }, { log });
        }, { startItem });
      }

      await progressRepo.markChunkDone(pool, branch, entityModule.entity, chunk.chunkKey);
      log(`[backfill] ${branch}/${entityModule.entity}/${chunk.chunkKey}: xong`);
    } catch (error) {
      await progressRepo.markChunkError(pool, branch, entityModule.entity, chunk.chunkKey, error.message);
      log(`[backfill] ${branch}/${entityModule.entity}/${chunk.chunkKey}: LOI - ${error.message}`);
      throw error; // dung entity nay o day; entity/co so khac (goi qua runWithConcurrencyLimit + Promise.allSettled) khong bi chan
    }
  }
}

// Ham thuan: chi tinh ke hoach chunk de in ra (dry-run), khong goi API/DB.
function buildRunPlan({ branches, entityNames, fromDate, now, entityModules }) {
  const plan = [];
  for (const branch of branches) {
    for (const entityName of entityNames) {
      const entityModule = entityModules[entityName];
      const chunks = buildBackfillPlan(entityModule, { fromDate, now });
      plan.push({ branch: branch.branch, entity: entityName, chunkKeys: chunks.map((c) => c.chunkKey) });
    }
  }
  return plan;
}

function parseArgs(argv) {
  const args = { branch: 'all', entity: 'all', from: '2026-01-01', execute: false, concurrency: 2 };
  for (const arg of argv) {
    if (arg === '--execute') { args.execute = true; continue; }
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'branch') args.branch = value;
    if (key === 'entity') args.entity = value;
    if (key === 'from') args.from = value;
    if (key === 'concurrency') args.concurrency = Number(value) || 2;
  }
  return args;
}

async function main() {
  const CONFIG = require('../config');
  const { getPool } = require('../db/pool');
  const { getConfiguredBranches } = require('./config');
  const { createKiotVietClient } = require('../kiotviet/kiotVietApiClient');

  const args = parseArgs(process.argv.slice(2));
  const fromDate = new Date(args.from);
  const now = new Date();
  const entityModules = loadEntityModules();
  const entityNames = args.entity === 'all' ? ENTITY_ORDER : [args.entity];
  const configuredBranches = getConfiguredBranches();
  const branches = args.branch === 'all' ? configuredBranches : configuredBranches.filter((b) => b.branch === args.branch);

  if (!branches.length) {
    console.error('[backfill] Khong co co so nao du cau hinh credentials cho lua chon --branch nay.');
    process.exitCode = 1;
    return;
  }

  const plan = buildRunPlan({ branches, entityNames, fromDate, now, entityModules });
  console.log(`[backfill] Ke hoach (--from=${args.from}, --branch=${args.branch}, --entity=${args.entity}):`);
  for (const row of plan) console.log(`  ${row.branch}/${row.entity}: ${row.chunkKeys.length} chunk (${row.chunkKeys.join(', ')})`);

  if (!args.execute) {
    console.log('[backfill] DRY-RUN (mac dinh) - khong goi API KiotViet, khong ghi Postgres. Them --execute de chay that.');
    return;
  }

  if (!CONFIG.SUPABASE_DB_URL) {
    console.error('[backfill] SUPABASE_DB_URL chua cau hinh - dung lai, khong chay that (fail-safe).');
    process.exitCode = 1;
    return;
  }

  const pool = getPool();
  const branchResults = await Promise.allSettled(branches.map(async (branchConfig) => {
    const kiotVietClient = createKiotVietClient(branchConfig);
    const tasks = entityNames.map((entityName) => async () => {
      await backfillEntity(kiotVietClient, pool, branchConfig.branch, entityModules[entityName], { fromDate, now });
    });
    return runWithConcurrencyLimit(tasks, args.concurrency);
  }));

  for (let i = 0; i < branchResults.length; i++) {
    if (branchResults[i].status === 'rejected') {
      console.error(`[backfill] Co so "${branches[i].branch}" that bai hoan toan: ${branchResults[i].reason.message}`);
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[backfill] That bai: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { backfillEntity, buildRunPlan, parseArgs, loadEntityModules, ENTITY_ORDER };
