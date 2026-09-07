'use strict';

const CONFIG = require('../../config');
const { findStockoutPeriods } = require('./stockoutAnalyzer');
const { accumulateReturnEvents, reconstructDailyStock } = require('./timelineBuilder');
const { addDaysToDateKey, todayVnDateKey } = require('./dateHelpers');
const { loadActiveCandidates, buildEventMapFromSheets } = require('./sheetTimelineBuilder');

const DEFAULT_MIN_CONSECUTIVE_DAYS = 5;
const DEFAULT_DAYS_BACK = 183;

function emptyPageCounter() {
  return { pagesLoaded: 0, recordsLoaded: 0, total: 0 };
}

async function runRecentStockoutScanJob(jobStore, jobId, deps = {}) {
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

    const { candidates: allActive, totalProductsScanned } = loadActiveCandidates(sheets[CONFIG.SHEET_PRODUCTS] || []);
    // Giu nguyen ngu nghia cu cua "Hang dut gan day": chi bao cao ma DANG het
    // hang (ton kho hien tai = 0) va van con dut den hom nay.
    const candidates = allActive.filter((c) => c.currentOnHand === 0);
    const fromDate = addDaysToDateKey(todayKey, -daysBack);

    if (candidates.length === 0) {
      jobStore.setResult(jobId, { asOfDate: todayKey, totalProductsScanned, totalCandidates: 0, rows: [] });
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
    for (const { code, name } of candidates) {
      const events = eventMapByCode.get(code) || [];
      const daily = reconstructDailyStock(0, events, todayKey, daysBack);
      const periods = findStockoutPeriods(daily, minConsecutiveDays);
      const lastPeriod = periods[periods.length - 1];
      if (!lastPeriod || lastPeriod.toDate !== todayKey) continue;
      rows.push({ code, name, lastOutOfStockDate: lastPeriod.fromDate, daysOutOfStock: lastPeriod.days });
    }

    jobStore.setResult(jobId, { asOfDate: todayKey, totalProductsScanned, totalCandidates: candidates.length, rows });
  } catch (err) {
    jobStore.setError(jobId, { message: err.message, code: err.code || 'UNEXPECTED_ERROR' });
  }
}

module.exports = { runRecentStockoutScanJob };
