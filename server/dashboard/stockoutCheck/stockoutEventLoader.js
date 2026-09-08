'use strict';

const CONFIG = require('../../config');
const {
  accumulateInvoiceEvents,
  accumulatePurchaseOrderEvents,
  accumulateReturnEvents,
  isCompletedPurchaseOrder
} = require('./timelineBuilder');
const {
  mergeEventMaps,
  buildInvoiceEventMapFromSheets,
  buildPurchaseEventMapFromSheets,
  buildSupplierReturnEventMapFromSheets
} = require('./sheetTimelineBuilder');

const API_SOURCE = 'kiotviet-api';
const SHEET_FALLBACK_SOURCE = 'google-sheets-fallback';
const SHEET_SOURCE = 'google-sheets';

function isCompletedInvoice(item) {
  return Number(item && item.status) === 1;
}

function isCompletedReturn(item) {
  return Number(item && item.status) === 1;
}

function validateDetailedPage(items, { label, isCompleted, dateField, detailsField }) {
  if (!Array.isArray(items)) throw new Error(`${label}: dữ liệu phân trang không phải mảng.`);
  for (const item of items) {
    if (!isCompleted(item)) continue;
    if (!item || !item[dateField]) throw new Error(`${label}: thiếu ${dateField}.`);
    if (!Array.isArray(item[detailsField])) throw new Error(`${label}: thiếu ${detailsField}.`);
    for (const detail of item[detailsField]) {
      if (!String(detail && detail.productCode || '').trim()) {
        throw new Error(`${label}: chi tiết thiếu productCode.`);
      }
      if (!Number.isFinite(Number(detail.quantity))) {
        throw new Error(`${label}: chi tiết có quantity không hợp lệ.`);
      }
    }
  }
}

function warningFor(label, err) {
  const reason = err && err.message ? ` (${err.message})` : '';
  return `API ${label} lỗi${reason}; kết quả đã dùng Google Sheets dự phòng.`;
}

function wrapCustomerReturnError(err) {
  const wrapped = new Error(`API Khách trả hàng lỗi và không có Sheet chi tiết để dự phòng: ${err && err.message ? err.message : 'không rõ nguyên nhân'}`);
  wrapped.code = 'STOCKOUT_CUSTOMER_RETURNS_UNAVAILABLE';
  wrapped.cause = err;
  return wrapped;
}

async function loadStockoutEvents(options) {
  const {
    client,
    sheetsClient,
    validCodeSet,
    fromDate,
    toDate,
    onProgress = () => {}
  } = options;

  const eventMapByCode = new Map();
  const warnings = [];
  const sources = {
    invoices: API_SOURCE,
    purchases: API_SOURCE,
    customerReturns: API_SOURCE,
    supplierReturns: SHEET_SOURCE
  };

  async function loadApiSource({ source, label, endpoint, query, validation, accumulate }) {
    const temporary = new Map();
    onProgress({ source, label, status: 'loading', pagesLoaded: 0, recordsLoaded: 0, total: 0 });
    await client.fetchAllPages(endpoint, query, async (items, meta) => {
      validateDetailedPage(items, validation);
      accumulate(temporary, items, validCodeSet, fromDate, toDate);
      onProgress({ source, label, status: 'loading', ...meta });
    });
    onProgress({ source, label, status: 'done' });
    return temporary;
  }

  try {
    const invoiceEvents = await loadApiSource({
      source: 'invoices',
      label: 'Hóa đơn',
      endpoint: 'invoices',
      query: { fromPurchaseDate: fromDate, toPurchaseDate: toDate },
      validation: { label: 'Hóa đơn', isCompleted: isCompletedInvoice, dateField: 'purchaseDate', detailsField: 'invoiceDetails' },
      accumulate: accumulateInvoiceEvents
    });
    mergeEventMaps(eventMapByCode, invoiceEvents);
  } catch (err) {
    const sheets = await sheetsClient.getMultipleSheetValues([CONFIG.SHEET_INVOICES, CONFIG.SHEET_INVOICE_DETAILS]);
    mergeEventMaps(eventMapByCode, buildInvoiceEventMapFromSheets(sheets, validCodeSet, fromDate, toDate));
    sources.invoices = SHEET_FALLBACK_SOURCE;
    warnings.push(warningFor('Hóa đơn', err));
    onProgress({ source: 'invoices', label: 'Hóa đơn', status: 'fallback' });
  }

  try {
    const purchaseEvents = await loadApiSource({
      source: 'purchases',
      label: 'Nhập hàng',
      endpoint: 'purchaseorders',
      query: { fromPurchaseDate: fromDate, toPurchaseDate: toDate, status: '3' },
      validation: { label: 'Nhập hàng', isCompleted: isCompletedPurchaseOrder, dateField: 'purchaseDate', detailsField: 'purchaseOrderDetails' },
      accumulate: accumulatePurchaseOrderEvents
    });
    mergeEventMaps(eventMapByCode, purchaseEvents);
  } catch (err) {
    const sheets = await sheetsClient.getMultipleSheetValues([CONFIG.SHEET_PURCHASES]);
    mergeEventMaps(eventMapByCode, buildPurchaseEventMapFromSheets(sheets, validCodeSet, fromDate, toDate));
    sources.purchases = SHEET_FALLBACK_SOURCE;
    warnings.push(warningFor('Nhập hàng', err));
    onProgress({ source: 'purchases', label: 'Nhập hàng', status: 'fallback' });
  }

  try {
    const returnEvents = await loadApiSource({
      source: 'customerReturns',
      label: 'Khách trả hàng',
      endpoint: 'returns',
      query: { lastModifiedFrom: fromDate },
      validation: { label: 'Khách trả hàng', isCompleted: isCompletedReturn, dateField: 'returnDate', detailsField: 'returnDetails' },
      accumulate: accumulateReturnEvents
    });
    mergeEventMaps(eventMapByCode, returnEvents);
  } catch (err) {
    throw wrapCustomerReturnError(err);
  }

  onProgress({ source: 'supplierReturns', label: 'Trả NCC', status: 'loading' });
  const supplierReturnSheets = await sheetsClient.getMultipleSheetValues([CONFIG.SHEET_SUPPLIER_RETURNS]);
  mergeEventMaps(
    eventMapByCode,
    buildSupplierReturnEventMapFromSheets(supplierReturnSheets, validCodeSet, fromDate, toDate)
  );
  onProgress({ source: 'supplierReturns', label: 'Trả NCC', status: 'done' });

  return { eventMapByCode, sources, warnings };
}

module.exports = {
  loadStockoutEvents,
  validateDetailedPage
};
