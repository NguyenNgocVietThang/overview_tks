'use strict';

// Script doi chieu so luong ban ghi sau backfill (Giai doan 3, Task 8). Voi
// moi (branch, entity): goi KiotViet khong filter lay `total` hien tai, so
// voi `SELECT COUNT(*)` tren bang Postgres tuong ung, in bang lech. KHONG tu
// chay khi require - chi chay khi goi truc tiep qua CLI (`node
// server/kiotvietSync/reconcileCounts.js`), va van goi API/DB that trong luc
// do (khac cac ham thuan duoi day, la phan duy nhat duoc test tu dong).
//
// orders/returns duoc phep lech nho (roi rui ro troi trang offset-based da
// biet truoc trong API_ENDPOINTS.md) - script chi canh bao, khong coi la loi
// cung cho 2 entity nay.
const ORDERS_RETURNS_TOLERANT = new Set(['orders', 'returns']);
const HARD_ZERO_DIFF_THRESHOLD = 0; // cac entity con lai phai khop tuyet doi (diff = 0)
const SOFT_WARNING_RATIO = 0.01; // 1%

// Ham thuan: tinh lech giua total KiotViet va count Postgres cho 1 entity.
function computeDiff(entity, kiotVietTotal, postgresCount) {
  const diff = kiotVietTotal - postgresCount;
  const isTolerant = ORDERS_RETURNS_TOLERANT.has(entity);
  const ratio = kiotVietTotal > 0 ? Math.abs(diff) / kiotVietTotal : 0;
  const severity = diff === HARD_ZERO_DIFF_THRESHOLD
    ? 'ok'
    : isTolerant
      ? (ratio > SOFT_WARNING_RATIO ? 'warn' : 'ok')
      : 'error';
  return { entity, kiotVietTotal, postgresCount, diff, severity };
}

function formatReportTable(rows) {
  const lines = ['entity | branch | kiotviet_total | postgres_count | diff | trang_thai'];
  for (const row of rows) {
    lines.push(`${row.entity} | ${row.branch} | ${row.kiotVietTotal} | ${row.postgresCount} | ${row.diff} | ${row.severity}`);
  }
  return lines.join('\n');
}

// Lay `total` that tu KiotViet cho 1 entity, khong filter (ky thuat live-probe
// da dung de viet API_ENDPOINTS.md). Chi doc trang dau roi dung.
async function fetchKiotVietTotal(kiotVietClient, entityModule) {
  let total = 0;
  const STOP = Symbol('stop');
  try {
    await kiotVietClient.fetchAllPages(entityModule.endpoint, {}, async (items, pageInfo) => {
      total = pageInfo.total;
      throw STOP;
    });
  } catch (err) {
    if (err !== STOP) throw err;
  }
  return total;
}

async function fetchPostgresCount(pool, entityModule, branch) {
  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM ${entityModule.entity} WHERE branch = $1`, [branch]);
  return result.rows[0].count;
}

async function reconcileEntity(kiotVietClient, pool, branch, entityModule) {
  const [kiotVietTotal, postgresCount] = await Promise.all([
    fetchKiotVietTotal(kiotVietClient, entityModule),
    fetchPostgresCount(pool, entityModule, branch)
  ]);
  return { branch, ...computeDiff(entityModule.entity, kiotVietTotal, postgresCount) };
}

async function reconcileAll(kiotVietClient, pool, branch, entityModules, { log = console.log } = {}) {
  const rows = [];
  for (const entityModule of entityModules) {
    rows.push(await reconcileEntity(kiotVietClient, pool, branch, entityModule));
  }
  log(formatReportTable(rows));
  const hardErrors = rows.filter((r) => r.severity === 'error');
  if (hardErrors.length) {
    log(`CANH BAO: ${hardErrors.length} entity lech khong nam trong nguong chap nhan duoc - can dieu tra thu cong.`);
  }
  return rows;
}

function parseArgs(argv) {
  const args = { branch: 'hanoi' };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'branch') args.branch = value;
  }
  return args;
}

async function main() {
  const { getPool } = require('../db/pool');
  const { getConfiguredBranches } = require('./config');
  const { createKiotVietClient } = require('../kiotviet/kiotVietApiClient');
  const entityModules = [
    require('./entities/categories'), require('./entities/products'), require('./entities/customers'),
    require('./entities/suppliers'), require('./entities/invoices'), require('./entities/orders'),
    require('./entities/returns'), require('./entities/purchases'), require('./entities/cashFlows')
  ];

  const args = parseArgs(process.argv.slice(2));
  const branchConfig = getConfiguredBranches().find((b) => b.branch === args.branch);
  if (!branchConfig) {
    console.error(`[reconcileCounts] Co so "${args.branch}" chua duoc cau hinh du credentials.`);
    process.exitCode = 1;
    return;
  }

  const kiotVietClient = createKiotVietClient(branchConfig);
  const pool = getPool();
  await reconcileAll(kiotVietClient, pool, args.branch, entityModules);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[reconcileCounts] That bai: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { computeDiff, formatReportTable, fetchKiotVietTotal, fetchPostgresCount, reconcileEntity, reconcileAll, parseArgs };
