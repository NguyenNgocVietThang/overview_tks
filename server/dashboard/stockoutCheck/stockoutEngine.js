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

// Neu ngay co giao dich gan nhat cua 1 ma CHI CO Nhap hang, tuyet doi khong
// co giao dich nao khac, currentOnHand=0 lay tu KiotViet /products gan nhu
// chac chan chua kip cap nhat (do lech thoi gian giua luc phieu Nhap hang
// hoan tat va luc API san pham phan anh ton kho moi — xem thuc te OTD10N,
// tren 24h van chua cap nhat). Chi xet "hoan toan khong co giao dich nao
// khac" (khong xet net theo so luong) vi so luong Tra NCC nhap tay co the sai
// lech (typo/dinh dang) ma van la 1 no luc that su can doi — khong nen coi la
// du lieu loi thoi.
function hasUnreliableZeroOnHand(events) {
  if (!Array.isArray(events) || events.length === 0) return false;
  let maxDate = null;
  for (const e of events) {
    if (maxDate === null || e.dateKey > maxDate) maxDate = e.dateKey;
  }
  const eventsOnMaxDate = events.filter((e) => e.dateKey === maxDate);
  const hasPurchase = eventsOnMaxDate.some((e) => e.source === 'purchases');
  const hasOtherSource = eventsOnMaxDate.some((e) => e.source !== 'purchases');
  return hasPurchase && !hasOtherSource;
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
  // Co it nhat 1 ngay trong ky bao cao bi loai vi thieu du lieu (xem
  // timelineBuilder.js) — bao hieu cho tang tren de canh bao nguoi dung, du
  // cac dot con lai van hop le.
  const hasUnreliableData = dailyStock.some(
    (d) => d.unreliable && d.date >= reportFromDate && d.date <= todayKey
  );

  return {
    reportFromDate,
    calculationFromDate,
    dailyStock,
    periods,
    summary: summarizeStockoutPeriods(periods),
    hasUnreliableData
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
