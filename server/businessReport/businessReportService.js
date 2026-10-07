'use strict';

// Gom so lieu Bao cao kinh doanh tu snapshot cua repository (ham thuan, khong I/O):
// dong Sale / Khach / Ma hang voi chuoi doanh so theo thang, quy doi 30 ngay, tang
// truong, TB 4 thang, co "hoat dong"; KPI dau muc; du lieu panel chi tiet.

const { UNGROUPED_SALE, buildMetrics, monthLabel, addMonths } = require('./businessMonths');

function notFound(message) {
  const e = new Error(message);
  e.statusCode = 404;
  return e;
}

function withMetrics(row, series, snap) {
  const m = buildMetrics(series, snap.currentMonth, snap.day);
  return { ...row, series, ...m, active: m.avg4 > 0 };
}

function header(snap) {
  return {
    notReady: !!snap.notReady, today: snap.today, currentMonth: snap.currentMonth, day: snap.day, months: snap.months,
    monthLabels: snap.months.map(monthLabel), frozenMonths: snap.frozenMonths, computedAt: snap.computedAt
  };
}

function directoryIndex(snap) {
  const map = new Map();
  for (const d of snap.directory) map.set(`${d.branch}:${d.code}`, d);
  return map;
}

function customerRows(snap) {
  const dir = directoryIndex(snap);
  const groups = new Map();
  for (const r of snap.customers) {
    const key = `${r.branch}:${r.customerCode}`;
    let g = groups.get(key);
    if (!g) {
      const d = dir.get(key);
      g = {
        row: {
          key, branch: r.branch, code: r.customerCode,
          name: (d && d.name) || r.customerName || 'Khách lẻ',
          saleName: (r.customerCode && d && d.saleName) || UNGROUPED_SALE,
          priceLevel: (d && d.priceLevel) || ''
        },
        series: {}
      };
      groups.set(key, g);
    }
    g.series[r.month] = (g.series[r.month] || 0) + Number(r.netRevenue || 0);
  }
  return [...groups.values()].map(g => withMetrics(g.row, g.series, snap));
}

function sumKpis(rows, snap) {
  const total = key => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
  const current = total('current');
  const prev = total('prev');
  const normalized = total('normalized');
  return [
    { key: 'current', label: `Doanh số tháng này (đến ${snap.today.slice(8, 10)}/${snap.today.slice(5, 7)})`, value: current, type: 'money' },
    { key: 'normalized', label: 'Quy đổi 30 ngày', value: normalized, type: 'money' },
    { key: 'prev', label: 'Tháng trước', value: prev, type: 'money' },
    { key: 'growth', label: 'Tăng trưởng chung', value: prev > 0 ? normalized / prev * 100 : null, type: 'percent' },
    { key: 'avg4', label: 'TB 4 tháng', value: total('avg4'), type: 'money' }
  ];
}

function sortByAvg4(rows) {
  return rows.sort((a, b) => b.avg4 - a.avg4 || b.current - a.current);
}

function buildCustomerReport(snap) {
  const rows = sortByAvg4(customerRows(snap));
  const kpis = [
    ...sumKpis(rows.filter(r => r.active), snap),
    { key: 'activeCount', label: 'Khách hoạt động', value: rows.filter(r => r.active).length, type: 'number' }
  ];
  return { ...header(snap), kpis, rows };
}

function buildSaleReport(snap) {
  const customers = customerRows(snap);
  const sales = new Map();
  const ensure = name => {
    if (!sales.has(name)) sales.set(name, { saleName: name, series: {}, activeCustomers: 0 });
    return sales.get(name);
  };
  const frozen = new Set(snap.frozenMonths);
  // Thang da chot: doc bang sale (dung lai theo nhom hien tai boi job).
  for (const r of snap.sales) {
    if (frozen.has(r.month)) ensure(r.saleName).series[r.month] = Number(r.netRevenue) || 0;
  }
  // Thang chua chot (gom thang hien tai) + dem khach hoat dong: gom tu dong khach.
  for (const c of customers) {
    const s = ensure(c.saleName);
    if (c.active) s.activeCustomers += 1;
    for (const [month, value] of Object.entries(c.series)) {
      if (!frozen.has(month)) s.series[month] = (s.series[month] || 0) + value;
    }
  }
  const rows = sortByAvg4([...sales.values()].map(s =>
    withMetrics({ key: s.saleName, saleName: s.saleName, activeCustomers: s.activeCustomers }, s.series, snap)));
  const kpis = [
    ...sumKpis(rows, snap),
    { key: 'saleCount', label: 'Số sale', value: rows.filter(r => r.saleName !== UNGROUPED_SALE).length, type: 'number' },
    { key: 'activeCount', label: 'Khách hoạt động', value: rows.reduce((s, r) => s + r.activeCustomers, 0), type: 'number' }
  ];
  return { ...header(snap), kpis, rows };
}

function buildProductReport(snap) {
  const groups = new Map();
  for (const r of snap.products) {
    let g = groups.get(r.productCode);
    if (!g) { g = { row: { key: r.productCode, code: r.productCode, name: r.productName || '' }, series: {} }; groups.set(r.productCode, g); }
    if (r.productName) g.row.name = r.productName;
    g.series[r.month] = (g.series[r.month] || 0) + Number(r.netRevenue || 0);
  }
  const rows = sortByAvg4([...groups.values()].map(g => withMetrics(g.row, g.series, snap)));
  const kpis = [
    ...sumKpis(rows, snap),
    { key: 'activeCount', label: 'Mã hoạt động', value: rows.filter(r => r.active).length, type: 'number' }
  ];
  return { ...header(snap), kpis, rows };
}

function last4Months(snap) {
  return [3, 2, 1, 0].map(i => addMonths(snap.currentMonth, -i));
}

function detailBase(row, snap, title, subtitle) {
  return {
    ...header(snap), title, subtitle,
    summary: [
      { key: 'current', label: 'Tháng này', value: row.current, type: 'money' },
      { key: 'normalized', label: 'Quy đổi 30 ngày', value: row.normalized, type: 'money' },
      { key: 'prev', label: 'Tháng trước', value: row.prev, type: 'money' },
      { key: 'growth', label: 'Tăng trưởng', value: row.growth, type: 'percent' },
      { key: 'avg4', label: 'TB 4 tháng', value: row.avg4, type: 'money' },
      { key: 'total', label: 'Tổng từ T3/26', value: Object.values(row.series).reduce((s, v) => s + v, 0), type: 'money' }
    ],
    chart: snap.months.map(m => ({ month: m, label: monthLabel(m), value: row.series[m] || 0, partial: m === snap.currentMonth }))
  };
}

// extra.topProducts / extra.topCustomers do routes nap qua repository (4 thang gan nhat).
function buildDetail(kind, key, snap, extra = {}) {
  if (kind === 'sale') {
    const report = buildSaleReport(snap);
    const row = report.rows.find(r => r.key === key);
    if (!row) throw notFound('Không tìm thấy sale này.');
    const customers = buildCustomerReport(snap).rows.filter(c => c.saleName === key);
    const base = detailBase(row, snap, key, `${row.activeCustomers} khách hoạt động`);
    base.summary.push({ key: 'activeCustomers', label: 'SL khách hoạt động', value: row.activeCustomers, type: 'number' });
    return { ...base, kind, customers };
  }
  if (kind === 'customer') {
    const row = buildCustomerReport(snap).rows.find(r => r.key === key);
    if (!row) throw notFound('Không tìm thấy khách hàng này.');
    return { ...detailBase(row, snap, row.name, `${row.code || 'Khách lẻ'} · ${row.branch === 'hanoi' ? 'HN' : 'SG'} · Sale ${row.saleName}`),
      kind, customer: row, topProducts: extra.topProducts || [], window: last4Months(snap) };
  }
  if (kind === 'product') {
    const row = buildProductReport(snap).rows.find(r => r.key === key);
    if (!row) throw notFound('Không tìm thấy mã hàng này.');
    return { ...detailBase(row, snap, `${row.code} – ${row.name}`, 'Doanh số theo tháng'),
      kind, product: row, topCustomers: extra.topCustomers || [], window: last4Months(snap) };
  }
  const e = new Error('Loại chi tiết không hợp lệ.');
  e.statusCode = 400;
  throw e;
}

module.exports = { buildSaleReport, buildCustomerReport, buildProductReport, buildDetail, last4Months };
