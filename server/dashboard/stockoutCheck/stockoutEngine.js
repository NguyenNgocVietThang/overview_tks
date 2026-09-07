'use strict';

const { addDaysToDateKey } = require('./dateHelpers');
const { reconstructDailyStock } = require('./timelineBuilder');
const { findStockoutPeriods, summarizeStockoutPeriods } = require('./stockoutAnalyzer');

const DEFAULT_MIN_CONSECUTIVE_DAYS = 5;

function analyzeStockoutTimeline(options) {
  const {
    currentOnHand,
    events = [],
    todayKey,
    daysBack,
    minConsecutiveDays = DEFAULT_MIN_CONSECUTIVE_DAYS
  } = options;
  const reportFromDate = addDaysToDateKey(todayKey, -daysBack);
  const warmupDays = Math.max(0, minConsecutiveDays - 1);
  const calculationDaysBack = daysBack + warmupDays;
  const calculationFromDate = addDaysToDateKey(todayKey, -calculationDaysBack);
  const dailyStock = reconstructDailyStock(currentOnHand, events, todayKey, calculationDaysBack);
  const periods = findStockoutPeriods(
    dailyStock,
    minConsecutiveDays,
    reportFromDate,
    todayKey
  );

  return {
    reportFromDate,
    calculationFromDate,
    dailyStock,
    periods,
    summary: summarizeStockoutPeriods(periods)
  };
}

module.exports = { DEFAULT_MIN_CONSECUTIVE_DAYS, analyzeStockoutTimeline };
