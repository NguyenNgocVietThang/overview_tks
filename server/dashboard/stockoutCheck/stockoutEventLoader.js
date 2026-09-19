'use strict';

const CONFIG = require('../../config');
const {
  mergeEventMaps,
  buildSupplierReturnEventMapFromSheets,
  findEarliestSheetDateKey
} = require('./sheetTimelineBuilder');

const DB_SOURCE = 'postgres';
const SHEET_SOURCE = 'google-sheets';

// Lan dong bo thanh cong gan nhat cua 1 thuc the cu hon moc nay thi ket qua quet
// (doc tu Postgres) co the thieu giao dich moi — bo dong bo chay moi ~7-20 phut
// nen 60 phut la dau hieu dong bo dang loi/dung.
const STALE_SYNC_THRESHOLD_MS = 60 * 60 * 1000;

const SYNC_ENTITY_LABELS = {
  products: 'Hàng hóa',
  invoices: 'Hóa đơn',
  purchases: 'Nhập hàng',
  returns: 'Khách trả hàng'
};

// Delta ton kho theo tung loai chung tu: ban ra tru, nhap/khach tra cong.
const MOVEMENT_SOURCES = [
  { kind: 'invoices', label: 'Hóa đơn', sign: -1 },
  { kind: 'purchases', label: 'Nhập hàng', sign: 1 },
  { kind: 'customerReturns', label: 'Khách trả hàng', sign: 1 }
];

function wrapDbError(label, err) {
  const wrapped = new Error(`Đọc ${label} từ cơ sở dữ liệu lỗi: ${err && err.message ? err.message : 'không rõ nguyên nhân'}`);
  wrapped.code = 'STOCKOUT_DB_SOURCE_UNAVAILABLE';
  wrapped.cause = err;
  return wrapped;
}

function buildSyncFreshnessWarnings(syncStatus, now) {
  const warnings = [];
  for (const { entity, lastSuccessAt } of syncStatus) {
    const label = SYNC_ENTITY_LABELS[entity] || entity;
    const syncedMs = lastSuccessAt ? new Date(lastSuccessAt).getTime() : NaN;
    if (!Number.isFinite(syncedMs)) {
      warnings.push(`Dữ liệu ${label} chưa từng được đồng bộ từ KiotViet; kết quả có thể thiếu giao dịch.`);
    } else if (now.getTime() - syncedMs > STALE_SYNC_THRESHOLD_MS) {
      const minutes = Math.round((now.getTime() - syncedMs) / 60000);
      warnings.push(`Dữ liệu ${label} đồng bộ lần cuối cách đây ${minutes} phút; kết quả có thể thiếu giao dịch mới.`);
    }
  }
  return warnings;
}

async function loadStockoutEvents(options) {
  const {
    source,
    sheetsClient,
    validCodeSet,
    fromDate,
    toDate,
    now = new Date(),
    onProgress = () => {}
  } = options;

  const eventMapByCode = new Map();
  const warnings = [];
  const sources = {
    invoices: DB_SOURCE,
    purchases: DB_SOURCE,
    customerReturns: DB_SOURCE,
    supplierReturns: SHEET_SOURCE
  };

  // Khong con fallback Google Sheets cho bat ky nguon nao ngoai Tra NCC (khong
  // co bang trong Postgres) — doc DB loi thi bao loi that, khong am tham dung
  // du lieu Sheet co the da loi thoi.
  for (const { kind, label, sign } of MOVEMENT_SOURCES) {
    onProgress({ source: kind, label, status: 'loading', pagesLoaded: 0, recordsLoaded: 0, total: 0 });
    let movements;
    try {
      movements = await source.listStockMovements({ kind, codes: validCodeSet, fromDate, toDate });
    } catch (err) {
      throw wrapDbError(label, err);
    }
    for (const { code, dateKey, quantity } of movements) {
      if (!validCodeSet.has(code)) continue;
      if (!eventMapByCode.has(code)) eventMapByCode.set(code, []);
      eventMapByCode.get(code).push({ dateKey, delta: sign * quantity, source: kind });
    }
    onProgress({ source: kind, label, status: 'done' });
  }

  try {
    warnings.push(...buildSyncFreshnessWarnings(await source.getSyncStatus(), now));
  } catch (err) {
    throw wrapDbError('trạng thái đồng bộ', err);
  }

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
  buildSyncFreshnessWarnings,
  STALE_SYNC_THRESHOLD_MS
};
