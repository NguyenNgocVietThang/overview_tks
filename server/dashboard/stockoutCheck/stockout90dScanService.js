'use strict';

const CONFIG = require('../../config');
const {
  analyzeStockoutTimeline,
  computeStockoutWindow,
  maxDateKey,
  hasUnreliableZeroOnHand,
  STOCKOUT_DATA_FLOOR_DATE_KEY
} = require('./stockoutEngine');
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
    dataFromDateFloor = STOCKOUT_DATA_FLOOR_DATE_KEY,
    branch = null
  } = deps;

  try {
    jobStore.updateProgress(jobId, { progress: { phase: 1 } });
    const sheets = await sheetsClient.getMultipleSheetValues([CONFIG.SHEET_PRODUCTS]);

    const { candidates, totalProductsScanned } = loadActiveCandidates(sheets[CONFIG.SHEET_PRODUCTS] || []);
    const { reportFromDate: fromDate, calculationFromDate } = computeStockoutWindow({
      todayKey, daysBack, minConsecutiveDays, dataFromDateFloor
    });

    if (candidates.length === 0) {
      jobStore.setResult(jobId, { asOfDate: todayKey, fromDate, branch, totalProductsScanned, totalCandidates: 0, sources: {}, warnings: [], rows: [] });
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
    for (const { code, name, currentOnHand, createdDateKey } of candidates) {
      const events = eventMapByCode.get(code) || [];
      // Khong co bat ky giao dich nao (ban/nhap/tra) trong ca ky nghia la
      // khong co bang chung thuc te ma nay tung "dut hang" — chi la ton kho
      // dung im o 0, khong ai dong tram. Bo qua de tranh hang loat ma trung
      // het ngay bat dau (dung diem san dataFromDateFloor) chi vi thieu du
      // lieu, khong phai vi thuc su dut hang.
      if (events.length === 0) continue;
      // Ton kho hien tai = 0 nhung giao dich gan nhat la Nhap hang chua bi
      // tieu thu — Sheet Hang hoa (khong co vong doi soat dinh ky) gan nhu
      // chac chan da loi thoi. Bo qua thay vi bao dut hang sai tren du lieu
      // khong dang tin.
      if (currentOnHand === 0 && hasUnreliableZeroOnHand(events)) continue;
      const { periods, summary } = analyzeStockoutTimeline({
        currentOnHand, events, todayKey, daysBack, minConsecutiveDays,
        // Mot ma moi tao (createdDateKey) khong the dut hang truoc khi no
        // ton tai trong he thong — ghim moc san rieng cho ma nay.
        dataFromDateFloor: maxDateKey(dataFromDateFloor, createdDateKey)
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
      branch,
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
