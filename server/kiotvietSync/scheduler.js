'use strict';

const CONFIG = require('../config');
const { getConfiguredBranches } = require('./config');
const { createKiotVietClient } = require('../kiotviet/kiotVietApiClient');
const { pollEntityOnce } = require('./syncDriver');
const { recordFailure } = require('./checkpointRepository');
const { getPool } = require('../db/pool');
const { startDashboardRollupSchedule } = require('./dashboardRollupRefresh');

const fastEntities = [require('./entities/invoices'), require('./entities/orders')];
const slowEntities = [require('./entities/categories'), require('./entities/products'), require('./entities/customers'),
  require('./entities/suppliers'), require('./entities/returns'), require('./entities/purchases'), require('./entities/cashFlows')];

function createPollingScheduler({
  enabled = CONFIG.KIOTVIET_SYNC_ENABLED,
  fastIntervalMs = CONFIG.KIOTVIET_SYNC_FAST_INTERVAL_MS,
  slowIntervalMs = CONFIG.KIOTVIET_SYNC_SLOW_INTERVAL_MS,
  dashboardRollupIntervalMs = 5 * 60 * 1000,
  getConfiguredBranches: getBranches = getConfiguredBranches,
  createKiotVietClient: createClient = createKiotVietClient,
  pollEntityOnce: poll = pollEntityOnce,
  recordFailure: record = recordFailure,
  setIntervalFn = setInterval,
  getPool: getPoolFn = getPool,
  startDashboardRollupSchedule: startRollup = startDashboardRollupSchedule,
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
    return [
      setIntervalFn(() => runGroup(fastEntities), fastIntervalMs),
      setIntervalFn(() => runGroup(slowEntities), slowIntervalMs),
      // Rollup bao cao Dashboard (server/db/migrations/0013) - doc lap voi
      // polling KiotViet, nhung nhet chung khoi khoi dong nay (chi bat khi
      // KIOTVIET_SYNC_ENABLED=true) de khong can 1 co che enable/disable rieng.
      startRollup({
        pool: getPoolFn(),
        intervalMs: dashboardRollupIntervalMs,
        setIntervalFn,
        log: logger.log ? logger.log.bind(logger) : logger
      })
    ];
  }
  return { startPollingScheduler, runGroup };
}

const scheduler = createPollingScheduler();
module.exports = { ...scheduler, createPollingScheduler };
