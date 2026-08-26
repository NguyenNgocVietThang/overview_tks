'use strict';

function addDaysToDateKey(dateKey, days) {
  const d = new Date(dateKey + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function findStockoutPeriods(dailyStock, minConsecutiveDays = 7) {
  const periods = [];
  let runStart = null;
  let runLength = 0;

  for (let i = 0; i < dailyStock.length; i++) {
    const { date, stock } = dailyStock[i];
    if (stock <= 0) {
      if (runStart === null) runStart = date;
      runLength++;
    } else if (runStart !== null) {
      if (runLength >= minConsecutiveDays) {
        periods.push({ fromDate: runStart, toDate: addDaysToDateKey(runStart, runLength - 1), days: runLength });
      }
      runStart = null;
      runLength = 0;
    }
  }

  if (runStart !== null && runLength >= minConsecutiveDays) {
    periods.push({ fromDate: runStart, toDate: addDaysToDateKey(runStart, runLength - 1), days: runLength });
  }

  return periods;
}

function summarizeStockoutPeriods(periods) {
  return periods.reduce(
    (acc, p) => ({ stockoutCount: acc.stockoutCount + 1, totalStockoutDays: acc.totalStockoutDays + p.days }),
    { stockoutCount: 0, totalStockoutDays: 0 }
  );
}

module.exports = { findStockoutPeriods, summarizeStockoutPeriods };
