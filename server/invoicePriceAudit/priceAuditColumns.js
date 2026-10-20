'use strict';

// Danh muc cot DUY NHAT cua bang "Kiem tra gia ban" (tab Hoa don): 18 cot nghiep vu dung thu tu muc 2.1
// (16 hien mac dinh) roi cac cot doi chieu muc 2.2. Dung chung cho:
//   - API GET / (route gan `columns` de frontend dung thead tu day),
//   - GET /export/fields + /export (whitelist cot, nhan, kieu o Excel/HTML).
// type: datetime | branch | text | money | number | bool | status | decision | timestamp
//   money/number: chuoi decimal (NUMERIC) hoac null; null = thieu gia ("—"), 0 = 0đ.

const BUSINESS = 'Nghiệp vụ';

const col = (key, label, group, type, defaultVisible = false, extra = {}) =>
  Object.freeze({ key, label, group, type, defaultVisible, ...extra });

const COLUMNS = Object.freeze([
  // 2.1 — 18 cot nghiep vu
  col('soldAt', 'Ngày giờ bán', BUSINESS, 'datetime', true, { width: 140 }),
  col('branch', 'Cơ sở', BUSINESS, 'branch', true, { width: 70 }),
  col('invoiceCode', 'Mã hóa đơn', BUSINESS, 'text', true, { width: 130 }),
  col('saleName', 'Sale phụ trách', BUSINESS, 'text', true, { width: 150 }),
  col('customerName', 'Khách hàng', BUSINESS, 'text', true, { width: 200 }),
  col('productCode', 'Mã hàng', BUSINESS, 'text', true, { width: 110 }),
  col('productName', 'Tên hàng', BUSINESS, 'text', true, { width: 220 }),
  col('customerLevel', 'Cấp khách', BUSINESS, 'text', true, { width: 85 }),
  col('quantity', 'SL dòng', BUSINESS, 'number', true, { width: 85 }),
  col('totalCodeQuantity', 'Tổng SL cùng mã', BUSINESS, 'number', false, { width: 110 }),
  col('fullVat', 'Full VAT', BUSINESS, 'bool', true, { width: 80 }),
  col('netUnitPrice', 'Đơn giá sau giảm', BUSINESS, 'money', true, { width: 120 }),
  col('minimumUnitPrice', 'Giá min áp dụng', BUSINESS, 'money', true, { width: 120 }),
  col('unitShortfall', 'Chênh/đơn vị', BUSINESS, 'money', false, { width: 110 }),
  col('effectiveAmount', 'Tiền chênh / phạt', BUSINESS, 'money', true, { width: 130 }),
  col('effectiveStatus', 'Kết quả', BUSINESS, 'status', true, { width: 95 }),
  col('saleExplanation', 'Sale giải thích', BUSINESS, 'text', true, { width: 260, wrap: true }),
  col('decision', 'Chốt', BUSINESS, 'decision', true, { width: 120 }),
  // 2.2 — cot doi chieu (an mac dinh)
  col('customerCode', 'Mã khách', 'Nhận diện', 'text'),
  col('customerEmail', 'Email cấp giá lúc quét', 'Nhận diện', 'text'),
  col('sourceLineNo', 'Dòng hóa đơn', 'Nhận diện', 'number'),
  col('originalUnitPrice', 'Đơn giá trước giảm', 'Giá bán', 'money'),
  col('unitDiscount', 'Giảm/đơn vị', 'Giá bán', 'money'),
  col('cartonSizeHn', 'Chiếc/thùng HN', 'HN', 'number'),
  col('quantityPriceHn', 'Giá SL HN', 'HN', 'money'),
  col('levelPriceHn', 'Giá cấp HN', 'HN', 'money'),
  col('vatHn', 'VAT HN đã cộng', 'HN', 'money'),
  col('minimumHn', 'Min HN gồm VAT', 'HN', 'money'),
  col('freightEligible', 'Khách bao cước', 'Cước và SG', 'bool'),
  col('freightPerUnit', 'Cước/đơn vị đã cộng', 'Cước và SG', 'money'),
  col('cartonSizeSg', 'Chiếc/thùng SG', 'Cước và SG', 'number'),
  col('quantityPriceSg', 'Giá SL SG', 'Cước và SG', 'money'),
  col('levelPriceSg', 'Giá cấp SG', 'Cước và SG', 'money'),
  col('vatSg', 'VAT SG đã cộng', 'Cước và SG', 'money'),
  col('minimumSg', 'Min SG gồm VAT', 'Cước và SG', 'money'),
  col('winningSource', 'Nguồn giá thắng', 'Căn cứ', 'text'),
  col('reason', 'Lý do', 'Căn cứ', 'text', false, { wrap: true }),
  col('productNoteHn', 'Ghi chú hàng HN', 'Căn cứ', 'text', false, { width: 260, wrap: true }),
  col('productNoteSg', 'Ghi chú hàng SG', 'Căn cứ', 'text', false, { width: 260, wrap: true }),
  col('lineNote', 'Ghi chú dòng', 'Căn cứ', 'text', false, { width: 220, wrap: true }),
  col('invoiceNote', 'Ghi chú hóa đơn', 'Căn cứ', 'text', false, { width: 220, wrap: true }),
  col('originalStatus', 'Kết quả gốc', 'Duyệt', 'status'),
  col('originalAmount', 'Tiền chênh gốc', 'Duyệt', 'money'),
  col('decidedBy', 'Người chốt', 'Duyệt', 'text'),
  col('decidedAt', 'Thời gian chốt', 'Duyệt', 'timestamp'),
  col('capturedAt', 'Ghi nhận lúc', 'Duyệt', 'timestamp')
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
