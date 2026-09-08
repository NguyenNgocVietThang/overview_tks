'use strict';

const { addDaysToDateKey } = require('./dateHelpers');
const { reconstructDailyStock } = require('./timelineBuilder');
const { findStockoutPeriods, summarizeStockoutPeriods, daysBetweenInclusive } = require('./stockoutAnalyzer');

const DEFAULT_MIN_CONSECUTIVE_DAYS = 5;

// Moc ngay som nhat toan bo tinh nang Dut hang duoc phep xet, bat ke daysBack
// yeu cau bao xa. Sheet Tra NCC khong co API va duoc nhap tay, nen khong dam
// bao du lieu tin cay truoc moc nay — de mac dinh (khong truyen
// dataFromDateFloor) se tu dong lam tron nguoc thanh gia tri fake-zero keo
// dai sai. Se tu het tac dung khi hom nay - daysBack da muon hon moc nay.
const STOCKOUT_DATA_FLOOR_DATE_KEY = '2026-06-01';

// Tra ve { reportFromDate, calculationFromDate } sau khi da ap dung dem 4 ngay
// (minConsecutiveDays - 1) va moc san (dataFromDateFloor, neu co). Dung chung
// giua noi tai analyzeStockoutTimeline va noi goi ben ngoai (vd de gioi han
// cua so truy van loadStockoutEvents cho dong bo voi phan tich).
function computeStockoutWindow({ todayKey, daysBack, minConsecutiveDays = DEFAULT_MIN_CONSECUTIVE_DAYS, dataFromDateFloor = null }) {
  let reportFromDate = addDaysToDateKey(todayKey, -daysBack);
  if (dataFromDateFloor && reportFromDate < dataFromDateFloor) reportFromDate = dataFromDateFloor;
  const warmupDays = Math.max(0, minConsecutiveDays - 1);
  let calculationFromDate = addDaysToDateKey(reportFromDate, -warmupDays);
  if (dataFromDateFloor && calculationFromDate < dataFromDateFloor) calculationFromDate = dataFromDateFloor;
  return { reportFromDate, calculationFromDate };
}

// dateKey lon hon giua 2 moc, coi null/rong la "khong gioi han" (thua ben
// con lai). Dung de ghim rieng tung ma theo ngay tao (createdDateKey) ben
// canh moc san chung ca he thong (dataFromDateFloor).
function maxDateKey(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a > b ? a : b;
}

// Neu ngay co giao dich gan nhat cua 1 ma la ngay NET DUONG (vd Nhap hang
// chua bi giao dich nao khac cung ngay tieu het), currentOnHand=0 lay tu
// Sheet Hang hoa gan nhu chac chan da loi thoi (thuc te phai > 0) — Sheet
// san pham khong co vong doi soat dinh ky nhu Tra hang/Nha cung cap/Nhap
// hang nen 1 webhook that lac co the khien "Ton kho" ket qua sai vinh vien.
function hasUnreliableZeroOnHand(events) {
  if (!Array.isArray(events) || events.length === 0) return false;
  let maxDate = null;
  for (const e of events) {
    if (maxDate === null || e.dateKey > maxDate) maxDate = e.dateKey;
  }
  let netOnMaxDate = 0;
  let hasPurchaseOnMaxDate = false;
  for (const e of events) {
    if (e.dateKey !== maxDate) continue;
    netOnMaxDate += e.delta;
    if (e.source === 'purchases') hasPurchaseOnMaxDate = true;
  }
  return hasPurchaseOnMaxDate && netOnMaxDate > 0;
}

function analyzeStockoutTimeline(options) {
  const {
    currentOnHand,
    events = [],
    todayKey,
    daysBack,
    minConsecutiveDays = DEFAULT_MIN_CONSECUTIVE_DAYS,
    dataFromDateFloor = null
  } = options;
  const { reportFromDate, calculationFromDate } = computeStockoutWindow({
    todayKey, daysBack, minConsecutiveDays, dataFromDateFloor
  });
  const calculationDaysBack = daysBetweenInclusive(calculationFromDate, todayKey) - 1;
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

module.exports = {
  DEFAULT_MIN_CONSECUTIVE_DAYS,
  STOCKOUT_DATA_FLOOR_DATE_KEY,
  computeStockoutWindow,
  maxDateKey,
  hasUnreliableZeroOnHand,
  analyzeStockoutTimeline
};
