'use strict';

const { validateCodes, loadProductCatalogMap: defaultLoadProductCatalogMap } = require('./productCodeValidator');
const { analyzeStockoutTimeline } = require('./stockoutEngine');
const { loadStockoutEvents: defaultLoadStockoutEvents } = require('./stockoutEventLoader');
const { addDaysToDateKey, todayVnDateKey } = require('./dateHelpers');

const MIN_STOCKOUT_DAYS = 5;
const DEFAULT_DAYS_BACK = 183;

async function runStockoutCheckJob(jobStore, jobId, rawCodes, deps = {}) {
  const {
    loadProductCatalogMap = defaultLoadProductCatalogMap,
    sheetsClient,
    client,
    branch,
    loadStockoutEvents = defaultLoadStockoutEvents,
    daysBack = DEFAULT_DAYS_BACK,
    todayKey = todayVnDateKey()
  } = deps;

  try {
    const catalogMap = await loadProductCatalogMap(branch);
    const { validCodes, invalidCodes } = validateCodes(rawCodes, catalogMap);
    jobStore.updateProgress(jobId, { invalidCodes, totalValidCodes: validCodes.length });

    if (validCodes.length === 0) {
      jobStore.setError(jobId, {
        message: 'Không có mã hàng hợp lệ nào trong danh sách đã upload.',
        code: 'NO_VALID_CODES'
      });
      return;
    }

    const fromDate = addDaysToDateKey(todayKey, -daysBack);
    const calculationFromDate = addDaysToDateKey(fromDate, -(MIN_STOCKOUT_DAYS - 1));
    const validCodeSet = new Set(validCodes.map((v) => v.code));

    jobStore.updateProgress(jobId, { progress: { phase: 2 } });
    const { eventMapByCode, sources, warnings } = await loadStockoutEvents({
      client,
      sheetsClient,
      validCodeSet,
      fromDate: calculationFromDate,
      toDate: todayKey,
      onProgress(sourceProgress) {
        jobStore.updateProgress(jobId, { progress: {
          phase: 2,
          source: sourceProgress.source,
          sourceLabel: sourceProgress.label,
          sourceStatus: sourceProgress.status,
          phase2: sourceProgress
        } });
      }
    });

    const rows = validCodes.map(({ code, name, currentOnHand }) => {
      const events = eventMapByCode.get(code) || [];
      const { periods, summary } = analyzeStockoutTimeline({
        currentOnHand, events, todayKey, daysBack, minConsecutiveDays: MIN_STOCKOUT_DAYS
      });
      return {
        code,
        name,
        currentOnHand,
        stockoutCount: summary.stockoutCount,
        totalStockoutDays: summary.totalStockoutDays,
        periods
      };
    });

    jobStore.setResult(jobId, {
      fromDate,
      toDate: todayKey,
      totalValidCodes: validCodes.length,
      invalidCodes,
      sources,
      warnings,
      rows
    });
  } catch (err) {
    jobStore.setError(jobId, { message: err.message, code: err.code || 'UNEXPECTED_ERROR' });
  }
}

module.exports = { runStockoutCheckJob };
