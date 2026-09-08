'use strict';

const CONFIG = require('../../config');
const { analyzeStockoutTimeline, computeStockoutWindow, STOCKOUT_DATA_FLOOR_DATE_KEY } = require('./stockoutEngine');
const { todayVnDateKey } = require('./dateHelpers');
const { loadActiveCandidates } = require('./sheetTimelineBuilder');
const { loadStockoutEvents: defaultLoadStockoutEvents } = require('./stockoutEventLoader');

const DEFAULT_MIN_CONSECUTIVE_DAYS = 5;
const DEFAULT_DAYS_BACK = 89; // 89 ngay truoc + hom nay = dung 90 ngay

async function runStockout90dScanJob(jobStore, jobId, deps = {}) {
  const {
    sheetsClient,
    client,
    loadStockoutEvents = defaultLoadStockoutEvents,
    daysBack = DEFAULT_DAYS_BACK,
    todayKey = todayVnDateKey(),
    minConsecutiveDays = DEFAULT_MIN_CONSECUTIVE_DAYS,
    dataFromDateFloor = STOCKOUT_DATA_FLOOR_DATE_KEY
  } = deps;

  try {
    jobStore.updateProgress(jobId, { progress: { phase: 1 } });
    const sheets = await sheetsClient.getMultipleSheetValues([CONFIG.SHEET_PRODUCTS]);

    const { candidates, totalProductsScanned } = loadActiveCandidates(sheets[CONFIG.SHEET_PRODUCTS] || []);
    const { reportFromDate: fromDate, calculationFromDate } = computeStockoutWindow({
      todayKey, daysBack, minConsecutiveDays, dataFromDateFloor
    });

    if (candidates.length === 0) {
      jobStore.setResult(jobId, { asOfDate: todayKey, fromDate, totalProductsScanned, totalCandidates: 0, sources: {}, warnings: [], rows: [] });
      return;
    }

    const validCodeSet = new Set(candidates.map((c) => c.code));
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

    const rows = [];
    for (const { code, name, currentOnHand } of candidates) {
      const events = eventMapByCode.get(code) || [];
      const { periods, summary } = analyzeStockoutTimeline({
        currentOnHand, events, todayKey, daysBack, minConsecutiveDays, dataFromDateFloor
      });
      if (periods.length === 0) continue;
      rows.push({
        code,
        name,
        stockoutCount: summary.stockoutCount,
        totalStockoutDays: summary.totalStockoutDays,
        periods,
        currentOnHand
      });
    }

    jobStore.setResult(jobId, {
      asOfDate: todayKey,
      fromDate,
      totalProductsScanned,
      totalCandidates: candidates.length,
      sources,
      warnings,
      rows
    });
  } catch (err) {
    jobStore.setError(jobId, { message: err.message, code: err.code || 'UNEXPECTED_ERROR' });
  }
}

module.exports = { runStockout90dScanJob };
