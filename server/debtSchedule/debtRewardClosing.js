'use strict';

// Shared by scheduled snapshots and manual refresh. Never freeze a month ahead of its ledger.
async function settleDebtRewards(pool, {
  log = console.log,
  finalizePenalties = require('./debtPenaltyLedger').finalizePendingPenaltyCycles,
  rewardService = require('./debtRewardService').createDebtRewardService({ pool }),
  notify = () => {
    const { dashboardRollupEvents } = require('../kiotvietSync/dashboardRollupEvents');
    dashboardRollupEvents.emit('debtScheduleChanged', { at: Date.now() });
    dashboardRollupEvents.emit('updated', { at: Date.now() });
  }
} = {}) {
  await finalizePenalties(pool, { log });
  let notified = false;
  const months = await rewardService.finalizePendingMonths({ onClosed: month => {
    log(`[debtRewardClosing] Đã chốt thưởng tháng ${month}.`);
    notify();
    notified = true;
  } });
  if (months.length) {
    log(`[debtRewardClosing] Đã chốt thưởng tháng ${months.join(', ')}.`);
    if (!notified) notify();
  }
  return months;
}

module.exports = { settleDebtRewards };
