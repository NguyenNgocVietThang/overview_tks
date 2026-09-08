'use strict';

const { addDaysToDateKey } = require('./dateHelpers');

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

function toVnDateKey(isoDateTimeString) {
  const raw = String(isoDateTimeString).trim();
  // KiotViet tra ve chuoi gio khong kem offset mui gio, nhung thuc te la gio
  // Viet Nam (+07:00) — giong quy uoc trong kiotvietSync/vietnamTime.js. Voi
  // chuoi khong co Z/offset, lay thang phan ngay, KHONG duoc cong them +7h
  // (cong them se lech 1 ngay voi moi giao dich sau ~17h VN).
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) return raw.slice(0, 10);
  const utcTime = new Date(raw).getTime();
  return new Date(utcTime + VN_OFFSET_MS).toISOString().slice(0, 10);
}

function pushEvent(eventMapByCode, code, dateKey, delta, source) {
  if (!eventMapByCode.has(code)) eventMapByCode.set(code, []);
  eventMapByCode.get(code).push({ dateKey, delta, source });
}

function inDateRange(dateKey, fromDate, toDate) {
  return (!fromDate || dateKey >= fromDate) && (!toDate || dateKey <= toDate);
}

function isCompletedPurchaseOrder(po) {
  if (!po) return false;
  if (po.status !== undefined && po.status !== null && po.status !== '') return Number(po.status) === 3;
  return po.isDraft === false || Number(po.isDraft) === 0;
}

function accumulateInvoiceEvents(eventMapByCode, invoicePage, validCodeSet, fromDate, toDate) {
  // KiotViet invoice status: 1 = Hoàn thành, 2 = Đã hủy, 3 = Đang xử lý (đã xác nhận qua API thực tế).
  for (const invoice of invoicePage) {
    if (Number(invoice.status) !== 1) continue;
    const dateKey = toVnDateKey(invoice.purchaseDate);
    if (!inDateRange(dateKey, fromDate, toDate)) continue;
    for (const detail of invoice.invoiceDetails || []) {
      const code = String(detail.productCode || '').trim();
      if (!validCodeSet.has(code)) continue;
      pushEvent(eventMapByCode, code, dateKey, -Number(detail.quantity || 0), 'invoices');
    }
  }
}

function accumulatePurchaseOrderEvents(eventMapByCode, poPage, validCodeSet, fromDate, toDate) {
  for (const po of poPage) {
    if (!isCompletedPurchaseOrder(po)) continue;
    const dateKey = toVnDateKey(po.purchaseDate);
    if (!inDateRange(dateKey, fromDate, toDate)) continue;
    for (const detail of po.purchaseOrderDetails || []) {
      const code = String(detail.productCode || '').trim();
      if (!validCodeSet.has(code)) continue;
      pushEvent(eventMapByCode, code, dateKey, Number(detail.quantity || 0), 'purchases');
    }
  }
}

function accumulateReturnEvents(eventMapByCode, returnPage, validCodeSet, fromDate, toDate) {
  // KiotViet return status: 1 = Đã trả, 2 = Đã hủy (đã xác nhận qua API thực tế).
  for (const ret of returnPage) {
    if (Number(ret.status) !== 1) continue;
    const dateKey = toVnDateKey(ret.returnDate);
    if (!inDateRange(dateKey, fromDate, toDate)) continue;
    for (const detail of ret.returnDetails || []) {
      const code = String(detail.productCode || '').trim();
      if (!validCodeSet.has(code)) continue;
      pushEvent(eventMapByCode, code, dateKey, Number(detail.quantity || 0), 'customerReturns');
    }
  }
}

function reconstructDailyStock(currentOnHand, eventsForCode, todayKey, daysBack = 183) {
  const deltaByDate = new Map();
  // Ngay co phieu Nhap hang (bat ke sau do ban/chuyen het trong ngay, net ve
  // 0) van la ngay CO hang tren ke — chi tinh cong don delta hang ngay thi
  // khong phan biet duoc voi ngay khong co giao dich gi (ca hai deu ra net
  // 0). Theo doi rieng de findStockoutPeriods ngat dot dut hang tai do.
  const purchaseDates = new Set();
  for (const { dateKey, delta, source } of eventsForCode) {
    deltaByDate.set(dateKey, (deltaByDate.get(dateKey) || 0) + delta);
    if (source === 'purchases') purchaseDates.add(dateKey);
  }

  const dates = [];
  for (let i = daysBack; i >= 0; i--) dates.push(addDaysToDateKey(todayKey, -i));

  const stocks = new Array(dates.length);
  stocks[dates.length - 1] = currentOnHand;
  for (let i = dates.length - 1; i > 0; i--) {
    stocks[i - 1] = stocks[i] - (deltaByDate.get(dates[i]) || 0);
  }

  return dates.map((date, i) => ({ date, stock: Math.max(0, stocks[i]), hadPurchase: purchaseDates.has(date) }));
}

module.exports = {
  toVnDateKey,
  inDateRange,
  isCompletedPurchaseOrder,
  accumulateInvoiceEvents,
  accumulatePurchaseOrderEvents,
  accumulateReturnEvents,
  reconstructDailyStock
};
