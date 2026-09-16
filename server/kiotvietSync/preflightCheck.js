'use strict';

// Khi chay CLI truc tiep (khong qua server/index.js), khong co gi khac nap
// .env truoc - cac script CLI khac (backfill.js, reconcileCounts.js) nap gian
// tiep qua require('../config')/require('../db/pool'). Script nay khong dung
// module nao trong 2 module do nen phai tu nap.
if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* dotenv là tùy chọn trong môi trường production */ }
}

// Script khao sat truoc khi chay backfill that (Giai doan 3, Task 6). CHI DOC
// (GET) tu KiotViet - khong import server/db/pool.js, khong ghi bat cu thu gi
// vao Postgres. Giai quyet 2 muc UNVERIFIED cua API_ENDPOINTS.md TRUOC KHI
// chay backfill.js that (khong phai truoc khi code):
//   1. Tinh kha dung du lieu lich su cu (so field 1 ban ghi cu vs. gan day).
//   2. Uoc luong dung luong (total moi entity x kich thuoc JSON trung binh).
//
// Chay thu cong: node server/kiotvietSync/preflightCheck.js --branch=hanoi
// Khong tu dong chay o dau khac trong repo.

const STOP_AFTER_FIRST_PAGE = Symbol('stop-after-first-page');
const WARN_THRESHOLD_MB = 300;

// Ham thuan (khong I/O): uoc luong dung luong JSONB trung binh cua 1 entity
// tu 1 mau ban ghi da lay san + tong so ban ghi that (`total` tu KiotViet).
function estimateStorageMb(sampleItems, total) {
  if (!Array.isArray(sampleItems) || sampleItems.length === 0 || !total) return 0;
  const avgBytes = sampleItems.reduce((sum, item) => sum + JSON.stringify(item).length, 0) / sampleItems.length;
  return (avgBytes * total) / (1024 * 1024);
}

// Ham thuan: so sanh field giua 1 ban ghi cu va 1 ban ghi gan day, tra ve
// nhung field co o ban ghi gan day nhung thieu o ban ghi cu (nghi ngo bi cat
// bot du lieu lich su).
function compareFieldSets(oldItem, recentItem) {
  const oldKeys = new Set(Object.keys(oldItem || {}));
  const recentKeys = new Set(Object.keys(recentItem || {}));
  const missingInOld = [...recentKeys].filter((key) => !oldKeys.has(key));
  return { missingInOld };
}

// Lay 1 trang dau tien (toi da 10 ban ghi mau) + `total` that cua 1 entity,
// roi dung ngay - khong tai het toan bo entity chi de lay mau.
async function fetchSampleAndTotal(kiotVietClient, endpoint, query) {
  let sample = [];
  let total = 0;
  try {
    await kiotVietClient.fetchAllPages(endpoint, query, async (items, pageInfo) => {
      sample = items.slice(0, 10);
      total = pageInfo.total;
      throw STOP_AFTER_FIRST_PAGE;
    });
  } catch (err) {
    if (err !== STOP_AFTER_FIRST_PAGE) throw err;
  }
  return { sample, total };
}

async function estimateAllEntities(kiotVietClient, entities, { warnThresholdMb = WARN_THRESHOLD_MB, log = console.log } = {}) {
  const report = [];
  let totalMb = 0;
  for (const entityModule of entities) {
    const { sample, total } = await fetchSampleAndTotal(kiotVietClient, entityModule.endpoint, entityModule.listQuery || {});
    const estimatedMb = estimateStorageMb(sample, total);
    totalMb += estimatedMb;
    report.push({ entity: entityModule.entity, total, estimatedMb });
  }
  log('entity | total | uoc luong MB');
  for (const row of report) log(`${row.entity} | ${row.total} | ${row.estimatedMb.toFixed(2)}`);
  log(`Tong uoc luong: ${totalMb.toFixed(2)} MB (nguong canh bao: ${warnThresholdMb} MB, free tier: 500 MB)`);
  if (totalMb > warnThresholdMb) {
    log(`CANH BAO: uoc luong vuot nguong ${warnThresholdMb} MB - can chan --from gan hon truoc khi backfill toan bo.`);
  }
  return { report, totalMb };
}

async function compareOldVsRecentInvoice(kiotVietClient, { oldFromIso, oldToIso }, { log = console.log } = {}) {
  const invoices = require('./entities/invoices');
  const [{ sample: oldSample }, { sample: recentSample }] = await Promise.all([
    fetchSampleAndTotal(kiotVietClient, invoices.endpoint, { ...invoices.listQuery, lastModifiedFrom: oldFromIso, lastModifiedTo: oldToIso }),
    fetchSampleAndTotal(kiotVietClient, invoices.endpoint, invoices.listQuery)
  ]);
  if (!oldSample[0] || !recentSample[0]) {
    log('Khong lay duoc mau hoa don cu hoac gan day de so sanh field - kiem tra lai khoang thoi gian --old-from/--old-to.');
    return { missingInOld: [] };
  }
  const { missingInOld } = compareFieldSets(oldSample[0], recentSample[0]);
  if (missingInOld.length) {
    log(`CANH BAO: hoa don cu thieu field so voi hoa don gan day: ${missingInOld.join(', ')}`);
  } else {
    log('Hoa don cu co du field nhu hoa don gan day - khong phat hien cat bot du lieu lich su.');
  }
  return { missingInOld };
}

function parseArgs(argv) {
  const args = { branch: 'hanoi', oldFromIso: '2026-01-01T00:00:00Z', oldToIso: '2026-01-31T23:59:59Z' };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'branch') args.branch = value;
    if (key === 'old-from') args.oldFromIso = value;
    if (key === 'old-to') args.oldToIso = value;
  }
  return args;
}

async function main() {
  // Tao client that tu cau hinh env - CHUA goi API nao o day, chi khoi tao.
  const { createKiotVietClient } = require('../kiotviet/kiotVietApiClient');
  const { getConfiguredBranches } = require('./config');
  const entities = [
    require('./entities/categories'), require('./entities/products'), require('./entities/customers'),
    require('./entities/suppliers'), require('./entities/invoices'), require('./entities/orders'),
    require('./entities/returns'), require('./entities/purchases'), require('./entities/cashFlows')
  ];

  const args = parseArgs(process.argv.slice(2));
  const branchConfig = getConfiguredBranches().find((b) => b.branch === args.branch);
  if (!branchConfig) {
    console.error(`[preflightCheck] Co so "${args.branch}" chua duoc cau hinh du credentials.`);
    process.exitCode = 1;
    return;
  }

  const kiotVietClient = createKiotVietClient(branchConfig);
  console.log(`[preflightCheck] Chay cho co so "${args.branch}" - CHI DOC, khong ghi Postgres.`);
  await compareOldVsRecentInvoice(kiotVietClient, args);
  await estimateAllEntities(kiotVietClient, entities);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[preflightCheck] That bai: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  estimateStorageMb,
  compareFieldSets,
  fetchSampleAndTotal,
  estimateAllEntities,
  compareOldVsRecentInvoice,
  parseArgs
};
