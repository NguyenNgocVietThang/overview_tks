'use strict';

const CONFIG = require('../config');
const { getConfiguredBranches } = require('./config');
const { createKiotVietClient } = require('../kiotviet/kiotVietApiClient');
const { pollEntityOnce } = require('./syncDriver');
const { recordFailure } = require('./checkpointRepository');
const { getPool } = require('../db/pool');
const { startDashboardRollupSchedule } = require('./dashboardRollupRefresh');
const { startCustomerDebtReportRefreshSchedule } = require('./customerDebtReportRefresh');
const { startProductReportSchedule } = require('./productReportRefresh');

const fastEntities = [require('./entities/invoices'), require('./entities/orders')];
const slowEntities = [require('./entities/categories'), require('./entities/products'), require('./entities/customers'),
  require('./entities/suppliers'), require('./entities/returns'), require('./entities/purchases'), require('./entities/cashFlows')];

function createPollingScheduler({
  enabled = CONFIG.KIOTVIET_SYNC_ENABLED,
  fastIntervalMs = CONFIG.KIOTVIET_SYNC_FAST_INTERVAL_MS,
  slowIntervalMs = CONFIG.KIOTVIET_SYNC_SLOW_INTERVAL_MS,
  dashboardRollupIntervalMs = 5 * 60 * 1000,
  customerDebtReportIntervalMs = 5 * 60 * 1000,
  productReportIntervalMs = 5 * 60 * 1000,
  getConfiguredBranches: getBranches = getConfiguredBranches,
  createKiotVietClient: createClient = createKiotVietClient,
  pollEntityOnce: poll = pollEntityOnce,
  recordFailure: record = recordFailure,
  setIntervalFn = setInterval,
  scheduleImmediate = queueMicrotask,
  getPool: getPoolFn = getPool,
  startDashboardRollupSchedule: startRollup = startDashboardRollupSchedule,
  startCustomerDebtReportRefreshSchedule: startCustomerDebtReportRefresh = startCustomerDebtReportRefreshSchedule,
  startProductReportSchedule: startProductReport = startProductReportSchedule,
  logger = console
} = {}) {
  async function runGroup(entities) {
    const branches = getBranches();
    if (!branches.length) {
      logger.warn('[KiotViet Sync] Không có cơ sở đủ cấu hình; bỏ qua nhịp polling.');
      return;
    }
    await Promise.allSettled(branches.map(async (branchConfig) => {
      const api = createClient(branchConfig);
      await Promise.allSettled(entities.map(async (entity) => {
        try {
          await poll(api, branchConfig.branch, entity);
        } catch (error) {
          await record(branchConfig.branch, entity.entity, error.message).catch((recordError) => {
            logger.error('[KiotViet Sync] Không ghi được lỗi checkpoint:', recordError.message);
          });
        }
      }));
    }));
  }

  function startPollingScheduler() {
    if (!enabled) return [];
    // Chạy một lượt nền ngay khi service khởi động để bù khoảng trống từ
    // checkpoint gần nhất (ví dụ Render vừa ngủ/redeploy). Không await ở đây
    // để HTTP server vẫn sẵn sàng nhận request trong lúc đồng bộ catch-up.
    scheduleImmediate(() => {
      runGroup(fastEntities).catch((error) => logger.error('[KiotViet Sync] Lỗi lượt fast ban đầu:', error.message));
      runGroup(slowEntities).catch((error) => logger.error('[KiotViet Sync] Lỗi lượt slow ban đầu:', error.message));
    });
    return [
      setIntervalFn(() => runGroup(fastEntities), fastIntervalMs),
      setIntervalFn(() => runGroup(slowEntities), slowIntervalMs),
      // Rollup bao cao Dashboard (server/db/migrations/0013) - doc lap voi
      // polling KiotViet, nhung nhet chung khoi khoi dong nay (chi bat khi
      // KIOTVIET_SYNC_ENABLED=true) de khong can 1 co che enable/disable rieng.
      startRollup(getPoolFn(), {
        intervalMs: dashboardRollupIntervalMs,
        setIntervalFn,
        log: logger.log ? logger.log.bind(logger) : logger
      }),
      // Bao cao cong no khach hang HN1/HN3/HN7 (server/db/migrations/0014) -
      // cung 1 ly do nhet chung khoi khoi dong nay nhu rollup Dashboard o tren.
      startCustomerDebtReportRefresh(getPoolFn(), {
        intervalMs: customerDebtReportIntervalMs,
        setIntervalFn,
        log: logger.log ? logger.log.bind(logger) : logger
      }),
      // Bao cao hang hoa (server/db/migrations/0018) - CHI tinh lai 1 lan/dem
      // (ham refreshProductReportIfDue tu kiem tra ngay VN, xem
      // productReportRefresh.js) du duoc kiem tra moi 5 phut nhu cac job tren.
      startProductReport(getPoolFn(), {
        intervalMs: productReportIntervalMs,
        setIntervalFn,
        scheduleImmediate,
        log: logger.log ? logger.log.bind(logger) : logger
      })
    ];
  }
  return { startPollingScheduler, runGroup };
}

const scheduler = createPollingScheduler();
module.exports = { ...scheduler, createPollingScheduler };
