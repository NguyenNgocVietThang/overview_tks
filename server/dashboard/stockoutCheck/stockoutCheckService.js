'use strict';

const CONFIG = require('../../config');
const { validateCodes, loadProductCatalogMap: defaultLoadProductCatalogMap } = require('./productCodeValidator');
const { accumulateReturnEvents, reconstructDailyStock } = require('./timelineBuilder');
const { findStockoutPeriods, summarizeStockoutPeriods } = require('./stockoutAnalyzer');
const { buildEventMapFromSheets } = require('./sheetTimelineBuilder');
const { addDaysToDateKey, todayVnDateKey } = require('./dateHelpers');

const MIN_STOCKOUT_DAYS = 7;
const DEFAULT_DAYS_BACK = 183;

function emptyPageCounter() {
  return { pagesLoaded: 0, recordsLoaded: 0, total: 0 };
}

async function runStockoutCheckJob(jobStore, jobId, rawCodes, deps = {}) {
  const {
    loadProductCatalogMap = defaultLoadProductCatalogMap,
    sheetsClient,
    client,
    branch,
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
    const validCodeSet = new Set(validCodes.map((v) => v.code));

    jobStore.updateProgress(jobId, { progress: { phase: 1 } });
    const sheets = await sheetsClient.getMultipleSheetValues([
      CONFIG.SHEET_INVOICES,
      CONFIG.SHEET_INVOICE_DETAILS,
      CONFIG.SHEET_PURCHASES,
      CONFIG.SHEET_SUPPLIER_RETURNS
    ]);
    const eventMapByCode = buildEventMapFromSheets(sheets, validCodeSet, fromDate, todayKey);

    // Khach tra hang (Tra hang): sheet nay khong co chi tiet theo tung ma
    // hang, nen van lay qua API KiotViet — nguon du lieu thu 4.
    jobStore.updateProgress(jobId, { progress: { phase: 2, phase2: emptyPageCounter() } });
    await client.fetchAllPages('returns', { lastModifiedFrom: fromDate }, (items, meta) => {
      accumulateReturnEvents(eventMapByCode, items, validCodeSet);
      jobStore.updateProgress(jobId, { progress: { phase2: meta } });
    });

    const rows = validCodes.map(({ code, name, currentOnHand }) => {
      const events = eventMapByCode.get(code) || [];
      const daily = reconstructDailyStock(currentOnHand, events, todayKey, daysBack);
      const periods = findStockoutPeriods(daily, MIN_STOCKOUT_DAYS);
      const summary = summarizeStockoutPeriods(periods);
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
      rows
    });
  } catch (err) {
    jobStore.setError(jobId, { message: err.message, code: err.code || 'UNEXPECTED_ERROR' });
  }
}

module.exports = { runStockoutCheckJob };
