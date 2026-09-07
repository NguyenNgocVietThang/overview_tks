// ==========================================
// USER REPOSITORY — Quản lý tài khoản người dùng qua localUserStore (cache
// cục bộ tại server/data/users.json, đồng bộ hai chiều với Google Sheets —
// xem đầu file localUserStore.js).
// ==========================================
const CONFIG = require('../config');
const sheetsClient = require('../sheets/sheetsClient');
const localUserStore = require('./localUserStore');
const { USER_COLUMNS, buildColumnIndex, rowToUser } = require('./userSheetColumns');

const originalGetValues = sheetsClient.getValues;

const ACTIVE_STATUS = localUserStore.ACTIVE_STATUS;
const INACTIVE_STATUS = localUserStore.INACTIVE_STATUS;
const PENDING_STATUS = localUserStore.PENDING_STATUS;
const LOCKED_STATUS = localUserStore.LOCKED_STATUS;

const ROLES = localUserStore.ROLES;

const INTERNAL_ROLES = Object.freeze([
  ROLES.QUAN_LY,
  ROLES.KE_TOAN,
  ROLES.TRUONG_KHO,
  ROLES.TRO_LY,
  ROLES.LAI_XE,
  ROLES.NHAN_VIEN_KHO,
  ROLES.NHAN_VIEN_SALE,
  ROLES.NHAN_VIEN_MUA_HANG
]);

function normalizeUsername(raw) {
  return String(raw || '').trim().toLowerCase();
}

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

function normalizePhone(raw) {
  return localUserStore.normalizePhone(raw);
}

/**
 * Đọc toàn bộ user từ localUserStore.
 * Hỗ trợ mock sheetsClient.getValues trong unit test.
 */
async function getAllUsers() {
  if (sheetsClient && sheetsClient.getValues !== originalGetValues) {
    const rawRows = await sheetsClient.getValues(CONFIG.SHEET_USERS);
    if (!rawRows || !rawRows.length) return [];
    const [headers, ...rows] = rawRows;
    const colIndex = buildColumnIndex(headers);
    return rows
      .filter(row => row.some(cellValue => cellValue !== '' && cellValue !== undefined))
      .map(row => rowToUser(row, colIndex));
  }

  return localUserStore.getAllUsers();
}

/**
 * Tìm user theo username, email hoặc số điện thoại (không phân biệt hoa/thường, trim khoảng trắng).
 * Cho phép tài khoản Đang hoạt động và Không hoạt động. Chặn tài khoản bị Khóa.
 */
async function findActiveUserByUsername(username) {
  const target = normalizeUsername(username);
  const targetPhone = normalizePhone(username);
  if (!target) return null;
  const users = await getAllUsers();
  const match = users.find(user => {
    if (user.trangThai === LOCKED_STATUS || user.isDeleted || user.trangThai === 'Đã xóa') return false;
    if (normalizeUsername(user.username) === target) return true;
    if (user.email && normalizeEmail(user.email) === target) return true;
    if (targetPhone && user.soDienThoai && normalizePhone(user.soDienThoai) === targetPhone) return true;
    if (targetPhone && normalizePhone(user.username) === targetPhone) return true;
    return false;
  });
  return match || null;
}

async function findUserByUsername(username) {
  const target = normalizeUsername(username);
  const targetPhone = normalizePhone(username);
  if (!target) return null;
  const users = await getAllUsers();
  return users.find(user => {
    if (normalizeUsername(user.username) === target) return true;
    if (user.email && normalizeEmail(user.email) === target) return true;
    if (targetPhone && user.soDienThoai && normalizePhone(user.soDienThoai) === targetPhone) return true;
    if (targetPhone && normalizePhone(user.username) === targetPhone) return true;
    return false;
  }) || null;
}

/**
 * Tìm user theo ID (không lọc trạng thái).
 */
async function findUserById(id) {
  const target = String(id || '').trim();
  if (!target) return null;
  const users = await getAllUsers();
  return users.find(user => String(user.id) === target) || null;
}

/**
 * Tìm user theo email (không phân biệt hoa/thường, trim khoảng trắng).
 */
async function findUserByEmail(email) {
  const target = normalizeEmail(email);
  if (!target) return null;
  const users = await getAllUsers();
  return users.find(user => normalizeEmail(user.email) === target || normalizeEmail(user.username) === target) || null;
}

/**
 * Tìm user theo số điện thoại (chính hoặc khôi phục).
 */
async function findUserByPhone(phone) {
  const target = normalizePhone(phone);
  if (!target) return null;
  const users = await getAllUsers();
  return users.find(user =>
    normalizePhone(user.soDienThoai) === target ||
    normalizePhone(user.username) === target ||
    normalizePhone(user.sdtKhoiPhuc) === target
  ) || null;
}

/**
 * Tìm user bằng định danh bất kỳ (username, email, SĐT chính, email khôi phục, SĐT khôi phục).
 */
async function findUserByIdentifier(identifier) {
  const target = normalizeUsername(identifier);
  const targetPhone = normalizePhone(identifier);
  if (!target) return null;
  const users = await getAllUsers();
  return users.find(user => {
    if (normalizeUsername(user.username) === target) return true;
    if (user.email && normalizeEmail(user.email) === target) return true;
    if (user.emailKhoiPhuc && normalizeEmail(user.emailKhoiPhuc) === target) return true;
    if (targetPhone) {
      if (user.soDienThoai && normalizePhone(user.soDienThoai) === targetPhone) return true;
      if (user.sdtKhoiPhuc && normalizePhone(user.sdtKhoiPhuc) === targetPhone) return true;
      if (normalizePhone(user.username) === targetPhone) return true;
    }
    return false;
  }) || null;
}

module.exports = {
  ROLES,
  INTERNAL_ROLES,
  ACTIVE_STATUS,
  INACTIVE_STATUS,
  PENDING_STATUS,
  LOCKED_STATUS,
  USER_COLUMNS,
  HARDCODED_ADMINS: localUserStore.HARDCODED_ADMINS,
  isHardcodedAdmin: localUserStore.isHardcodedAdmin,
  isProtectedSuperAdmin: localUserStore.isProtectedSuperAdmin,
  getAllUsers,
  findActiveUserByUsername,
  findUserByUsername,
  findUserByEmail,
  findUserByPhone,
  findUserByIdentifier,
  findUserById,
  normalizePhone
};
