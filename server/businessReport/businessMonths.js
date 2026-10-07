'use strict';

// Ham thuan cua Bao cao kinh doanh: khoa thang (ngay 1, lich VN), quy doi thang dang
// chay ve 30 ngay, tang truong, TB 4 thang. Spec: docs/superpowers/specs/2026-10-07-business-report-design.md.

const { vnDateKey } = require('../kiotvietSync/vnTime');

const FIRST_MONTH = '2026-03-01';
const UNGROUPED_SALE = 'Chưa phân nhóm';

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
  FIRST_MONTH, UNGROUPED_SALE, monthKey, addMonths, monthsBetween, monthLabel,
  vnToday, dayOfMonth, normalizeTo30Days, growthPct, avg4Months, buildMetrics
};
