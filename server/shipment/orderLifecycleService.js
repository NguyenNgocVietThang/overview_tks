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

module.exports = { STATUS, STATUS_LABEL, computeStatus, findOrder, listAllOrders };
