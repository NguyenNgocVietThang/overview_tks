'use strict';
// Kiem tra/chuan hoa du lieu yeu cau chuyen tien — dung chung cho API bot va API web.

const STATUSES = Object.freeze(['CHO_DUYET', 'DA_DUYET', 'DA_CHUYEN', 'DA_HUY']);
const STATUS_LABELS = Object.freeze({
  CHO_DUYET: 'Chờ duyệt',
  DA_DUYET: 'Đã duyệt',
  DA_CHUYEN: 'Đã chuyển',
  DA_HUY: 'Đã hủy'
});
const FIELD_LABELS = Object.freeze({
  customerName: 'Tên khách',
  amountVnd: 'Số tiền',
  bankAccount: 'Số tài khoản',
  accountType: 'Loại',
  accountHolder: 'Chủ tài khoản',
  bankBin: 'Ngân hàng',
  note: 'Ghi chú sale',
  accountantNote: 'Ghi chú kế toán'
});
const TRANSFER_FIELDS = Object.freeze(['customerName', 'amountVnd', 'bankAccount', 'accountType', 'accountHolder', 'bankBin', 'note']);

function invalid(field, message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'INVALID';
  error.field = field;
  return error;
}

function text(value, field, { max, required = true } = {}) {
  if (value == null) value = '';
  if (typeof value !== 'string') throw invalid(field, `${FIELD_LABELS[field] || field} phải là chữ.`);
  // Bo ky tu dieu khien (tranh chen dong/escape) va gom khoang trang.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (required && !cleaned) throw invalid(field, `Thiếu ${FIELD_LABELS[field] || field}.`);
  if (cleaned.length > max) throw invalid(field, `${FIELD_LABELS[field] || field} dài quá ${max} ký tự.`);
  return cleaned;
}

function amount(value) {
  const raw = typeof value === 'string' ? value.replace(/[\s.,]/g, '') : value;
  const number = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
  if (!Number.isSafeInteger(number) || number <= 0 || number >= 1e12) {
    throw invalid('amountVnd', 'Số tiền phải là số nguyên dương (VND).');
  }
  return number;
}

function bankAccount(value) {
  if (typeof value !== 'string') throw invalid('bankAccount', 'Số tài khoản phải là chuỗi ký tự.');
  const cleaned = value.replace(/[\s.\-]/g, '');
  if (!/^[0-9A-Za-z]{4,50}$/.test(cleaned)) throw invalid('bankAccount', 'Số tài khoản chỉ gồm chữ số/chữ cái, 4–50 ký tự.');
  return cleaned;
}

function bankBin(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{6}$/.test(value)) throw invalid('bankBin', 'Mã ngân hàng (BIN) không hợp lệ.');
  return value;
}

function accountType(value) {
  const type = value == null || value === '' ? 'ACCOUNT' : value;
  if (type !== 'ACCOUNT' && type !== 'CARD') throw invalid('accountType', 'Loại tài khoản không hợp lệ.');
  return type;
}

const NORMALIZERS = Object.freeze({
  customerName: v => text(v, 'customerName', { max: 150 }),
  amountVnd: amount,
  bankAccount,
  accountType,
  accountHolder: v => text(v, 'accountHolder', { max: 150 }),
  bankBin,
  note: v => text(v, 'note', { max: 500, required: false }),
  accountantNote: v => text(v, 'accountantNote', { max: 500, required: false })
});

/** Chuan hoa cac truong co mat trong `patch` (bo qua truong khong biet). */
function normalizePatch(patch, allowed) {
  if (!patch || typeof patch !== 'object') throw invalid(null, 'Dữ liệu không hợp lệ.');
  const result = {};
  for (const key of allowed) {
    if (Object.hasOwn(patch, key)) result[key] = NORMALIZERS[key](patch[key]);
  }
  return result;
}

function telegramId(value) {
  const id = String(value == null ? '' : value).trim();
  if (!/^[1-9]\d{0,19}$/.test(id)) throw invalid('telegramId', 'Telegram ID không hợp lệ.');
  return id;
}

function requestCode(value) {
  if (typeof value !== 'string' || !/^YC-\d{8}-\d{4,}$/.test(value)) throw invalid('requestCode', 'Mã yêu cầu không hợp lệ.');
  return value;
}

function reason(value, { required }) {
  return text(value, 'reason', { max: 300, required });
}

module.exports = {
  STATUSES,
  STATUS_LABELS,
  FIELD_LABELS,
  TRANSFER_FIELDS,
  invalid,
  normalizePatch,
  telegramId,
  requestCode,
  reason,
  text
};
