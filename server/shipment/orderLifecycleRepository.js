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
const historyClient = require('../sheets/orderLifecycleHistoryClient');

// Ma nhanh dung cho _branch/API branch filter — RIENG cho tinh nang nay,
// KHONG dung BRANCHES.HANOI/SAIGON ('Hà Nội'/'Sài Gòn') cua branch/branches.js
// vi day chi la nhan tab nguon, khong phai co so dang nhap cua tai khoan.
const LIFECYCLE_BRANCH = Object.freeze({ HN: 'HN', SG: 'SG' });

const SCHEMA = {
  headers: [
    'Mã đơn hàng', 'Nhân viên bán hàng', 'Khách hàng', 'Sale gửi đơn cho kế toán', 'Kế toán duyệt đơn',
    'Lái xe', 'Tài xế gửi xác nhận giao hàng', 'Kế toán duyệt giao hàng', 'Xác nhận đã giao/khách ký nhận',
    'Ship nhận đơn', 'Đơn đã ký nhận'
  ],
  fieldKeys: [
    'orderCode', 'saleName', 'customerName', 'saleSentAt', 'accountantApprovedOrderAt',
    'driverName', 'driverConfirmedDeliveryAt', 'accountantApprovedDeliveryAt', 'deliveryConfirmedAt',
    'shipReceivedAt', 'orderSignedAt'
  ]
};

// Schema tab "Lich su cap nhat" — do CHINH SERVER tao/ghi (ngoai le duy nhat
// trong module nay, xem orderLifecycleHistoryClient.js).
const HISTORY_SCHEMA = {
  headers: [
    'Mã lịch sử', 'Mã đơn hàng', 'Mã trạng thái', 'Trạng thái mới',
    'Người thực hiện', 'Vai trò', 'Thời gian cập nhật', 'Ghi chú', 'Nội dung cập nhật'
  ],
  fieldKeys: [
    'history_id', 'order_code', 'to_status_code', 'to_status_label',
    'changed_by', 'changed_by_role', 'changed_at', 'note', 'message'
  ]
};

function rowToObject(row, fieldKeys) {
  const obj = {};
  fieldKeys.forEach((key, i) => { obj[key] = row[i] !== undefined ? row[i] : ''; });
  return obj;
}

function generateId(prefix) {
  const hex = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${prefix}-${Date.now()}-${hex}`;
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

/**
 * Doc toan bo tab "Lich su cap nhat" (moi dong = 1 lan ghi de trang thai).
 * FAIL-SOFT VOI MOI LOI (thieu ORDER_LIFECYCLE_SPREADSHEET_ID, tab chua duoc
 * tao boi setupOrderLifecycleHistorySheet.js, service account chua duoc cap
 * quyen Editor, Google API tam thoi loi...) -> tra ve mang rong thay vi throw.
 * Day la tinh nang BO SUNG (ghi de thu cong) — khong duoc phep lam hong man
 * hinh tra cuu vong doi don hang hien co (GET /api/shipment/lifecycle) von
 * hoat dong tot truoc khi tinh nang nay ton tai.
 */
async function readOverrideHistory() {
  let values;
  try {
    values = await historyClient.getValues(CONFIG.ORDER_LIFECYCLE_SHEET_HISTORY);
  } catch (err) {
    console.error('=== CANH BAO: Khong doc duoc tab "Lich su cap nhat" (bo qua override) ===');
    console.error(err.message);
    console.error('==========================================================================');
    return [];
  }
  if (!values || values.length === 0) return [];
  return values.slice(1)
    .filter(row => row.some(cell => cell !== '' && cell !== undefined))
    .map(row => rowToObject(row, HISTORY_SCHEMA.fieldKeys));
}

/**
 * Ghi 1 dong ghi de trang thai moi vao tab "Lich su cap nhat".
 * @param {{order_code, to_status_code, to_status_label, changed_by,
 *          changed_by_role, note, message}} entry
 * @returns {Promise<object>} Dong da ghi (kem history_id, changed_at)
 */
async function appendOverride(entry) {
  const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  const full = {
    history_id: generateId('OVR'),
    order_code: entry.order_code,
    to_status_code: entry.to_status_code,
    to_status_label: entry.to_status_label,
    changed_by: entry.changed_by,
    changed_by_role: entry.changed_by_role,
    changed_at: now,
    note: entry.note || '',
    message: entry.message
  };
  const row = HISTORY_SCHEMA.fieldKeys.map(key => full[key]);
  await historyClient.appendRow(CONFIG.ORDER_LIFECYCLE_SHEET_HISTORY, row);
  return full;
}

module.exports = {
  LIFECYCLE_BRANCH,
  SCHEMA_HEADERS: SCHEMA.headers,
  SCHEMA_FIELD_KEYS: SCHEMA.fieldKeys,
  HISTORY_SCHEMA_HEADERS: HISTORY_SCHEMA.headers,
  HISTORY_SCHEMA_FIELD_KEYS: HISTORY_SCHEMA.fieldKeys,
  rowToObject,
  readAll,
  readOverrideHistory,
  appendOverride
};
