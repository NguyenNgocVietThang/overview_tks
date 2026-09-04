'use strict';

const { getPool, closePool } = require('../db/pool');
const { createKiotVietClient } = require('../kiotviet/kiotVietApiClient');
const { loadBranchConfigs } = require('./branchConfig');

const { syncCategories } = require('./entities/categoriesSync');
const { syncProducts } = require('./entities/productsSync');
const { syncCustomers } = require('./entities/customersSync');
const { syncSuppliers } = require('./entities/suppliersSync');
const { syncOrders } = require('./entities/ordersSync');
const { syncReturns } = require('./entities/returnsSync');
const { upsertInvoice } = require('./entities/invoicesSync');
const { upsertPurchase } = require('./entities/purchasesSync');
const { upsertCashFlow } = require('./entities/cashFlowsSync');
const { getOffset, saveOffset, clearOffset } = require('./backfillProgressRepository');

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function lastDayOfMonth(year, month) {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1];
}

// Chia theo thang de giam rui ro troi trang do phan trang offset-based tren
// tap du lieu lon (PlanDB.md §9). Chi co y nghia cho entity co tham so ngay
// bi chan that su (fromXDate/toXDate) -- xem cac nhanh rieng trong runBackfill.
function generateMonthRanges(fromDateStr, toDateStr) {
  const [fromY, fromM, fromD] = fromDateStr.split('-').map(Number);
  const [toY, toM, toD] = toDateStr.split('-').map(Number);

  const months = [];
  let y = fromY;
  let m = fromM;
  while (y < toY || (y === toY && m <= toM)) {
    const monthKey = `${y}-${pad2(m)}`;
    const isFirstMonth = y === fromY && m === fromM;
    const isLastMonth = y === toY && m === toM;
    const startDay = isFirstMonth ? fromD : 1;
    const endDay = isLastMonth ? toD : lastDayOfMonth(y, m);

    months.push({
      monthKey,
      startQuery: `${monthKey}-${pad2(startDay)}T00:00:00`,
      endQuery: `${monthKey}-${pad2(endDay)}T23:59:59`
    });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

// Namespace rieng ('<entity>:backfill[:YYYY-MM]') de khong lan voi checkpoint
// dong bo thuong (PlanDB-Phase1-Spec.md §12). Backfill KHONG dung
// sync_checkpoints -- do la moc rieng cho sync incremental, chay tu dong.
async function isAlreadyDone(pool, branchId, entityName) {
  const result = await pool.query(
    `SELECT 1 FROM sync_run_log WHERE branch_id = $1 AND entity_name = $2 AND status = 'success' LIMIT 1`,
    [branchId, entityName]
  );
  return result.rows.length > 0;
}

async function logResult(pool, branchId, entityName, { status, fetched, upserted, errorMessage, startedAt, finishedAt }) {
  await pool.query(
    `INSERT INTO sync_run_log (branch_id, entity_name, started_at, finished_at, status, records_fetched, records_upserted, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      branchId, entityName, startedAt, finishedAt, status,
      fetched === undefined ? null : fetched, upserted === undefined ? null : upserted, errorMessage || null
    ]
  );
}

// Neu syncFn ho tro options.startItem/onProgress (6 entity dang-lap khong
// chia thang), backfill se tiep tuc dung tu trang bi dung lai (offset luu o
// backfill_progress) thay vi keo lai tu currentItem=0 khi bi gian doan.
async function runOnceEntity(pool, kiotVietClient, branch, entityName, syncFn, sinceIsoParam) {
  const logName = `${entityName}:backfill`;
  if (await isAlreadyDone(pool, branch.id, logName)) {
    console.log(`[backfill] ${logName} da hoan tat truoc do, bo qua.`);
    return;
  }
  const startedAt = new Date();
  try {
    const startItem = await getOffset(pool, branch.id, logName);
    if (startItem > 0) console.log(`[backfill] ${logName} tiep tuc tu vi tri ${startItem}.`);
    const { fetched, upserted } = await syncFn(pool, kiotVietClient, branch, sinceIsoParam, {
      startItem,
      onProgress: (nextItem) => saveOffset(pool, branch.id, logName, nextItem)
    });
    await logResult(pool, branch.id, logName, { status: 'success', fetched, upserted, startedAt, finishedAt: new Date() });
    await clearOffset(pool, branch.id, logName);
    console.log(`[backfill] ${logName}: fetched=${fetched} upserted=${upserted}`);
  } catch (error) {
    await logResult(pool, branch.id, logName, { status: 'error', errorMessage: error.message, startedAt, finishedAt: new Date() });
    console.error(`[backfill] ${logName} that bai: ${error.message}`);
  }
}

// progressKey dinh danh rieng buoc fetch nay trong backfill_progress (vi du
// mot thang cash_flows can 2 key rieng cho receipt/expense). Offset chi bi
// xoa SAU KHI fetchAllPages hoan tat khong loi -- neu nem loi, offset da luu
// o lan onPage gan nhat van con, lan chay sau se tiep tuc dung cho.
async function fetchAndUpsert(kiotVietClient, endpoint, query, upsertFn, pool, branch, progressKey) {
  let fetched = 0;
  let upserted = 0;
  const startItem = await getOffset(pool, branch.id, progressKey);
  await kiotVietClient.fetchAllPages(endpoint, query, async (items, meta) => {
    fetched += items.length;
    for (const item of items) {
      upserted += await upsertFn(pool, branch, item);
    }
    if (meta && typeof meta.nextItem === 'number') {
      await saveOffset(pool, branch.id, progressKey, meta.nextItem);
    }
  }, { startItem });
  await clearOffset(pool, branch.id, progressKey);
  return { fetched, upserted };
}

async function runMonthlyEntity(pool, branch, entityName, months, runMonthFn) {
  for (const month of months) {
    const logName = `${entityName}:backfill:${month.monthKey}`;
    if (await isAlreadyDone(pool, branch.id, logName)) {
      console.log(`[backfill] ${logName} da hoan tat truoc do, bo qua.`);
      continue;
    }
    const startedAt = new Date();
    try {
      const { fetched, upserted } = await runMonthFn(month, logName);
      await logResult(pool, branch.id, logName, { status: 'success', fetched, upserted, startedAt, finishedAt: new Date() });
      console.log(`[backfill] ${logName}: fetched=${fetched} upserted=${upserted}`);
    } catch (error) {
      await logResult(pool, branch.id, logName, { status: 'error', errorMessage: error.message, startedAt, finishedAt: new Date() });
      console.error(`[backfill] ${logName} that bai: ${error.message}`);
    }
  }
}

async function runBackfill(pool, kiotVietClient, branch, { from, to }) {
  const toDate = to || new Date().toISOString().slice(0, 10);
  const months = generateMonthRanges(from, toDate);
  const fromQuery = `${from}T00:00:00`;

  // Dimension: khong co khai niem "theo thang", chay 1 lan full.
  await runOnceEntity(pool, kiotVietClient, branch, 'categories', syncCategories, null);
  await runOnceEntity(pool, kiotVietClient, branch, 'products', syncProducts, null);
  await runOnceEntity(pool, kiotVietClient, branch, 'customers', syncCustomers, null);
  await runOnceEntity(pool, kiotVietClient, branch, 'suppliers', syncSuppliers, null);

  // orders/returns: live probe 2026-08-30 xac nhan KHONG co tham so chan tren
  // nao hoat dong (lastModifiedTo, toModifiedDate deu bi API bo qua). Khong
  // the chia an toan theo thang -- chay 1 lan full voi lastModifiedFrom =
  // --from, chap nhan rui ro troi trang do phan trang offset-based tren tap
  // lon (PlanDB.md §9, rui ro da duoc ghi nhan truoc, khong phai loi thiet ke
  // moi). Xem kiotviet/API_ENDPOINTS.md.
  await runOnceEntity(pool, kiotVietClient, branch, 'orders', syncOrders, fromQuery);
  await runOnceEntity(pool, kiotVietClient, branch, 'returns', syncReturns, fromQuery);

  // invoices/purchases: co tham so ngay bi chan that su (fromPurchaseDate/
  // toPurchaseDate, da xac nhan qua production code + live probe) -- chia
  // duoc theo thang an toan.
  await runMonthlyEntity(pool, branch, 'invoices', months, (month, logName) =>
    fetchAndUpsert(
      kiotVietClient, 'invoices',
      {
        includePayment: 'true', includeInvoiceDelivery: 'true', IncludeSaleChannel: 'true',
        fromPurchaseDate: month.startQuery, toPurchaseDate: month.endQuery
      },
      upsertInvoice, pool, branch, logName
    )
  );
  await runMonthlyEntity(pool, branch, 'purchases', months, (month, logName) =>
    fetchAndUpsert(
      // Endpoint la "purchaseorders", KHONG phai "/purchases".
      kiotVietClient, 'purchaseorders',
      { includePayment: 'true', includeOrderDelivery: 'true', fromPurchaseDate: month.startQuery, toPurchaseDate: month.endQuery },
      upsertPurchase, pool, branch, logName
    )
  );

  // cash_flows: startDate/endDate bi chan that su, nhung can 2 luot goi
  // isReceipt=true/false rieng moi thang (API khong tra field isReceipt
  // trong response, chi phan biet duoc qua query da goi). Moi luot dung
  // progressKey rieng (":receipt"/":expense") de neu dut giua luot expense,
  // luot receipt da xong khong bi keo lai.
  await runMonthlyEntity(pool, branch, 'cash_flows', months, async (month, logName) => {
    const receipts = await fetchAndUpsert(
      kiotVietClient, 'cashflow',
      { includeAccount: 'true', includeBranch: 'true', includeUser: 'true', startDate: month.startQuery, endDate: month.endQuery, isReceipt: 'true' },
      (p, b, item) => upsertCashFlow(p, b, item, true), pool, branch, `${logName}:receipt`
    );
    const expenses = await fetchAndUpsert(
      kiotVietClient, 'cashflow',
      { includeAccount: 'true', includeBranch: 'true', includeUser: 'true', startDate: month.startQuery, endDate: month.endQuery, isReceipt: 'false' },
      (p, b, item) => upsertCashFlow(p, b, item, false), pool, branch, `${logName}:expense`
    );
    return { fetched: receipts.fetched + expenses.fetched, upserted: receipts.upserted + expenses.upserted };
  });
}

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.branch || !args.from) {
    console.error('Usage: node backfill.js --branch=hanoi|saigon --from=YYYY-MM-DD [--to=YYYY-MM-DD]');
    process.exit(1);
  }

  const pool = getPool();
  const branchConfigs = loadBranchConfigs();
  const branchConfig = branchConfigs.find((b) => b.code === args.branch);
  if (!branchConfig) {
    console.error(`[backfill] Khong tim thay cau hinh KiotViet cho branch '${args.branch}'.`);
    process.exit(1);
  }
  const branchRow = (await pool.query('SELECT id, code, kiotviet_retailer FROM branches WHERE code = $1', [args.branch])).rows[0];
  if (!branchRow) {
    console.error(`[backfill] Khong tim thay branch '${args.branch}' trong bang branches.`);
    process.exit(1);
  }

  const branch = { id: branchRow.id, code: branchRow.code, kiotvietRetailer: branchRow.kiotviet_retailer };
  const client = createKiotVietClient({
    clientId: branchConfig.clientId, clientSecret: branchConfig.clientSecret, retailer: branchConfig.retailer
  });

  await runBackfill(pool, client, branch, { from: args.from, to: args.to });
  await closePool();
}

module.exports = { generateMonthRanges, runBackfill };

if (require.main === module) {
  main().catch((err) => {
    console.error('[backfill] Loi:', err.message);
    process.exit(1);
  });
}
