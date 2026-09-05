// ==========================================
// ORDER LIFECYCLE REPOSITORY — doc RIENG spreadsheet "Vong doi don hang",
// 2 tab DonHang_HN/DonHang_SG, gop thanh 1 danh sach kem _branch.
//
// Theo khuon hrLeaveRepository.js: SCHEMA anh xa header Tieng Viet <->
// fieldKeys, rowToObject, readAll bo hang trong. KHONG co ham ghi — day la
// nguon du lieu READ-ONLY (bot Telegram/Apps Script ben ngoai repo nay ghi).
// ==========================================
'use strict';

const CONFIG = require('../config');
const client = require('../sheets/orderLifecycleSheetsClient');

// Ma nhanh dung cho _branch/API branch filter — RIENG cho tinh nang nay,
// KHONG dung BRANCHES.HANOI/SAIGON ('Hà Nội'/'Sài Gòn') cua branch/branches.js
// vi day chi la nhan tab nguon, khong phai co so dang nhap cua tai khoan.
const LIFECYCLE_BRANCH = Object.freeze({ HN: 'HN', SG: 'SG' });

const SCHEMA = {
  headers: [
    'Mã đơn hàng', 'Nhân viên bán hàng', 'Khách hàng', 'Sale gửi đơn cho kế toán', 'Kế toán duyệt đơn',
    'Lái xe', 'Tài xế gửi xác nhận giao hàng', 'Kế toán duyệt giao hàng', 'Xác nhận đã giao/khách ký nhận'
  ],
  fieldKeys: [
    'orderCode', 'saleName', 'customerName', 'saleSentAt', 'accountantApprovedOrderAt',
    'driverName', 'driverConfirmedDeliveryAt', 'accountantApprovedDeliveryAt', 'deliveryConfirmedAt'
  ]
};

function rowToObject(row, fieldKeys) {
  const obj = {};
  fieldKeys.forEach((key, i) => { obj[key] = row[i] !== undefined ? row[i] : ''; });
  return obj;
}

async function readTab(sheetName, branch) {
  const values = await client.getValues(sheetName);
  if (!values || values.length === 0) return [];
  const dataRows = values.slice(1);
  return dataRows
    .filter(row => row.some(cell => cell !== '' && cell !== undefined))
    .map(row => Object.assign(rowToObject(row, SCHEMA.fieldKeys), { _branch: branch }));
}

/**
 * Doc ca 2 tab (HN + SG), gop thanh 1 danh sach duy nhat. Moi ma don chi ton
 * tai o 1 tab nen khong can doan chi nhanh theo cookie dang nhap.
 */
async function readAll() {
  const [hnRows, sgRows] = await Promise.all([
    readTab(CONFIG.ORDER_LIFECYCLE_SHEET_HN, LIFECYCLE_BRANCH.HN),
    readTab(CONFIG.ORDER_LIFECYCLE_SHEET_SG, LIFECYCLE_BRANCH.SG)
  ]);
  return [...hnRows, ...sgRows];
}

module.exports = {
  LIFECYCLE_BRANCH,
  SCHEMA_HEADERS: SCHEMA.headers,
  SCHEMA_FIELD_KEYS: SCHEMA.fieldKeys,
  rowToObject,
  readAll
};
