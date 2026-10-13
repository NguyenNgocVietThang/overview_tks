'use strict';

// Quy tac cong no theo LICH THANH TOAN (ham thuan, khong I/O). Xem migration 0047.
//
// Lich TT = N ngay (so nguyen 1..90; khach chua co lich = 1). Tai ban chot 15:00 ngay D
// (gio VN), no trong lich = tong hoa don - tong tra hang cua cac NGAY D-N+1 .. D (tinh ca
// hom nay toi 15:00); tien khach da tra KHONG tinh vao. No qua han = max(0, no hien tai -
// no trong lich). Vd luc 15:00 thu 6 8/8: lich 1 -> don 8/8 hop le; lich 3 -> 6, 7, 8/8;
// lich 7 -> 2..8/8.

const { addDaysToKey } = require('../kiotvietSync/vnTime');

const DEFAULT_SCHEDULE_DAYS = 1;
const MAX_SCHEDULE_DAYS = 90;
const SNAPSHOT_MINUTE_OF_DAY = 15 * 60;
const WORKFLOW_STATUSES = Object.freeze(['Chưa xử lý', 'Đang xử lý', 'Đã xử lý', 'Bỏ qua']);
const TERMINAL_WORKFLOW_STATUSES = new Set(['Đã xử lý', 'Bỏ qua']);
const BRANCH_SHORT = Object.freeze({ hanoi: 'HN', saigon: 'SG' });
const UNGROUPED_SALE = 'Chưa phân nhóm';

/** So ngay lich TT hop le (1..90) tu gia tri nhap, hoac null neu khong hop le. */
function parseScheduleDays(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return null;
  const days = Number(text);
  return days >= 1 && days <= MAX_SCHEDULE_DAYS ? days : null;
}

/** Lich TT dung de tinh: gia tri da luu, hoac 1 ngay khi khach chua co lich. */
function effectiveScheduleDays(stored) {
  return parseScheduleDays(stored) || DEFAULT_SCHEDULE_DAYS;
}

/** Ngay dau tien (YYYY-MM-DD) con nam trong lich N ngay cua ban chot ngay cycleDate. */
function scheduleWindowStart(cycleDate, scheduleDays) {
  return addDaysToKey(cycleDate, -(effectiveScheduleDays(scheduleDays) - 1));
}

/** No trong lich: tong (hoa don - tra hang) cac ngay trong lich, khong am. */
function inScheduleDebt(dailyAmounts, cycleDate, scheduleDays) {
  const start = scheduleWindowStart(cycleDate, scheduleDays);
  let total = 0;
  for (const item of dailyAmounts || []) {
    if (item.day >= start && item.day <= cycleDate) {
      total += (Number(item.invoiceAmount) || 0) - (Number(item.returnAmount) || 0);
    }
  }
  return Math.max(0, total);
}

function overdueDebt(currentDebt, inSchedule) {
  return Math.max(0, (Number(currentDebt) || 0) - (Number(inSchedule) || 0));
}

function ratio(value, base) {
  const denominator = Number(base);
  return Number.isFinite(denominator) && denominator > 0 ? (Number(value) || 0) / denominator : null;
}

function customerKeyOf(branch, customerId) {
  return `${branch}:${customerId}`;
}

/**
 * Mot dong cong no cho man hinh tu du lieu da doc. `row` gom so lieu ban chot
 * (currentDebt, openingDebt, avgRevenue4m), thong tin khach doc truc tiep (code, name,
 * sale, scheduleDays) va phan hoi cua chu ky (feedback). `access` = quyen nguoi xem.
 */
function buildCustomerRow(row, { cycleDate, dailyAmounts, access = {} }) {
  const scheduleDays = effectiveScheduleDays(row.scheduleDays);
  const currentDebt = Number(row.currentDebt) || 0;
  const inSchedule = inScheduleDebt(dailyAmounts, cycleDate, scheduleDays);
  const overdue = overdueDebt(currentDebt, inSchedule);
  const averageSales = row.avgRevenue4m === null || row.avgRevenue4m === undefined ? null : Number(row.avgRevenue4m);
  const feedback = row.feedback || {};
  const workflowStatus = WORKFLOW_STATUSES.includes(feedback.status) ? feedback.status : 'Chưa xử lý';
  const alertCodes = overdue > 0 ? ['overdue'] : [];
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
    openingDebt: row.openingDebt === null || row.openingDebt === undefined ? null : Number(row.openingDebt),
    currentDebt,
    inScheduleDebt: inSchedule,
    overdueDebt: overdue,
    averageSales,
    currentDebtToSalesRatio: ratio(currentDebt, averageSales),
    overdueToSalesRatio: ratio(overdue, averageSales),
    alertCodes,
    dataIssues: [],
    saleFeedback: feedback.saleFeedback || '',
    saleFeedbackBy: feedback.saleFeedbackBy || '',
    managerFeedback: feedback.managerFeedback || '',
    managerFeedbackBy: feedback.managerFeedbackBy || '',
    workflowStatus,
    updatedBy: feedback.statusBy || '',
    updatedAt: feedback.statusAt || null,
    needsAction: alertCodes.length > 0 && !TERMINAL_WORKFLOW_STATUSES.has(workflowStatus),
    canEditStatus: Boolean(access.status),
    canEditSaleFeedback: Boolean(access.saleFeedback),
    canEditManagerFeedback: Boolean(access.managerFeedback),
    canEditSchedule: Boolean(access.schedule)
  };
}

function emptySummary(customers) {
  return {
    totalCurrentDebt: 0, totalOverdueDebt: 0, actionCustomerCount: 0, customerCount: customers
  };
}

function summarize(customers, field) {
  const map = new Map();
  for (const customer of customers) {
    const value = customer[field];
    if (!map.has(value)) map.set(value, { [field]: value, ...emptySummary(0) });
    const summary = map.get(value);
    summary.totalCurrentDebt += customer.currentDebt;
    summary.totalOverdueDebt += customer.overdueDebt;
    summary.customerCount += 1;
    if (customer.needsAction) summary.actionCustomerCount += 1;
  }
  return Array.from(map.values());
}

function toTopItem(customer) {
  return {
    customerKey: customer.customerKey,
    customerName: customer.customerName,
    sale: customer.sale,
    paymentSchedule: customer.paymentSchedule,
    currentDebt: customer.currentDebt,
    overdueDebt: customer.overdueDebt,
    needsAction: customer.needsAction
  };
}

/**
 * Payload `debtManagement` cua /api/dashboard (giu shape cu de bieu do/KPI/xuat file
 * khong doi): kpi, bySale, byPaymentSchedule, top 10, customers + thong tin chu ky.
 */
function buildDebtReport({ cycle, customers, access = {}, dataWarnings = [] }) {
  const rows = cycle ? customers : [];
  const totalCurrentDebt = rows.reduce((sum, item) => sum + item.currentDebt, 0);
  const totalOverdueDebt = rows.reduce((sum, item) => sum + item.overdueDebt, 0);
  const totalAverageSales = rows.reduce((sum, item) => sum + (item.averageSales > 0 ? item.averageSales : 0), 0);
  const warnings = [...dataWarnings];
  if (!cycle) warnings.push('Chưa có bản chốt công nợ 15:00 nào. Số liệu sẽ có sau lần chốt đầu tiên.');
  const bySchedule = summarize(rows, 'scheduleDays')
    .sort((a, b) => a.scheduleDays - b.scheduleDays)
    .map(({ scheduleDays, ...summary }) => ({ paymentSchedule: String(scheduleDays), ...summary }));
  return {
    available: Boolean(cycle),
    sourceSheet: cycle ? `Chốt lúc 15:00 ${cycle.cycleDate.slice(8, 10)}/${cycle.cycleDate.slice(5, 7)}` : '',
    cycleDate: cycle ? cycle.cycleDate : null,
    takenAt: cycle ? cycle.takenAt : null,
    access: {
      status: Boolean(access.status),
      saleFeedback: Boolean(access.saleFeedback),
      managerFeedback: Boolean(access.managerFeedback),
      schedule: Boolean(access.schedule)
    },
    dataWarnings: warnings,
    kpi: {
      totalCurrentDebt,
      totalOverdueDebt,
      actionCustomerCount: rows.filter(item => item.needsAction).length,
      overdueToSalesRatio: totalAverageSales > 0 ? totalOverdueDebt / totalAverageSales : 0
    },
    bySale: summarize(rows, 'sale')
      .sort((a, b) => b.totalOverdueDebt - a.totalOverdueDebt || b.totalCurrentDebt - a.totalCurrentDebt || String(a.sale).localeCompare(String(b.sale), 'vi'))
      .slice(0, 15),
    byPaymentSchedule: bySchedule,
    topCurrentDebt: rows.filter(item => item.currentDebt > 0)
      .sort((a, b) => b.currentDebt - a.currentDebt).slice(0, 10).map(toTopItem),
    topOverdueDebt: rows.filter(item => item.overdueDebt > 0)
      .sort((a, b) => b.overdueDebt - a.overdueDebt).slice(0, 10).map(toTopItem),
    customers: rows
  };
}

module.exports = {
  DEFAULT_SCHEDULE_DAYS,
  MAX_SCHEDULE_DAYS,
  SNAPSHOT_MINUTE_OF_DAY,
  WORKFLOW_STATUSES,
  BRANCH_SHORT,
  UNGROUPED_SALE,
  parseScheduleDays,
  effectiveScheduleDays,
  scheduleWindowStart,
  inScheduleDebt,
  overdueDebt,
  customerKeyOf,
  buildCustomerRow,
  buildDebtReport
};
