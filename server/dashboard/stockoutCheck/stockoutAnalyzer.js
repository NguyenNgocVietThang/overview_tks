'use strict';

function addDaysToDateKey(dateKey, days) {
  const d = new Date(dateKey + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetweenInclusive(fromDate, toDate) {
  const from = new Date(fromDate + 'T00:00:00Z').getTime();
  const to = new Date(toDate + 'T00:00:00Z').getTime();
  return Math.floor((to - from) / 86400000) + 1;
}

function clipPeriod(period, reportFromDate, reportToDate) {
  const fromDate = reportFromDate && period.fromDate < reportFromDate ? reportFromDate : period.fromDate;
  const toDate = reportToDate && period.toDate > reportToDate ? reportToDate : period.toDate;
  if (fromDate > toDate) return null;
  return { fromDate, toDate, days: daysBetweenInclusive(fromDate, toDate) };
}

function findStockoutPeriods(dailyStock, minConsecutiveDays = 5, reportFromDate = null, reportToDate = null) {
  const periods = [];
  let runStart = null;
  let runLength = 0;

  for (let i = 0; i < dailyStock.length; i++) {
    const { date, stock, hadPurchase, unreliable } = dailyStock[i];
    // Ngay co phieu Nhap hang luon tinh la co hang tren ke, du sau do
    // ban/chuyen het trong ngay khien ton cuoi ngay ve 0 — day la ngay CO
    // giao dich, khac voi ngay khong co gi xay ra (ca hai deu ra net 0 neu
    // chi nhin theo ton cuoi ngay).
    // Ngay unreliable (ton kho tho tinh duoc bi am, xem timelineBuilder.js)
    // nghia la thieu du lieu chu khong phai bang chung dut hang — loai khoi
    // dieu kien dut hang giong het hadPurchase, tranh tao dot gia.
    if (Math.max(0, Number(stock) || 0) === 0 && !hadPurchase && !unreliable) {
      if (runStart === null) runStart = date;
      runLength++;
    } else if (runStart !== null) {
      if (runLength >= minConsecutiveDays) {
        const period = { fromDate: runStart, toDate: addDaysToDateKey(runStart, runLength - 1), days: runLength };
        const clipped = clipPeriod(period, reportFromDate, reportToDate);
        if (clipped) periods.push(clipped);
      }
      runStart = null;
      runLength = 0;
    }
  }

  if (runStart !== null && runLength >= minConsecutiveDays) {
    const period = { fromDate: runStart, toDate: addDaysToDateKey(runStart, runLength - 1), days: runLength };
    const clipped = clipPeriod(period, reportFromDate, reportToDate);
    if (clipped) periods.push(clipped);
  }

  return periods;
}

function summarizeStockoutPeriods(periods) {
  return periods.reduce(
    (acc, p) => ({ stockoutCount: acc.stockoutCount + 1, totalStockoutDays: acc.totalStockoutDays + p.days }),
    { stockoutCount: 0, totalStockoutDays: 0 }
  );
}

module.exports = { findStockoutPeriods, summarizeStockoutPeriods, daysBetweenInclusive };
