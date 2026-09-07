'use strict';

const CONFIG = require('../../config');
const { findStockoutPeriods, summarizeStockoutPeriods } = require('./stockoutAnalyzer');
const { accumulateReturnEvents, reconstructDailyStock } = require('./timelineBuilder');
const { addDaysToDateKey, todayVnDateKey } = require('./dateHelpers');
const { loadActiveCandidates, buildEventMapFromSheets } = require('./sheetTimelineBuilder');

const DEFAULT_MIN_CONSECUTIVE_DAYS = 5;
const DEFAULT_DAYS_BACK = 29; // 29 ngay truoc + hom nay = dung 30 ngay

function emptyPageCounter() {
  return { pagesLoaded: 0, recordsLoaded: 0, total: 0 };
}

async function runStockout30dScanJob(jobStore, jobId, deps = {}) {
  const {
    sheetsClient,
    client,
    daysBack = DEFAULT_DAYS_BACK,
    todayKey = todayVnDateKey(),
    minConsecutiveDays = DEFAULT_MIN_CONSECUTIVE_DAYS
  } = deps;

  try {
    jobStore.updateProgress(jobId, { progress: { phase: 1 } });
    const sheets = await sheetsClient.getMultipleSheetValues([
      CONFIG.SHEET_PRODUCTS,
      CONFIG.SHEET_INVOICES,
      CONFIG.SHEET_INVOICE_DETAILS,
      CONFIG.SHEET_PURCHASES,
      CONFIG.SHEET_SUPPLIER_RETURNS
    ]);

    const { candidates, totalProductsScanned } = loadActiveCandidates(sheets[CONFIG.SHEET_PRODUCTS] || []);
    const fromDate = addDaysToDateKey(todayKey, -daysBack);

    if (candidates.length === 0) {
      jobStore.setResult(jobId, { asOfDate: todayKey, fromDate, totalProductsScanned, totalCandidates: 0, rows: [] });
      return;
    }

    const validCodeSet = new Set(candidates.map((c) => c.code));
    const eventMapByCode = buildEventMapFromSheets(sheets, validCodeSet, fromDate, todayKey);

    jobStore.updateProgress(jobId, { progress: { phase: 2, phase2: emptyPageCounter() } });
    await client.fetchAllPages('returns', { lastModifiedFrom: fromDate }, (items, meta) => {
      accumulateReturnEvents(eventMapByCode, items, validCodeSet);
      jobStore.updateProgress(jobId, { progress: { phase2: meta } });
    });

    const rows = [];
    for (const { code, name, currentOnHand } of candidates) {
      const events = eventMapByCode.get(code) || [];
      const daily = reconstructDailyStock(currentOnHand, events, todayKey, daysBack);
      const periods = findStockoutPeriods(daily, minConsecutiveDays);
      if (periods.length === 0) continue;
      const summary = summarizeStockoutPeriods(periods);
      rows.push({
        code,
        name,
        stockoutCount: summary.stockoutCount,
        totalStockoutDays: summary.totalStockoutDays,
        currentOnHand
      });
    }

    jobStore.setResult(jobId, { asOfDate: todayKey, fromDate, totalProductsScanned, totalCandidates: candidates.length, rows });
  } catch (err) {
    jobStore.setError(jobId, { message: err.message, code: err.code || 'UNEXPECTED_ERROR' });
  }
}

module.exports = { runStockout30dScanJob };
