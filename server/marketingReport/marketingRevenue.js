'use strict';

// Doanh so tung khach trong thang (ban - tra hang) lay tu KiotViet qua bao cao kinh doanh
// (bang business_monthly_customer_sales; thang hien tai tinh live). Noi voi dong BC thang
// theo TEN khach (cot "ID khach tren Kiot" la ten, ma khach HN va SG khong trung nhau),
// gop HN + SG khi cung ten.

const { nameKey } = require('../businessReport/businessMonths');

// Tab BC thang chi co so thang: thang lon hon thang hien tai (VN) thuoc nam truoc.
function resolveMonthKey(month, nowMs) {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Saigon', year: 'numeric', month: '2-digit' })
    .format(new Date(nowMs)).split('-').map(Number);
  const year = month > m ? y - 1 : y;
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function createRevenueProvider({ repository, now = Date.now } = {}) {
  repository ||= require('../businessReport/businessReportRepository').createRepository();
  // Tra ve { available, revenueOf(name) -> number|null }.
  return async function revenue(month) {
    const key = resolveMonthKey(month, now());
    const snap = await repository.snapshot();
    if (!snap.months.includes(key)) return { available: false, month: key, revenueOf: () => null };
    const totals = new Map();
    for (const r of snap.customers) {
      if (r.month !== key) continue;
      const k = nameKey(r.customerName);
      if (k) totals.set(k, (totals.get(k) || 0) + r.netRevenue);
    }
    const known = new Set(snap.directory.map(r => nameKey(r.name)).filter(Boolean));
    return {
      available: true, month: key,
      // Khach co trong KiotViet nhung khong phat sinh trong thang = 0; ten khong co = null.
      revenueOf(name) {
        const k = nameKey(name);
        if (!k) return null;
        if (totals.has(k)) return totals.get(k);
        return known.has(k) ? 0 : null;
      }
    };
  };
}

module.exports = { createRevenueProvider, resolveMonthKey };
