// ==========================================
// DASHBOARD DATA — cung cap du lieu cho Web App (GET /api/dashboard)
// ==========================================
const CONFIG = require('../config');
const sheetsClient = require('../sheets/sheetsClient');

function formatDMY(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function formatDMYHMS(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${formatDMY(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Ham chinh lay du lieu cho dashboard.
 * @param {number} days - So ngay gan nhat de ve bieu do doanh thu (7/30/90). Mac dinh 30.
 * @returns {Object} Du lieu KPI, bieu do, bang xep hang cho dashboard
 */
async function getDashboardData(days) {
  days = Number(days) || 30;
  const todayStr = formatDMY(new Date());

  // ---------- HÀNG HÓA ----------
  const prodData = await sheetsClient.getValues(CONFIG.SHEET_PRODUCTS);
  let totalProducts = 0, totalStock = 0, lowStock = [];
  let stockList = [];
  const LOW_STOCK_THRESHOLD = 5;

  for (let r = 1; r < prodData.length; r++) {
    const row = prodData[r];
    const code = row[0];
    if (!code) continue;
    totalProducts++;
    const ton = Number(row[3]) || 0;
    totalStock += ton;
    stockList.push({ code, name: row[1], stock: ton, reserved: Number(row[4]) || 0 });
    if (ton <= LOW_STOCK_THRESHOLD) {
      lowStock.push({ code, name: row[1], stock: ton, reserved: Number(row[4]) || 0 });
    }
  }
  lowStock.sort((a, b) => a.stock - b.stock);
  lowStock = lowStock.slice(0, 8);

  stockList.sort((a, b) => b.stock - a.stock);
  const topStock = stockList.slice(0, 6);
  const restStock = stockList.slice(6).reduce((s, p) => s + p.stock, 0);
  const stockDistribution = topStock.map(p => ({ label: p.name, value: p.stock }));
  if (restStock > 0) stockDistribution.push({ label: 'Khác', value: restStock });

  // ---------- HÓA ĐƠN ----------
  const invData = await sheetsClient.getValues(CONFIG.SHEET_INVOICES);
  let revenueToday = 0, invoicesToday = 0, cancelledToday = 0;
  let recentInvoices = [];

  const dayBuckets = {};
  const dayOrder = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = formatDMY(d);
    dayBuckets[key] = { revenue: 0, count: 0 };
    dayOrder.push(key);
  }

  for (let r = 1; r < invData.length; r++) {
    const row = invData[r];
    const code = row[0];
    if (!code) continue;
    const customer = row[1];
    const total = Number(row[2]) || 0;
    const status = row[5];
    const dateStr = String(row[6] || '');
    const dateKey = dateStr.split(' ')[0];
    const isCancelled = status === 'Đã hủy';

    if (dateKey === todayStr) {
      if (isCancelled) cancelledToday++;
      else { revenueToday += total; invoicesToday++; }
    }

    if (!isCancelled && Object.prototype.hasOwnProperty.call(dayBuckets, dateKey)) {
      dayBuckets[dateKey].revenue += total;
      dayBuckets[dateKey].count += 1;
    }

    recentInvoices.push({ code, customer, total, status, time: dateStr });
  }
  recentInvoices = recentInvoices.slice(-8).reverse();

  const revenueByDay = dayOrder.map(key => ({
    date: key,
    label: key.substring(0, 5),
    revenue: dayBuckets[key].revenue,
    count: dayBuckets[key].count
  }));
  const periodRevenue = revenueByDay.reduce((s, d) => s + d.revenue, 0);
  const periodInvoices = revenueByDay.reduce((s, d) => s + d.count, 0);

  // ---------- KHÁCH HÀNG ----------
  const custData = await sheetsClient.getValues(CONFIG.SHEET_CUSTOMERS);
  let totalCustomers = 0, customersWithDebt = 0, totalDebt = 0;
  let topDebt = [];

  for (let r = 1; r < custData.length; r++) {
    const row = custData[r];
    const code = row[0];
    if (!code) continue;
    totalCustomers++;
    const debt = Number(row[5]) || 0;
    if (debt > 0) {
      customersWithDebt++;
      totalDebt += debt;
      topDebt.push({ code, name: row[1], phone: row[2], debt });
    }
  }
  topDebt.sort((a, b) => b.debt - a.debt);
  topDebt = topDebt.slice(0, 8);

  return {
    updatedAt: formatDMYHMS(new Date()),
    days,
    kpi: {
      revenueToday,
      invoicesToday,
      cancelledToday,
      totalProducts,
      totalStock,
      lowStockCount: lowStock.length,
      totalCustomers,
      customersWithDebt,
      totalDebt,
      periodRevenue,
      periodInvoices
    },
    revenueByDay,
    recentInvoices,
    lowStock,
    stockDistribution,
    topDebt
  };
}

module.exports = { getDashboardData };
