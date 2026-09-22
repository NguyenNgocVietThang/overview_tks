'use strict';

const DB_SOURCE = 'postgres';

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

// Delta ton kho theo tung loai chung tu: ban ra tru, nhap/khach tra cong, tra
// NCC tru (nguoc voi nhap hang). Ca 4 loai deu doc tu Postgres — Tra NCC tu
// bang supplier_return_imports (nguoi dung tu import Excel KiotViet, xem
// supplierReturnImportService.js), khong con doc Google Sheets.
const MOVEMENT_SOURCES = [
  { kind: 'invoices', label: 'Hóa đơn', sign: -1 },
  { kind: 'purchases', label: 'Nhập hàng', sign: 1 },
  { kind: 'customerReturns', label: 'Khách trả hàng', sign: 1 },
  { kind: 'supplierReturns', label: 'Trả NCC', sign: -1 }
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

// Tra NCC duoc nguoi dung import theo tung dot (thay the toan bo du lieu cu
// cua co so, xem supplierReturnImportService.js) thay vi dong bo lien tuc nhu
// 3 nguon con lai — neu chua import hoac file import khong voi toi dau ky tinh
// toan, so ngay dut hang truoc moc do khong dang tin, phai canh bao ro.
function buildSupplierReturnCoverageWarning(coverage, fromDate) {
  if (!coverage.rowCount) {
    return 'Chưa import dữ liệu Trả NCC cho cơ sở này; số ngày đứt hàng có thể không chính xác do thiếu lịch sử trả hàng NCC.';
  }
  if (!coverage.earliestDate || coverage.earliestDate > fromDate) {
    return `Dữ liệu Trả NCC đã import chỉ có từ ${coverage.earliestDate || 'không rõ ngày'} (cần từ ${fromDate}); ` +
      'số ngày đứt hàng trước mốc này có thể không chính xác do thiếu lịch sử trả hàng NCC.';
  }
  return null;
}

async function loadStockoutEvents(options) {
  const {
    source,
    validCodeSet,
    fromDate,
    toDate,
    now = new Date(),
    onProgress = () => {}
  } = options;

  const eventMapByCode = new Map();
  const warnings = [];
  const sources = Object.fromEntries(MOVEMENT_SOURCES.map(({ kind }) => [kind, DB_SOURCE]));

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

  try {
    const coverageWarning = buildSupplierReturnCoverageWarning(await source.getSupplierReturnCoverage(), fromDate);
    if (coverageWarning) warnings.push(coverageWarning);
  } catch (err) {
    throw wrapDbError('độ phủ dữ liệu Trả NCC', err);
  }

  return { eventMapByCode, sources, warnings };
}

module.exports = {
  loadStockoutEvents,
  buildSyncFreshnessWarnings,
  STALE_SYNC_THRESHOLD_MS
};
