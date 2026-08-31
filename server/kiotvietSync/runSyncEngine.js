'use strict';

const { getPool, closePool } = require('../db/pool');
const { createKiotVietClient } = require('../kiotviet/kiotVietApiClient');
const { loadBranchConfigs } = require('./branchConfig');
const { startBranchLoops, runEntitySync } = require('./scheduler');
const config = require('../config');

const { syncCategories } = require('./entities/categoriesSync');
const { syncProducts } = require('./entities/productsSync');
const { syncCustomers } = require('./entities/customersSync');
const { syncSuppliers } = require('./entities/suppliersSync');
const { syncInvoices } = require('./entities/invoicesSync');
const { syncOrders } = require('./entities/ordersSync');
const { syncReturns } = require('./entities/returnsSync');
const { syncPurchases } = require('./entities/purchasesSync');
const { syncCashFlows } = require('./entities/cashFlowsSync');

// Nhip nhanh: invoices/orders -- 2 bang gia tri cao nhat. Nhip cham: cac
// entity con lai (PlanDB.md §7.3). staff KHONG co trong danh sach nay -- no
// la helper suy luan ben trong cac entity o day, khong tu chay doc lap.
const FAST_ENTITIES = [
  { name: 'invoices', sync: syncInvoices },
  { name: 'orders', sync: syncOrders }
];
const SLOW_ENTITIES = [
  { name: 'categories', sync: syncCategories },
  { name: 'products', sync: syncProducts },
  { name: 'customers', sync: syncCustomers },
  { name: 'suppliers', sync: syncSuppliers },
  { name: 'purchases', sync: syncPurchases },
  { name: 'returns', sync: syncReturns },
  { name: 'cash_flows', sync: syncCashFlows }
];

// Ghep branchConfig (credentials tu env) voi dong branches (id noi bo tu DB)
// theo code -- pure function, khong I/O, de test doc lap voi wiring that.
function matchBranchRows(branchConfigs, branchRows) {
  const matched = [];
  for (const branchConfig of branchConfigs) {
    const row = branchRows.find((r) => r.code === branchConfig.code);
    if (!row) continue;
    matched.push({
      branch: { id: row.id, code: row.code, kiotvietRetailer: row.kiotviet_retailer },
      config: branchConfig
    });
  }
  return matched;
}

// Stagger: branch dau tien chay ngay, cac branch sau lech dan nua chu ky
// nhanh de tranh don request cung luc (PlanDB.md §7.3).
function computeStartDelayMs(index, fastIntervalMs) {
  return index * (fastIntervalMs / 2);
}

async function loadActiveBranchRows(pool) {
  const result = await pool.query('SELECT id, code, kiotviet_retailer FROM branches WHERE is_active = true');
  return result.rows;
}

async function runAllEntitiesOnce(pool, kiotVietClient, branch) {
  for (const entity of FAST_ENTITIES.concat(SLOW_ENTITIES)) {
    await runEntitySync(pool, kiotVietClient, branch, entity.name, entity.sync);
  }
}

async function main() {
  const once = process.argv.includes('--once');
  const pool = getPool();

  const branchConfigs = loadBranchConfigs();
  const branchRows = await loadActiveBranchRows(pool);
  const activeBranches = matchBranchRows(branchConfigs, branchRows).map(({ branch, config: branchConfig }) => ({
    branch,
    client: createKiotVietClient({
      clientId: branchConfig.clientId,
      clientSecret: branchConfig.clientSecret,
      retailer: branchConfig.retailer
    })
  }));

  if (activeBranches.length === 0) {
    console.warn('[runSyncEngine] Khong co branch nao duoc cau hinh du (thieu KIOTVIET_CLIENT_ID/SECRET/RETAILER), thoat.');
    await closePool();
    return;
  }

  if (once) {
    for (const { branch, client } of activeBranches) {
      await runAllEntitiesOnce(pool, client, branch);
    }
    await closePool();
    console.log(`[runSyncEngine] Da chay xong 1 luot (--once) cho ${activeBranches.length} branch.`);
    return;
  }

  const stops = activeBranches.map(({ branch, client }, index) =>
    startBranchLoops(pool, client, branch, {
      fastEntities: FAST_ENTITIES,
      slowEntities: SLOW_ENTITIES,
      fastIntervalMs: config.KIOTVIET_SYNC_FAST_INTERVAL_MS,
      slowIntervalMs: config.KIOTVIET_SYNC_SLOW_INTERVAL_MS,
      startDelayMs: computeStartDelayMs(index, config.KIOTVIET_SYNC_FAST_INTERVAL_MS)
    })
  );

  console.log(`[runSyncEngine] Da khoi dong sync engine dai han cho ${activeBranches.length} branch.`);

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[runSyncEngine] Nhan ${signal}, dang dung...`);
    stops.forEach((stop) => stop());
    await closePool();
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { main, matchBranchRows, computeStartDelayMs };

if (require.main === module) {
  main().catch((err) => {
    console.error('[runSyncEngine] Loi khoi dong:', err.message);
    process.exit(1);
  });
}
