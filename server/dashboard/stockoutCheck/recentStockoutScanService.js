'use strict';

const {
  accumulateInvoiceEvents,
  accumulatePurchaseOrderEvents,
  accumulateReturnEvents,
  reconstructDailyStock
} = require('./timelineBuilder');
const { findStockoutPeriods } = require('./stockoutAnalyzer');
const { addDaysToDateKey, todayVnDateKey } = require('./dateHelpers');

const DEFAULT_MIN_CONSECUTIVE_DAYS = 5;

function isProductActive(product) {
  const raw = product.isActive !== undefined ? product.isActive : product.IsActive;
  return raw === undefined || raw === null ? true : raw;
}

function productOnHand(product) {
  const inventories = product.inventories || product.Inventories || [];
  return inventories.reduce((sum, inv) => sum + (inv.onHand || inv.onhand || 0), 0);
}

function emptyPageCounter() {
  return { pagesLoaded: 0, recordsLoaded: 0, total: 0 };
}

async function runRecentStockoutScanJob(jobStore, jobId, deps = {}) {
  const {
    client,
    daysBack = 183,
    todayKey = todayVnDateKey(),
    minConsecutiveDays = DEFAULT_MIN_CONSECUTIVE_DAYS
  } = deps;

  try {
    const candidates = [];
    let totalProductsScanned = 0;

    jobStore.updateProgress(jobId, { progress: { phase: 1, phase1: emptyPageCounter(), phase2: null } });

    await client.fetchAllPages('products', { includeInventory: 'true', includeSoftDeletedAttribute: 'false' }, (items, meta) => {
      for (const product of items) {
        if (!isProductActive(product)) continue;
        if (productOnHand(product) !== 0) continue;
        candidates.push({ code: product.code, name: product.name });
      }
      totalProductsScanned = meta.total || totalProductsScanned;
      jobStore.updateProgress(jobId, {
        progress: { phase1: { pagesLoaded: meta.pagesLoaded, recordsLoaded: meta.recordsLoaded, total: meta.total, candidatesFound: candidates.length } }
      });
    });

    if (candidates.length === 0) {
      jobStore.setResult(jobId, { asOfDate: todayKey, totalProductsScanned, totalCandidates: 0, rows: [] });
      return;
    }

    const validCodeSet = new Set(candidates.map((c) => c.code));
    const eventMapByCode = new Map();
    const fromDate = addDaysToDateKey(todayKey, -daysBack);

    const phase2Progress = { invoices: emptyPageCounter(), purchaseOrders: emptyPageCounter(), returns: emptyPageCounter() };
    jobStore.updateProgress(jobId, { progress: { phase: 2, phase2: { ...phase2Progress } } });

    await Promise.all([
      client.fetchAllPages('invoices', { fromPurchaseDate: fromDate, toPurchaseDate: todayKey, status: '1' }, (items, meta) => {
        accumulateInvoiceEvents(eventMapByCode, items, validCodeSet);
        phase2Progress.invoices = meta;
        jobStore.updateProgress(jobId, { progress: { phase2: { ...phase2Progress } } });
      }),
      client.fetchAllPages('purchaseorders', { fromPurchaseDate: fromDate, toPurchaseDate: todayKey }, (items, meta) => {
        accumulatePurchaseOrderEvents(eventMapByCode, items, validCodeSet);
        phase2Progress.purchaseOrders = meta;
        jobStore.updateProgress(jobId, { progress: { phase2: { ...phase2Progress } } });
      }),
      client.fetchAllPages('returns', { lastModifiedFrom: fromDate }, (items, meta) => {
        accumulateReturnEvents(eventMapByCode, items, validCodeSet);
        phase2Progress.returns = meta;
        jobStore.updateProgress(jobId, { progress: { phase2: { ...phase2Progress } } });
      })
    ]);

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
