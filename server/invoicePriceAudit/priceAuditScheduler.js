'use strict';

// Lich job "Kiem tra gia ban": moi phut xem slot 23:00 VN gan nhat <= now (latestDueDay) va goi runDailyAudit.
//  - Hoan thanh dua tren DB: runDailyAudit tu tra 'already-completed' neu ngay da cong bo; bo nho tien trinh chi
//    ghi nho de khong goi lai moi phut sau khi slot da xong.
//  - Khoi dong lai: tick dau tien bat kip slot gan nhat chua thanh cong; KHONG dung lai cac ngay cu hon.
//  - Loi ('failed' hoac nem): cho 5 phut roi thu lai CUNG slot. 'busy' (instance khac giu khoa): thu lai phut sau.
//  - Khong chay chong trong 1 tien trinh (co running); nhieu instance da co khoa advisory trong runDailyAudit.
//  - Timer unref, stop() xoa timer (index.js goi theo SIGTERM/SIGINT).

const { runDailyAudit, latestDueDay } = require('./priceAuditRefresh');

const DONE_STATUSES = new Set(['completed', 'already-completed', 'stale']);
const RETRY_DELAY_MS = 5 * 60 * 1000;

function createPriceAuditScheduler({
  enabled = false,
  pool,
  now = () => new Date(),
  runDaily = runDailyAudit,
  intervalMs = 60 * 1000,
  retryDelayMs = RETRY_DELAY_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  logger = console
} = {}) {
  let timer = null;
  let started = false;
  let stopped = false;
  let running = false;
  let doneDay = null;
  let failedDay = null;
  let failedAt = 0;

  function resolvePool() {
    return pool || require('../db/pool').getPool();
  }

  async function tick() {
    if (stopped || running) return;
    running = true;
    try {
      const current = now();
      const day = latestDueDay(current);
      if (day === doneDay) return;
      if (day === failedDay && +current - failedAt < retryDelayMs) return;
      let outcome;
      try {
        outcome = await runDaily({ day, pool: resolvePool(), now: current, logger });
      } catch (err) {
        logger.error?.(`[PriceAudit] Loi lich chay ngay ${day}: ${err && err.code ? err.code : 'UNKNOWN'}`);
        outcome = { status: 'failed' };
      }
      const status = outcome && outcome.status;
      if (DONE_STATUSES.has(status)) {
        doneDay = day;
        failedDay = null;
      } else if (status === 'failed') {
        failedDay = day;
        failedAt = +current;
      }
      // 'busy' / 'not-due': thu lai o nhip ke tiep.
    } finally {
      running = false;
    }
  }

  function start() {
    if (!enabled || started) return Promise.resolve();
    started = true;
    stopped = false;
    timer = setIntervalFn(() => { tick().catch(() => {}); }, intervalMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return tick();
  }

  function stop() {
    stopped = true;
    if (timer !== null) clearIntervalFn(timer);
    timer = null;
  }

  return { start, stop, tick };
}

module.exports = { createPriceAuditScheduler, RETRY_DELAY_MS };
