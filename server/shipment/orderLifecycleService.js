// ==========================================
// ORDER LIFECYCLE SERVICE — suy ra trang thai tom tat 4 muc tu 8 cot sheet
// "Vong doi don hang", theo dung dac ta muc 4 cua spec:
// docs/superpowers/specs/2026-09-04-order-lifecycle-status-lookup.md
// ==========================================
'use strict';

const repo = require('./orderLifecycleRepository');

const STATUS = Object.freeze({
  NOT_SENT: 'NOT_SENT',
  SENT_TO_ACCOUNTANT: 'SENT_TO_ACCOUNTANT',
  DELIVERING: 'DELIVERING',
  DELIVERED: 'DELIVERED'
});

const STATUS_LABEL = Object.freeze({
  [STATUS.NOT_SENT]: 'Đơn chưa gửi kế toán',
  [STATUS.SENT_TO_ACCOUNTANT]: 'Đơn đã gửi kế toán',
  [STATUS.DELIVERING]: 'Đơn đang được giao',
  [STATUS.DELIVERED]: 'Đơn đã giao thành công'
});

// Nhan TEN COT chinh xac (khac STATUS_LABEL la cau mo ta) — dung cho bang tra
// cuu nhieu ma o tab "Tong quan" (yeu cau: "trang thai (tuong ung ten cot)").
// Dung hang so co dinh theo SCHEMA_HEADERS, KHONG doc header that tu sheet vi
// tab HN/SG co the ghi khac chu (da xac minh: tab SG ghi "Ke toan duyet" thay
// vi "Ke toan duyet don" o cung vi tri cot) — dam bao nhan luon nhat quan.
const STATUS_COLUMN_LABEL = Object.freeze({
  [STATUS.NOT_SENT]: null,
  [STATUS.SENT_TO_ACCOUNTANT]: 'Sale gửi đơn cho kế toán',
  [STATUS.DELIVERING]: 'Tài xế gửi xác nhận giao hàng',
  [STATUS.DELIVERED]: 'Xác nhận đã giao/khách kí nhận'
});

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

/**
 * Trang thai hien tai = muc cao nhat ma cot moc tuong ung da co gia tri, xet
 * uu tien H > F > C — BO QUA D va G (chi theo sau C/F trong quy trinh that,
 * khong tao trang thai rieng). Edge case phong thu: D/G co gia tri nhung C/F
 * tuong ung trong (du lieu bot loi) van ap dung bang nay, KHONG doc D/G.
 */
function computeStatus(record) {
  if (record && hasValue(record.deliveryConfirmedAt)) {
    return { code: STATUS.DELIVERED, label: STATUS_LABEL[STATUS.DELIVERED], actor: null, at: record.deliveryConfirmedAt };
  }
  if (record && hasValue(record.driverConfirmedDeliveryAt)) {
    return {
      code: STATUS.DELIVERING,
      label: STATUS_LABEL[STATUS.DELIVERING],
      actor: record.driverName || '',
      at: record.driverConfirmedDeliveryAt
    };
  }
  if (record && hasValue(record.saleSentAt)) {
    return {
      code: STATUS.SENT_TO_ACCOUNTANT,
      label: STATUS_LABEL[STATUS.SENT_TO_ACCOUNTANT],
      actor: record.saleName || '',
      at: record.saleSentAt
    };
  }
  return { code: STATUS.NOT_SENT, label: STATUS_LABEL[STATUS.NOT_SENT], actor: null, at: null };
}

function normalizeCode(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

/**
 * Chi tiet day du 8 cot, y het 1 hang trong Google Sheet (o trong hien "—" do
 * client dam nhiem hien thi, o day chi tra chuoi rong nguyen ban).
 */
function toDetail(record) {
  return {
    orderCode: record.orderCode,
    saleName: record.saleName,
    customerName: record.customerName,
    saleSentAt: record.saleSentAt,
    accountantApprovedOrderAt: record.accountantApprovedOrderAt,
    driverName: record.driverName,
    driverConfirmedDeliveryAt: record.driverConfirmedDeliveryAt,
    accountantApprovedDeliveryAt: record.accountantApprovedDeliveryAt,
    deliveryConfirmedAt: record.deliveryConfirmedAt
  };
}

/**
 * Tra cuu 1 don theo ma (trim, khong phan biet hoa/thuong). Ma khong ton tai
 * trong ca 2 tab -> found:false + summary "Đơn chưa gửi kế toán" (KHONG loi
 * 404 kho hieu, dung theo yeu cau Success Criteria cua spec).
 */
async function findOrder(orderCode) {
  const target = normalizeCode(orderCode);
  if (!target) {
    return { found: false, summary: computeStatus(null) };
  }
  const records = await repo.readAll();
  const record = records.find(r => normalizeCode(r.orderCode) === target);
  if (!record) {
    return { found: false, summary: computeStatus(null) };
  }
  return {
    found: true,
    branch: record._branch,
    summary: computeStatus(record),
    detail: toDetail(record)
  };
}

/**
 * Toan bo don tu ca 2 tab, giu nguyen thu tu hang trong sheet. branchFilter
 * tuy chon ('HN'|'SG') tu query string.
 */
async function listAllOrders(branchFilter) {
  const records = await repo.readAll();
  const filtered = branchFilter ? records.filter(r => r._branch === branchFilter) : records;
  return filtered.map(record => Object.assign(toDetail(record), {
    branch: record._branch,
    summary: computeStatus(record)
  }));
}

const MAX_LOOKUP_CODES = 50;

function validateLookupCodes(rawCodes) {
  if (!Array.isArray(rawCodes)) {
    const err = new Error('Danh sách mã đơn hàng không hợp lệ.');
    err.statusCode = 400;
    err.code = 'INVALID_CODES';
    throw err;
  }
  if (rawCodes.length > MAX_LOOKUP_CODES) {
    const err = new Error(`Chỉ được tra cứu tối đa ${MAX_LOOKUP_CODES} mã đơn hàng mỗi lần.`);
    err.statusCode = 400;
    err.code = 'TOO_MANY_CODES';
    throw err;
  }
  const seen = new Set();
  const codes = [];
  rawCodes.forEach(rawCode => {
    if (typeof rawCode !== 'string' && typeof rawCode !== 'number') {
      const err = new Error('Mỗi mã đơn hàng phải là chuỗi hoặc số.');
      err.statusCode = 400;
      err.code = 'INVALID_CODE';
      throw err;
    }
    const code = String(rawCode).trim();
    if (!code) return;
    if (code.length > 100) {
      const err = new Error('Mã đơn hàng không được dài quá 100 ký tự.');
      err.statusCode = 400;
      err.code = 'INVALID_CODE';
      throw err;
    }
    const key = normalizeCode(code);
    if (!seen.has(key)) {
      seen.add(key);
      codes.push({ code, key });
    }
  });
  return codes;
}

/**
 * Tra cuu NHIEU ma don cung luc (tab "Tong quan"). Voi moi ma: tra ve sale,
 * khach hang, TEN COT co thoi gian moi nhat (bo qua 2 cot ke toan duyet —
 * dung STATUS_COLUMN_LABEL, khong tao trang thai rieng cho D/G, giu dung logic
 * computeStatus da co) + thoi gian tuong ung. Ma khong ton tai -> found:false.
 */
async function findOrdersBulk(rawCodes) {
  const codes = validateLookupCodes(rawCodes);
  if (!codes.length) return [];

  const records = await repo.readAll();
  const byKey = new Map();
  records.forEach(record => {
    const key = normalizeCode(record.orderCode);
    if (!byKey.has(key)) byKey.set(key, record);
  });

  return codes.map(({ code, key }) => {
    const record = byKey.get(key);
    if (!record) return { code, found: false };
    const summary = computeStatus(record);
    return {
      code,
      found: true,
      saleName: record.saleName || '',
      customerName: record.customerName || '',
      statusLabel: STATUS_COLUMN_LABEL[summary.code],
      at: summary.at
    };
  });
}

module.exports = {
  STATUS, STATUS_LABEL, STATUS_COLUMN_LABEL,
  computeStatus, findOrder, listAllOrders, findOrdersBulk,
  MAX_LOOKUP_CODES
};
