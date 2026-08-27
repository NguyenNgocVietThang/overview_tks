'use strict';

const { validateCodes, loadProductCatalogMap: defaultLoadProductCatalogMap } = require('./productCodeValidator');
const {
  accumulateInvoiceEvents,
  accumulatePurchaseOrderEvents,
  accumulateReturnEvents,
  reconstructDailyStock
} = require('./timelineBuilder');
const { findStockoutPeriods, summarizeStockoutPeriods } = require('./stockoutAnalyzer');
const { runWithConcurrencyLimit } = require('./concurrencyPool');

const MIN_STOCKOUT_DAYS = 7;

function addDaysToDateKey(dateKey, days) {
  const d = new Date(dateKey + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayVnDateKey() {
  const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return vnNow.toISOString().slice(0, 10);
}

function emptyPageCounter() {
  return { pagesLoaded: 0, recordsLoaded: 0, total: 0 };
}

async function runStockoutCheckJob(jobStore, jobId, rawCodes, deps = {}) {
  const {
    loadProductCatalogMap = defaultLoadProductCatalogMap,
    client,
    branch,
    concurrency = 4,
    daysBack = 183,
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

    const validCodeSet = new Set(validCodes.map((v) => v.code));
    const eventMapByCode = new Map();
    const fromDate = addDaysToDateKey(todayKey, -daysBack);

    const phase1Progress = {
      invoices: emptyPageCounter(),
      purchaseOrders: emptyPageCounter(),
      returns: emptyPageCounter()
    };
    jobStore.updateProgress(jobId, { progress: { phase: 1, phase1: { ...phase1Progress }, phase2: null } });

    await Promise.all([
      client.fetchAllPages('invoices', { fromPurchaseDate: fromDate, toPurchaseDate: todayKey, status: '1' }, (items, meta) => {
        accumulateInvoiceEvents(eventMapByCode, items, validCodeSet);
        phase1Progress.invoices = meta;
        jobStore.updateProgress(jobId, { progress: { phase1: { ...phase1Progress } } });
      }),
      client.fetchAllPages('purchaseorders', { fromPurchaseDate: fromDate, toPurchaseDate: todayKey }, (items, meta) => {
        accumulatePurchaseOrderEvents(eventMapByCode, items, validCodeSet);
        phase1Progress.purchaseOrders = meta;
        jobStore.updateProgress(jobId, { progress: { phase1: { ...phase1Progress } } });
      }),
      client.fetchAllPages('returns', { lastModifiedFrom: fromDate }, (items, meta) => {
        accumulateReturnEvents(eventMapByCode, items, validCodeSet);
        phase1Progress.returns = meta;
        jobStore.updateProgress(jobId, { progress: { phase1: { ...phase1Progress } } });
      })
    ]);

    jobStore.updateProgress(jobId, { progress: { phase: 2, phase2: { processed: 0, total: validCodes.length } } });

    let processed = 0;
    const rows = await runWithConcurrencyLimit(validCodes, concurrency, async ({ code, name }) => {
      const onHandResult = await client.fetchProductOnHand(code);
      const events = eventMapByCode.get(code) || [];
      const daily = reconstructDailyStock(onHandResult.onHand, events, todayKey, daysBack);
      const periods = findStockoutPeriods(daily, MIN_STOCKOUT_DAYS);
      const summary = summarizeStockoutPeriods(periods);

      processed++;
      jobStore.updateProgress(jobId, { progress: { phase2: { processed, total: validCodes.length } } });

      return {
        code,
        name,
        currentOnHand: onHandResult.onHand,
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
