'use strict';

const CONFIG = require('../../config');

const ACTIVE_STATUS = 'Đang kinh doanh';
const COMPLETED_INVOICE_STATUS = 'Hoàn thành';

function isVatProductCode(value) {
  return String(value || '').trim().toUpperCase().startsWith('VAT');
}

// Sheets API duoc goi voi dateTimeRenderOption: 'FORMATTED_STRING' (xem
// sheetsClient.js), luon tra ve chuoi "dd/MM/yyyy HH:mm:ss" — chi can lay
// dung phan ngay-thang-nam lam key so sanh, khong can dung Date object (tranh
// loi lech ngay khi cong/tru offset gio Viet Nam qua Date.getUTCFullYear()).
function parseSheetDateKey(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const str = String(raw).trim();
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [, dd, MM, yyyy] = m;
    return `${yyyy}-${MM.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const [, yyyy, MM, dd] = iso;
    return `${yyyy}-${MM.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  return null;
}

function headerIndexes(rows, names) {
  const headers = rows[0] || [];
  const result = {};
  for (const name of names) result[name] = headers.indexOf(name);
  return result;
}

function pushEvent(eventMapByCode, code, dateKey, delta) {
  if (!eventMapByCode.has(code)) eventMapByCode.set(code, []);
  eventMapByCode.get(code).push({ dateKey, delta });
}

function loadActiveCandidates(productRows) {
  const idx = headerIndexes(productRows, ['Mã hàng', 'Tên hàng', 'Tồn kho', 'Trạng thái']);
  const candidates = [];
  let totalProductsScanned = 0;
  for (let r = 1; r < productRows.length; r++) {
    const row = productRows[r];
    const code = String(row[idx['Mã hàng']] || '').trim();
    if (!code) continue;
    totalProductsScanned++;
    const status = String(row[idx['Trạng thái']] || ACTIVE_STATUS).trim();
    if (status !== ACTIVE_STATUS) continue;
    candidates.push({
      code,
      name: row[idx['Tên hàng']],
      currentOnHand: Number(row[idx['Tồn kho']]) || 0
    });
  }
  return { candidates, totalProductsScanned };
}

function buildCompletedInvoiceDateMap(invoiceRows, fromDate, todayKey) {
  const idx = headerIndexes(invoiceRows, ['Mã hóa đơn', 'Ngày bán', 'Trạng thái']);
  const map = new Map();
  for (let r = 1; r < invoiceRows.length; r++) {
    const row = invoiceRows[r];
    const status = String(row[idx['Trạng thái']] || COMPLETED_INVOICE_STATUS).trim();
    if (status !== COMPLETED_INVOICE_STATUS) continue;
    const dateKey = parseSheetDateKey(row[idx['Ngày bán']]);
    if (!dateKey || dateKey < fromDate || dateKey > todayKey) continue;
    map.set(String(row[idx['Mã hóa đơn']] || '').trim(), dateKey);
  }
  return map;
}

function accumulateSheetInvoiceEvents(eventMapByCode, invoiceDateByCode, detailRows, validCodeSet) {
  const idx = headerIndexes(detailRows, ['Mã hóa đơn', 'Mã hàng', 'Số lượng']);
  for (let r = 1; r < detailRows.length; r++) {
    const row = detailRows[r];
    const code = String(row[idx['Mã hàng']] || '').trim();
    if (!code || isVatProductCode(code) || !validCodeSet.has(code)) continue;
    const invoiceCode = String(row[idx['Mã hóa đơn']] || '').trim();
    const dateKey = invoiceDateByCode.get(invoiceCode);
    if (!dateKey) continue;
    pushEvent(eventMapByCode, code, dateKey, -(Number(row[idx['Số lượng']]) || 0));
  }
}

function accumulateSheetPurchaseEvents(eventMapByCode, purchaseRows, validCodeSet, fromDate, todayKey) {
  const idx = headerIndexes(purchaseRows, ['Mã hàng', 'Thời gian', 'Số lượng']);
  for (let r = 1; r < purchaseRows.length; r++) {
    const row = purchaseRows[r];
    const code = String(row[idx['Mã hàng']] || '').trim();
    if (!code || isVatProductCode(code) || !validCodeSet.has(code)) continue;
    const dateKey = parseSheetDateKey(row[idx['Thời gian']]);
    if (!dateKey || dateKey < fromDate || dateKey > todayKey) continue;
    pushEvent(eventMapByCode, code, dateKey, Number(row[idx['Số lượng']]) || 0);
  }
}

function accumulateSheetPurchaseReturnEvents(eventMapByCode, purchaseReturnRows, validCodeSet, fromDate, todayKey) {
  const idx = headerIndexes(purchaseReturnRows, ['Mã hàng', 'Thời gian', 'Số lượng']);
  for (let r = 1; r < purchaseReturnRows.length; r++) {
    const row = purchaseReturnRows[r];
    const code = String(row[idx['Mã hàng']] || '').trim();
    if (!code || isVatProductCode(code) || !validCodeSet.has(code)) continue;
    const dateKey = parseSheetDateKey(row[idx['Thời gian']]);
    if (!dateKey || dateKey < fromDate || dateKey > todayKey) continue;
    // Tra hang ve NCC lam GIAM ton kho cua minh (nguoc dau voi Nhap hang).
    pushEvent(eventMapByCode, code, dateKey, -(Number(row[idx['Số lượng']]) || 0));
  }
}

function buildEventMapFromSheets(sheets, validCodeSet, fromDate, todayKey) {
  const eventMapByCode = new Map();
  const invoiceDateByCode = buildCompletedInvoiceDateMap(sheets[CONFIG.SHEET_INVOICES] || [], fromDate, todayKey);
  accumulateSheetInvoiceEvents(eventMapByCode, invoiceDateByCode, sheets[CONFIG.SHEET_INVOICE_DETAILS] || [], validCodeSet);
  accumulateSheetPurchaseEvents(eventMapByCode, sheets[CONFIG.SHEET_PURCHASES] || [], validCodeSet, fromDate, todayKey);
  accumulateSheetPurchaseReturnEvents(eventMapByCode, sheets[CONFIG.SHEET_SUPPLIER_RETURNS] || [], validCodeSet, fromDate, todayKey);
  return eventMapByCode;
}

module.exports = {
  isVatProductCode,
  parseSheetDateKey,
  loadActiveCandidates,
  buildEventMapFromSheets
};
