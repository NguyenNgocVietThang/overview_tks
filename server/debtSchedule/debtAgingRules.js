'use strict';

// Tuoi no theo hoa don (2026-10-17, muc 3 tab Cong no — ham thuan, khong I/O).
//
// So SONG (customers.debt theo lan dong bo KiotViet moi nhat), khong phu thuoc ban chot 15:00.
// Ngay het no: lay no hien tai tru dan tong hoa don Hoan thanh theo ngay, tu hom nay lui ve;
// ngay dau tien lam phan con lai <= 0 la ngay het no. KHONG tru tra hang (da nam trong no).
// Ngay no tuong duong = hom nay - ngay het no; Con han = lich TT - ngay no tuong duong.
// Tru het AGING_LOOKBACK_DAYS ngay ma van con no -> ngay het no = ngay dau cua khoang tra cuu,
// gan co beyondHistory (giao dien hien "≥" / "≤"). No <= 0 -> 3 cot ngay de trong (null).
// No qua han dung dung quy tac cua bang thao tac (inScheduleDebt/overdueDebt) voi moc = hom nay.

const { addDaysToKey } = require('../kiotvietSync/vnTime');
const {
  BRANCH_SHORT, UNGROUPED_SALE, effectiveScheduleDays, parseScheduleDays, inScheduleDebt, overdueDebt, customerKeyOf
} = require('./debtScheduleRules');

const AGING_LOOKBACK_DAYS = 365;

/** Ngay dau tien (YYYY-MM-DD) con trong khoang tra cuu hoa don tinh tu `today`. */
function agingHistoryStart(today) {
  return addDaysToKey(today, -(AGING_LOOKBACK_DAYS - 1));
}

/** So ngay tu `fromDay` toi `toDay` (YYYY-MM-DD). */
function daysBetween(fromDay, toDay) {
  const toUtc = key => {
    const [year, month, day] = key.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(toDay) - toUtc(fromDay)) / 86400000);
}

/**
 * Ngay het no tu no hien tai va hoa don theo ngay ([{ day, invoiceAmount }], thu tu bat ky).
 * @returns {{ payoffDay: string|null, beyondHistory: boolean }}
 */
function findPayoffDay(currentDebt, dailyAmounts, today) {
  let remaining = Number(currentDebt) || 0;
  if (remaining <= 0) return { payoffDay: null, beyondHistory: false };
  const historyStart = agingHistoryStart(today);
  const days = (dailyAmounts || [])
    .filter(item => item.day >= historyStart && item.day <= today && (Number(item.invoiceAmount) || 0) !== 0)
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  for (const item of days) {
    remaining -= Number(item.invoiceAmount) || 0;
    if (remaining <= 0) return { payoffDay: item.day, beyondHistory: false };
  }
  return { payoffDay: historyStart, beyondHistory: true };
}

/**
 * Mot dong bang tuoi no. `row` = { branch, customerId, customerCode, customerName, sale,
 * scheduleDays, currentDebt }; `dailyAmounts` = hoa don Hoan thanh theo ngay cua khach.
 */
function buildAgingRow(row, { dailyAmounts, today }) {
  const scheduleDays = effectiveScheduleDays(row.scheduleDays);
  const currentDebt = Number(row.currentDebt) || 0;
  const overdue = overdueDebt(currentDebt, inScheduleDebt(dailyAmounts, today, scheduleDays));
  const { payoffDay, beyondHistory } = findPayoffDay(currentDebt, dailyAmounts, today);
  const equivalentDays = payoffDay ? daysBetween(payoffDay, today) : null;
  return {
    customerKey: customerKeyOf(row.branch, row.customerId),
    customerId: String(row.customerId),
    branchCode: row.branch,
    branch: BRANCH_SHORT[row.branch] || row.branch,
    customerCode: row.customerCode || '',
    customerName: row.customerName || row.customerCode || `Khách #${row.customerId}`,
    sale: row.sale || UNGROUPED_SALE,
    paymentSchedule: String(scheduleDays),
    scheduleDays,
    hasStoredSchedule: parseScheduleDays(row.scheduleDays) !== null,
    currentDebt,
    overdueDebt: overdue,
    payoffDay,
    beyondHistory,
    equivalentDays,
    remainingDays: equivalentDays === null ? null : scheduleDays - equivalentDays
  };
}

module.exports = { AGING_LOOKBACK_DAYS, agingHistoryStart, daysBetween, findPayoffDay, buildAgingRow };
