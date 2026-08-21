// ==========================================
// USER REPOSITORY — Quản lý tài khoản người dùng qua localUserStore
// (lưu trữ cục bộ tại server/data/users.json để bảo mật tuyệt đối,
// không ghi ra Google Sheet).
// ==========================================
const CONFIG = require('../config');
const sheetsClient = require('../sheets/sheetsClient');
const localUserStore = require('./localUserStore');

const originalGetValues = sheetsClient.getValues;

const USER_COLUMNS = {
  id: 'ID',
  hoTen: 'Họ tên',
  username: 'Tài khoản đăng nhập',
  passwordHash: 'Mật khẩu (bcrypt hash)',
  vaiTro: 'Vai trò',
  coSo: 'Cơ sở phụ trách',
  trangThai: 'Trạng thái tài khoản',
  ngayTao: 'Ngày tạo',
  dangNhapGanNhat: 'Đăng nhập gần nhất',
  email: 'Email',
  soDienThoai: 'Số điện thoại',
  emailKhoiPhuc: 'Email khôi phục',
  sdtKhoiPhuc: 'SĐT khôi phục'
};

const ACTIVE_STATUS = localUserStore.ACTIVE_STATUS;
const PENDING_STATUS = localUserStore.PENDING_STATUS;
const LOCKED_STATUS = localUserStore.LOCKED_STATUS;

const ROLES = localUserStore.ROLES;

const INTERNAL_ROLES = Object.freeze([
  ROLES.QUAN_LY,
  ROLES.KE_TOAN,
  ROLES.TRUONG_KHO,
  ROLES.TRO_LY,
  ROLES.LAI_XE
]);

function buildColumnIndex(headers) {
  const index = {};
  Object.entries(USER_COLUMNS).forEach(([key, headerName]) => {
    index[key] = headers.findIndex(header => String(header || '').trim() === headerName);
  });
  return index;
}

function cell(row, colIndex) {
  return colIndex >= 0 && colIndex < row.length ? row[colIndex] : undefined;
}

function normalizeUsername(raw) {
  return String(raw || '').trim().toLowerCase();
}

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

function normalizePhone(raw) {
  return localUserStore.normalizePhone(raw);
}

function rowToUser(row, colIndex) {
  return {
    id: String(cell(row, colIndex.id) || ''),
    hoTen: String(cell(row, colIndex.hoTen) || ''),
    username: String(cell(row, colIndex.username) || '').trim(),
    passwordHash: String(cell(row, colIndex.passwordHash) || ''),
    vaiTro: String(cell(row, colIndex.vaiTro) || ''),
    coSo: String(cell(row, colIndex.coSo) || ''),
    trangThai: String(cell(row, colIndex.trangThai) || ''),
    email: String(cell(row, colIndex.email) || '').trim(),
    soDienThoai: String(cell(row, colIndex.soDienThoai) || '').trim(),
    emailKhoiPhuc: String(cell(row, colIndex.emailKhoiPhuc) || '').trim(),
    sdtKhoiPhuc: String(cell(row, colIndex.sdtKhoiPhuc) || '').trim()
  };
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
 * Trả về null nếu không tìm thấy hoặc tài khoản đã bị khóa.
 */
async function findActiveUserByUsername(username) {
  const target = normalizeUsername(username);
  const targetPhone = normalizePhone(username);
  if (!target) return null;
  const users = await getAllUsers();
  const match = users.find(user => {
    if (user.trangThai !== ACTIVE_STATUS) return false;
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
  PENDING_STATUS,
  LOCKED_STATUS,
  USER_COLUMNS,
  HARDCODED_ADMINS: localUserStore.HARDCODED_ADMINS,
  isHardcodedAdmin: localUserStore.isHardcodedAdmin,
  getAllUsers,
  findActiveUserByUsername,
  findUserByUsername,
  findUserByEmail,
  findUserByPhone,
  findUserByIdentifier,
  findUserById,
  normalizePhone
};
