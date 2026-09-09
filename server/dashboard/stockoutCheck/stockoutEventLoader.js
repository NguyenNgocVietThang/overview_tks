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
  buildSupplierReturnEventMapFromSheets,
  findEarliestSheetDateKey
} = require('./sheetTimelineBuilder');

const API_SOURCE = 'kiotviet-api';
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

// Khong con fallback Sheets cho bat ky nguon nao ngoai Tra NCC (khong co API
// cong khai) — API loi thi bao loi that, khong am tham dung du lieu Sheet co
// the da loi thoi (xem stockout_calc bugs: Sheet phu thuoc webhook, co the
// dung yen hang gio/ngay ma khong co dau hieu).
function wrapApiError(label, err) {
  const wrapped = new Error(`API ${label} lỗi: ${err && err.message ? err.message : 'không rõ nguyên nhân'}`);
  wrapped.code = 'STOCKOUT_API_SOURCE_UNAVAILABLE';
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
    try {
      await client.fetchAllPages(endpoint, query, async (items, meta) => {
        validateDetailedPage(items, validation);
        accumulate(temporary, items, validCodeSet, fromDate, toDate);
        onProgress({ source, label, status: 'loading', ...meta });
      });
    } catch (err) {
      throw wrapApiError(label, err);
    }
    onProgress({ source, label, status: 'done' });
    return temporary;
  }

  const invoiceEvents = await loadApiSource({
    source: 'invoices',
    label: 'Hóa đơn',
    endpoint: 'invoices',
    query: { fromPurchaseDate: fromDate, toPurchaseDate: toDate },
    validation: { label: 'Hóa đơn', isCompleted: isCompletedInvoice, dateField: 'purchaseDate', detailsField: 'invoiceDetails' },
    accumulate: accumulateInvoiceEvents
  });
  mergeEventMaps(eventMapByCode, invoiceEvents);

  const purchaseEvents = await loadApiSource({
    source: 'purchases',
    label: 'Nhập hàng',
    endpoint: 'purchaseorders',
    query: { fromPurchaseDate: fromDate, toPurchaseDate: toDate, status: '3' },
    validation: { label: 'Nhập hàng', isCompleted: isCompletedPurchaseOrder, dateField: 'purchaseDate', detailsField: 'purchaseOrderDetails' },
    accumulate: accumulatePurchaseOrderEvents
  });
  mergeEventMaps(eventMapByCode, purchaseEvents);

  const returnEvents = await loadApiSource({
    source: 'customerReturns',
    label: 'Khách trả hàng',
    endpoint: 'returns',
    query: { lastModifiedFrom: fromDate },
    validation: { label: 'Khách trả hàng', isCompleted: isCompletedReturn, dateField: 'returnDate', detailsField: 'returnDetails' },
    accumulate: accumulateReturnEvents
  });
  mergeEventMaps(eventMapByCode, returnEvents);

  onProgress({ source: 'supplierReturns', label: 'Trả NCC', status: 'loading' });
  const supplierReturnSheets = await sheetsClient.getMultipleSheetValues([CONFIG.SHEET_SUPPLIER_RETURNS]);
  const supplierReturnRows = supplierReturnSheets[CONFIG.SHEET_SUPPLIER_RETURNS] || [];
  // Sheet Tra NCC duoc nhap tay va thuong chi giu mot cua so ngay gan day (bi
  // ghi de dinh ky) thay vi luu ca lich su — neu cua so do khong voi toi dau ky
  // tinh toan, so ngay dut hang truoc moc do khong dang tin, phai canh bao ro
  // thay vi bao ket qua nhu the la chinh xac tuyet doi.
  const earliestSupplierReturnDate = findEarliestSheetDateKey(supplierReturnRows, 'Thời gian');
  if (!earliestSupplierReturnDate || earliestSupplierReturnDate > fromDate) {
    warnings.push(
      `Sheet Trả NCC chỉ có dữ liệu từ ${earliestSupplierReturnDate || 'không rõ ngày'} (cần từ ${fromDate}); ` +
      'số ngày đứt hàng trước mốc này có thể không chính xác do thiếu lịch sử trả hàng NCC.'
    );
  }
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
