'use strict';

const CONFIG = require('../../config');
const { analyzeStockoutTimeline } = require('./stockoutEngine');
const { addDaysToDateKey, todayVnDateKey } = require('./dateHelpers');
const { loadActiveCandidates } = require('./sheetTimelineBuilder');
const { loadStockoutEvents: defaultLoadStockoutEvents } = require('./stockoutEventLoader');

const DEFAULT_MIN_CONSECUTIVE_DAYS = 5;
const DEFAULT_DAYS_BACK = 183;

async function runRecentStockoutScanJob(jobStore, jobId, deps = {}) {
  const {
    sheetsClient,
    client,
    loadStockoutEvents = defaultLoadStockoutEvents,
    daysBack = DEFAULT_DAYS_BACK,
    todayKey = todayVnDateKey(),
    minConsecutiveDays = DEFAULT_MIN_CONSECUTIVE_DAYS
  } = deps;

  try {
    jobStore.updateProgress(jobId, { progress: { phase: 1 } });
    const sheets = await sheetsClient.getMultipleSheetValues([CONFIG.SHEET_PRODUCTS]);

    const { candidates: allActive, totalProductsScanned } = loadActiveCandidates(sheets[CONFIG.SHEET_PRODUCTS] || []);
    // Giu nguyen ngu nghia cu cua "Hang dut gan day": chi bao cao ma DANG het
    // hang (ton kho hien tai = 0) va van con dut den hom nay.
    const candidates = allActive.filter((c) => c.currentOnHand === 0);
    const fromDate = addDaysToDateKey(todayKey, -daysBack);
    const calculationFromDate = addDaysToDateKey(fromDate, -(minConsecutiveDays - 1));

    if (candidates.length === 0) {
      jobStore.setResult(jobId, { asOfDate: todayKey, totalProductsScanned, totalCandidates: 0, sources: {}, warnings: [], rows: [] });
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
    for (const { code, name } of candidates) {
      const events = eventMapByCode.get(code) || [];
      const { periods } = analyzeStockoutTimeline({
        currentOnHand: 0, events, todayKey, daysBack, minConsecutiveDays
      });
      const lastPeriod = periods[periods.length - 1];
      if (!lastPeriod || lastPeriod.toDate !== todayKey) continue;
      rows.push({
        code,
        name,
        lastOutOfStockDate: lastPeriod.fromDate,
        daysOutOfStock: lastPeriod.days,
        periods
      });
    }

    jobStore.setResult(jobId, {
      asOfDate: todayKey,
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

module.exports = { runRecentStockoutScanJob };
