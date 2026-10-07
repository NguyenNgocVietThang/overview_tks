'use strict';

// Ham thuan cua Bao cao kinh doanh: khoa thang (ngay 1, lich VN), quy doi thang dang
// chay ve 30 ngay, tang truong, TB 4 thang. Spec: docs/superpowers/specs/2026-10-07-business-report-design.md.

const { vnDateKey } = require('../kiotvietSync/vnTime');

const FIRST_MONTH = '2026-03-01';
const UNGROUPED_SALE = 'Chưa phân nhóm';
const NO_TEAM = 'Chưa có team';
const RETAIL_NAME = 'Khách lẻ';

// Khoa so khop ten (khach, sale): NFKC, gop khoang trang, chu thuong.
function nameKey(value) {
  return String(value == null ? '' : value).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function monthKey(dateKey) {
  return String(dateKey).slice(0, 7) + '-01';
}

function addMonths(month, n) {
  const [y, mo] = month.split('-').map(Number);
  const index = y * 12 + (mo - 1) + n;
  const year = Math.floor(index / 12);
  const mon = (index % 12) + 1;
  return `${year}-${String(mon).padStart(2, '0')}-01`;
}

function monthsBetween(fromMonth, toMonth) {
  const out = [];
  for (let m = fromMonth; m <= toMonth; m = addMonths(m, 1)) out.push(m);
  return out;
}

function monthLabel(month) {
  const [y, mo] = month.split('-');
  return `T${Number(mo)}/${y.slice(2)}`;
}

function vnToday(now = new Date()) {
  return vnDateKey(now);
}

function badMonth(message) {
  const e = new Error(message);
  e.statusCode = 400;
  return e;
}

// Thang duoc phep chot lai (nut "Tinh lai thang" va chay tay job): 'YYYY-MM', tu FIRST_MONTH,
// da ket thuc theo lich VN. Tra 'YYYY-MM-01'; sai thi nem Error statusCode 400. Chot thang
// dang chay se ghi state => job ngay mung 1 coi thang do da chot => chot thieu du lieu.
function parseClosedMonth(monthParam, now = new Date()) {
  if (typeof monthParam !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)) {
    throw badMonth('Tháng không hợp lệ (định dạng YYYY-MM).');
  }
  const month = `${monthParam}-01`;
  if (month < FIRST_MONTH || month >= monthKey(vnToday(now))) {
    throw badMonth('Chỉ tính lại được tháng đã qua, từ T3/2026.');
  }
  return month;
}

function dayOfMonth(dateKey) {
  return Number(String(dateKey).slice(8, 10));
}

// Thang dang chay: doanh so x 30 / so ngay da qua (gom ca hom nay).
function normalizeTo30Days(amount, day) {
  return (Number(amount) || 0) * 30 / Math.max(1, day);
}

function growthPct(normalized, prev) {
  const p = Number(prev) || 0;
  if (p <= 0) return null;
  return (Number(normalized) || 0) / p * 100;
}

function avg4Months(prev3, normalized) {
  const values = [0, 1, 2].map(i => Number(prev3[i]) || 0);
  return (values[0] + values[1] + values[2] + (Number(normalized) || 0)) / 4;
}

function buildMetrics(series, currentMonth, day) {
  const current = Number(series[currentMonth]) || 0;
  const normalized = normalizeTo30Days(current, day);
  const prev3 = [1, 2, 3].map(i => Number(series[addMonths(currentMonth, -i)]) || 0);
  return { current, normalized, prev: prev3[0], growth: growthPct(normalized, prev3[0]), avg4: avg4Months(prev3, normalized) };
}

module.exports = {
  FIRST_MONTH, UNGROUPED_SALE, NO_TEAM, RETAIL_NAME, nameKey, monthKey, addMonths, monthsBetween, monthLabel,
  vnToday, parseClosedMonth, dayOfMonth, normalizeTo30Days, growthPct, avg4Months, buildMetrics
};
