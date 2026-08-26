'use strict';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

function toVnDateKey(isoDateTimeString) {
  let raw = String(isoDateTimeString).trim();
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) raw += 'Z';
  const utcTime = new Date(raw).getTime();
  return new Date(utcTime + VN_OFFSET_MS).toISOString().slice(0, 10);
}

function addDaysToDateKey(dateKey, days) {
  const d = new Date(dateKey + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function pushEvent(eventMapByCode, code, dateKey, delta) {
  if (!eventMapByCode.has(code)) eventMapByCode.set(code, []);
  eventMapByCode.get(code).push({ dateKey, delta });
}

function accumulateInvoiceEvents(eventMapByCode, invoicePage, validCodeSet) {
  // KiotViet invoice status: 1 = Hoàn thành, 2 = Đã hủy, 3 = Đang xử lý (đã xác nhận qua API thực tế).
  for (const invoice of invoicePage) {
    if (Number(invoice.status) !== 1) continue;
    const dateKey = toVnDateKey(invoice.purchaseDate);
    for (const detail of invoice.invoiceDetails || []) {
      if (!validCodeSet.has(detail.productCode)) continue;
      pushEvent(eventMapByCode, detail.productCode, dateKey, -detail.quantity);
    }
  }
}

function accumulatePurchaseOrderEvents(eventMapByCode, poPage, validCodeSet) {
  for (const po of poPage) {
    if (po.isDraft) continue;
    const dateKey = toVnDateKey(po.purchaseDate);
    for (const detail of po.purchaseOrderDetails || []) {
      if (!validCodeSet.has(detail.productCode)) continue;
      pushEvent(eventMapByCode, detail.productCode, dateKey, detail.quantity);
    }
  }
}

function accumulateReturnEvents(eventMapByCode, returnPage, validCodeSet) {
  // KiotViet return status: 1 = Đã trả, 2 = Đã hủy (đã xác nhận qua API thực tế).
  for (const ret of returnPage) {
    if (Number(ret.status) !== 1) continue;
    const dateKey = toVnDateKey(ret.returnDate);
    for (const detail of ret.returnDetails || []) {
      if (!validCodeSet.has(detail.productCode)) continue;
      pushEvent(eventMapByCode, detail.productCode, dateKey, detail.quantity);
    }
  }
}

function reconstructDailyStock(currentOnHand, eventsForCode, todayKey, daysBack = 183) {
  const deltaByDate = new Map();
  for (const { dateKey, delta } of eventsForCode) {
    deltaByDate.set(dateKey, (deltaByDate.get(dateKey) || 0) + delta);
  }

  const dates = [];
  for (let i = daysBack; i >= 0; i--) dates.push(addDaysToDateKey(todayKey, -i));

  const stocks = new Array(dates.length);
  stocks[dates.length - 1] = currentOnHand;
  for (let i = dates.length - 1; i > 0; i--) {
    stocks[i - 1] = stocks[i] - (deltaByDate.get(dates[i]) || 0);
  }

  return dates.map((date, i) => ({ date, stock: stocks[i] }));
}

module.exports = {
  toVnDateKey,
  accumulateInvoiceEvents,
  accumulatePurchaseOrderEvents,
  accumulateReturnEvents,
  reconstructDailyStock
};
