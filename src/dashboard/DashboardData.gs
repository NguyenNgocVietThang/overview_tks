// ==========================================
// DASHBOARD DATA — Cung cap du lieu cho Web App
// ==========================================

/**
 * Ham chinh lay du lieu cho dashboard.
 * Duoc goi tu client-side qua google.script.run.getDashboardData(days).
 *
 * @param {number} days - So ngay gan nhat de ve bieu do doanh thu (7/30/90). Mac dinh 30.
 * @returns {Object} Du lieu KPI, bieu do, bang xep hang cho dashboard
 */
function getDashboardData(days) {
  days = Number(days) || 30;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = Session.getScriptTimeZone();
  const todayStr = Utilities.formatDate(new Date(), tz, "dd/MM/yyyy");

  // ---------- HÀNG HÓA ----------
  const prodSheet = ss.getSheetByName(CONFIG.SHEET_PRODUCTS);
  const prodData = prodSheet ? prodSheet.getDataRange().getValues() : [[]];
  let totalProducts = 0, totalStock = 0, lowStock = [];
  const categoryMap = {};
  const OUT_OF_STOCK_LEVEL = 0;
  const CATEGORY_STOCK_TOP = 15;

  for (let r = 1; r < prodData.length; r++) {
    const row = prodData[r];
    const code = row[0];
    if (!code) continue;
    totalProducts++;
    const ton = Number(row[7]) || 0;
    const cost = Math.max(Number(row[5]) || 0, 0);
    const stockValue = Math.max(ton, 0) * cost;
    totalStock += ton;
    const reserved = Number(row[8]) || 0;
    if (ton === OUT_OF_STOCK_LEVEL) {
      lowStock.push({ code: code, name: row[1], stock: ton, reserved: reserved });
    }

    const categoryName = (row[2] && String(row[2]).trim()) || 'Chưa phân nhóm';
    if (!categoryMap[categoryName]) categoryMap[categoryName] = { name: categoryName, stockValue: 0, productCount: 0 };
    categoryMap[categoryName].stockValue += stockValue;
    categoryMap[categoryName].productCount += 1;
  }
  lowStock.sort((a, b) => a.stock - b.stock);
  lowStock = lowStock.slice(0, 8);

  let stockValueByCategory = Object.values(categoryMap).filter(c => c.stockValue > 0).sort((a, b) => b.stockValue - a.stockValue);
  const inventoryValueCategoryCount = stockValueByCategory.length;
  const totalInventoryValue = stockValueByCategory.reduce((sum, category) => sum + category.stockValue, 0);
  const restValueCategories = stockValueByCategory.slice(CATEGORY_STOCK_TOP);
  stockValueByCategory = stockValueByCategory.slice(0, CATEGORY_STOCK_TOP);
  if (restValueCategories.length > 0) {
    stockValueByCategory.push({
      name: 'Khác (' + restValueCategories.length + ' nhóm)',
      stockValue: restValueCategories.reduce((sum, category) => sum + category.stockValue, 0),
      productCount: restValueCategories.reduce((sum, category) => sum + category.productCount, 0)
    });
  }

  // ---------- HÓA ĐƠN ----------
  const invSheet = ss.getSheetByName(CONFIG.SHEET_INVOICES);
  const invData = invSheet ? invSheet.getDataRange().getValues() : [[]];
  let revenueToday = 0, invoicesToday = 0, cancelledToday = 0;
  let recentInvoices = [];

  // Chuẩn bị khung ngày cho biểu đồ (days ngày gần nhất, kể cả hôm nay)
  const dayBuckets = {}; // key: dd/MM/yyyy -> {revenue, count}
  const dayOrder = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = Utilities.formatDate(d, tz, "dd/MM/yyyy");
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
    const dateStr = String(row[6] || "");
    const dateKey = dateStr.split(" ")[0]; // lấy phần dd/MM/yyyy
    const isCancelled = status === "Đã hủy";

    if (dateKey === todayStr) {
      if (isCancelled) { cancelledToday++; }
      else { revenueToday += total; invoicesToday++; }
    }

    if (!isCancelled && dayBuckets.hasOwnProperty(dateKey)) {
      dayBuckets[dateKey].revenue += total;
      dayBuckets[dateKey].count += 1;
    }

    recentInvoices.push({ code: code, customer: customer, total: total, status: status, time: dateStr });
  }
  recentInvoices = recentInvoices.slice(-8).reverse();

  const revenueByDay = dayOrder.map(key => ({
    date: key,
    label: key.substring(0, 5), // dd/MM
    revenue: dayBuckets[key].revenue,
    count: dayBuckets[key].count
  }));
  const periodRevenue = revenueByDay.reduce((s, d) => s + d.revenue, 0);
  const periodInvoices = revenueByDay.reduce((s, d) => s + d.count, 0);

  // ---------- KHÁCH HÀNG ----------
  const custSheet = ss.getSheetByName(CONFIG.SHEET_CUSTOMERS);
  const custData = custSheet ? custSheet.getDataRange().getValues() : [[]];
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
      topDebt.push({ code: code, name: row[1], phone: row[2], debt: debt });
    }
  }
  topDebt.sort((a, b) => b.debt - a.debt);
  topDebt = topDebt.slice(0, 8);

  return {
    updatedAt: Utilities.formatDate(new Date(), tz, "dd/MM/yyyy HH:mm:ss"),
    days: days,
    kpi: {
      revenueToday: revenueToday,
      invoicesToday: invoicesToday,
      cancelledToday: cancelledToday,
      totalProducts: totalProducts,
      totalStock: totalStock,
      lowStockCount: lowStock.length,
      totalInventoryValue: totalInventoryValue,
      inventoryValueCategoryCount: inventoryValueCategoryCount,
      totalCustomers: totalCustomers,
      customersWithDebt: customersWithDebt,
      totalDebt: totalDebt,
      periodRevenue: periodRevenue,
      periodInvoices: periodInvoices
    },
    revenueByDay: revenueByDay,
    recentInvoices: recentInvoices,
    lowStock: lowStock,
    stockValueByCategory: stockValueByCategory,
    topDebt: topDebt
  };
}
