'use strict';

// Danh muc cot DUY NHAT cua bang "Kiem tra gia ban" (tab Hoa don): 17 cot nghiep vu
// (15 hien mac dinh) roi cac cot doi chieu. Dung chung cho:
//   - API GET / (route gan `columns` de frontend dung thead tu day),
//   - GET /export/fields + /export (whitelist cot, nhan, kieu o Excel/HTML).
// type: datetime | branch | text | money | number | bool | status | decision | timestamp
//   money/number: chuoi decimal (NUMERIC) hoac null; null = thieu gia ("—"), 0 = 0đ.

const BUSINESS = 'Nghiệp vụ';

const col = (key, label, group, type, defaultVisible = false, extra = {}) =>
  Object.freeze({ key, label, group, type, defaultVisible, ...extra });

const COLUMNS = Object.freeze([
  // 2.1 — 17 cot nghiep vu
  col('soldAt', 'TGian', BUSINESS, 'datetime', true, { width: 140 }),
  col('branch', 'Cơ sở', BUSINESS, 'branch', true, { width: 70 }),
  col('invoiceCode', 'Mã HĐ', BUSINESS, 'text', true, { width: 110 }),
  col('saleName', 'Sale phụ trách', BUSINESS, 'text', true, { width: 105 }),
  col('customerName', 'Khách', BUSINESS, 'text', true, { width: 150, wrap: true }),
  col('productCode', 'Mã hàng', BUSINESS, 'text', true, { width: 110 }),
  col('productName', 'Tên hàng', BUSINESS, 'text', true, { width: 205 }),
  col('customerLevel', 'Level khách', BUSINESS, 'text', true, { width: 85 }),
  col('totalCodeQuantity', 'Tổng SL', BUSINESS, 'number', false, { width: 85 }),
  col('fullVat', 'Full VAT', BUSINESS, 'bool', true, { width: 80 }),
  col('netUnitPrice', 'Giá sau giảm', BUSINESS, 'money', true, { width: 95 }),
  col('minimumUnitPrice', 'Giá min', BUSINESS, 'money', true, { width: 110 }),
  col('unitShortfall', 'Chênh/ĐV', BUSINESS, 'money', false, { width: 110 }),
  col('effectiveAmount', 'Tiền chênh / phạt', BUSINESS, 'money', true, { width: 130 }),
  col('effectiveStatus', 'Kết quả', BUSINESS, 'status', true, { width: 95 }),
  col('saleExplanation', 'Sale giải thích', BUSINESS, 'text', true, { width: 170, wrap: true }),
  col('decision', 'Chốt', BUSINESS, 'decision', true, { width: 115 }),
  // 2.2 — cot doi chieu (an mac dinh)
  col('customerCode', 'Mã khách', 'Nhận diện', 'text'),
  col('originalUnitPrice', 'Giá trước giảm', 'Giá bán', 'money'),
  col('unitDiscount', 'Giảm/ĐV', 'Giá bán', 'money'),
  col('cartonSizeHn', 'SL/T HN', 'HN', 'number'),
  col('quantityPriceHn', 'Giá SL HN', 'HN', 'money'),
  col('levelPriceHn', 'Giá Level HN', 'HN', 'money'),
  col('vatHn', 'VAT HN', 'HN', 'money'),
  col('minimumHn', 'Min HN (VAT)', 'HN', 'money'),
  col('freightEligible', 'Khách bao cước', 'Cước và SG', 'bool'),
  col('freightPerUnit', 'Cước/ĐV đã cộng', 'Cước và SG', 'money'),
  col('cartonSizeSg', 'SL/T SG', 'Cước và SG', 'number'),
  col('quantityPriceSg', 'Giá SL SG', 'Cước và SG', 'money'),
  col('levelPriceSg', 'Giá Level SG', 'Cước và SG', 'money'),
  col('vatSg', 'VAT SG', 'Cước và SG', 'money'),
  col('minimumSg', 'Min SG (VAT)', 'Cước và SG', 'money'),
  col('productNoteHn', 'Ghi chú HN', 'Căn cứ', 'text', false, { width: 260, wrap: true }),
  col('productNoteSg', 'Ghi chú SG', 'Căn cứ', 'text', false, { width: 260, wrap: true }),
  col('lineNote', 'Ghi chú mã', 'Căn cứ', 'text', false, { width: 220, wrap: true }),
  col('invoiceNote', 'Ghi chú hóa đơn', 'Căn cứ', 'text', false, { width: 220, wrap: true }),
  col('originalStatus', 'Kết quả gốc', 'Duyệt', 'status'),
  col('originalAmount', 'Tiền chênh gốc', 'Duyệt', 'money'),
  col('decidedBy', 'Người chốt', 'Duyệt', 'text'),
  col('decidedAt', 'Thời gian chốt', 'Duyệt', 'timestamp')
]);

const BUSINESS_KEYS = Object.freeze(COLUMNS.filter(c => c.group === BUSINESS).map(c => c.key));
const BRANCH_LABELS = Object.freeze({ hanoi: 'HN', saigon: 'SG' });
const STATUS_LABELS = Object.freeze({ correct: 'Đúng giá', wrong: 'Sai giá' });
const DECISION_LABELS = Object.freeze({ ok: 'Ok', penalty: 'Phạt' });
const PENDING_LABEL = 'Chưa chốt';

const pad = n => String(n).padStart(2, '0');

/** "2026-10-18T09:05:00" (gio dia phuong Kiot, khong doi mui gio) -> "18/10/2026 09:05". */
function formatLocalDateTime(value) {
  const m = String(value == null ? '' : value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return value == null ? '' : String(value);
  return `${m[3]}/${m[2]}/${m[1]}` + (m[4] ? ` ${m[4]}:${m[5]}` : '');
}

/** ISO timestamptz -> gio Viet Nam "dd/mm/yyyy hh:mm". */
function formatTimestamp(value) {
  if (value == null || value === '') return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const vn = new Date(d.getTime() + 7 * 3600 * 1000);
  return `${pad(vn.getUTCDate())}/${pad(vn.getUTCMonth() + 1)}/${vn.getUTCFullYear()} ${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}`;
}

/**
 * Gia tri xuat file cua 1 o: so (money/number) giu so goc dang Number, thieu = '' (khong ep 0);
 * cac kieu con lai la nhan tieng Viet nhu tren man hinh.
 */
function exportValue(row, column) {
  const value = row[column.key];
  switch (column.type) {
    case 'money':
    case 'number':
      return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? '' : Number(value);
    case 'bool': return value === true ? 'Có' : value === false ? 'Không' : '';
    case 'branch': return BRANCH_LABELS[value] || (value == null ? '' : String(value));
    case 'status': return STATUS_LABELS[value] || '';
    case 'decision': return DECISION_LABELS[value] || PENDING_LABEL;
    case 'datetime': return formatLocalDateTime(value);
    case 'timestamp': return formatTimestamp(value);
    default: return value == null ? '' : String(value);
  }
}

/** Metadata cot cho frontend (an toan de gui JSON). */
function publicColumns() {
  return COLUMNS.map(c => ({ ...c }));
}

module.exports = {
  COLUMNS,
  BUSINESS_KEYS,
  BRANCH_LABELS,
  STATUS_LABELS,
  DECISION_LABELS,
  PENDING_LABEL,
  exportValue,
  formatLocalDateTime,
  formatTimestamp,
  publicColumns
};
