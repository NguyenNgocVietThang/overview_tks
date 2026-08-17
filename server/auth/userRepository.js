// ==========================================
// USER REPOSITORY — doc tab "Users" trong spreadsheet KiotViet hien co.
// CHI DOC (giong sheetsClient.getValues) — tao/sua tai khoan lam qua
// server/scripts/setupUsersSheet.js, khong qua duong chay web runtime.
// ==========================================
const CONFIG = require('../config');
const sheetsClient = require('../sheets/sheetsClient');

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
  // Them sau cung (cot cuoi) de khong lam lech vi tri cac cot cu — xem
  // server/auth/userWriteRepository.js va server/scripts/setupUsersSheet.js
  // ve viec tu va header nay cho sheet Users da ton tai truoc do.
  email: 'Email'
};

const ACTIVE_STATUS = 'Đang hoạt động';
// Trang thai tam thoi cho tai khoan tu dang ky qua Google — xem
// server/auth/userWriteRepository.js. Chi ACTIVE_STATUS moi dang nhap duoc
// (ca password lan Google), nen trang thai nay tu dong bi tu choi cho toi
// khi admin duyet (npm run setup:users-sheet -- --unlock).
const PENDING_STATUS = 'Chờ duyệt';

// Vai tro web. INTERNAL_ROLES la ranh gioi cho Bao cao tong hop; KHACH chi
// duoc tra cuu van chuyen.
const ROLES = Object.freeze({
  QUAN_LY: 'Quản lý',
  KE_TOAN: 'Kế toán',
  TRUONG_KHO: 'Trưởng kho',
  TRO_LY: 'Trợ lý',
  KHACH: 'Khách'
});

const INTERNAL_ROLES = Object.freeze([
  ROLES.QUAN_LY,
  ROLES.KE_TOAN,
  ROLES.TRUONG_KHO,
  ROLES.TRO_LY
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

function rowToUser(row, colIndex) {
  return {
    id: String(cell(row, colIndex.id) || ''),
    hoTen: String(cell(row, colIndex.hoTen) || ''),
    username: String(cell(row, colIndex.username) || '').trim(),
    passwordHash: String(cell(row, colIndex.passwordHash) || ''),
    vaiTro: String(cell(row, colIndex.vaiTro) || ''),
    coSo: String(cell(row, colIndex.coSo) || ''),
    trangThai: String(cell(row, colIndex.trangThai) || ''),
    email: String(cell(row, colIndex.email) || '').trim()
  };
}

/**
 * Doc toan bo tab Users va tra ve danh sach user da parse (khong loc trang thai).
 * Sheet rong/chua ton tai -> tra ve mang rong (khong throw), de setup:users-sheet
 * la buoc bat buoc truoc khi dang nhap hoat dong duoc.
 */
async function getAllUsers() {
  const rawRows = await sheetsClient.getValues(CONFIG.SHEET_USERS);
  if (!rawRows.length) return [];
  const [headers, ...rows] = rawRows;
  const colIndex = buildColumnIndex(headers);
  return rows
    .filter(row => row.some(cellValue => cellValue !== '' && cellValue !== undefined))
    .map(row => rowToUser(row, colIndex));
}

/**
 * Tim user theo username (khong phan biet hoa/thuong, trim khoang trang).
 * Tra ve null neu khong tim thay hoac tai khoan da bi khoa.
 */
async function findActiveUserByUsername(username) {
  const target = normalizeUsername(username);
  if (!target) return null;
  const users = await getAllUsers();
  const match = users.find(user => normalizeUsername(user.username) === target);
  if (!match || match.trangThai !== ACTIVE_STATUS) return null;
  return match;
}

async function findUserByUsername(username) {
  const target = normalizeUsername(username);
  if (!target) return null;
  const users = await getAllUsers();
  return users.find(user => normalizeUsername(user.username) === target) || null;
}

/**
 * Tim user theo email (khong phan biet hoa/thuong, trim khoang trang), dung
 * cho dang nhap Google — POST /api/auth/google trong authRoutes.js.
 * Khac findActiveUserByUsername: tra ve user o BAT KY trang thai nao (ke ca
 * "Chờ duyệt"/"Khóa") de route tu quyet dinh thong bao phu hop, thay vi am
 * tham tra ve null nhu truong hop khong tim thay.
 */
async function findUserByEmail(email) {
  const target = normalizeEmail(email);
  if (!target) return null;
  const users = await getAllUsers();
  return users.find(user => normalizeEmail(user.email) === target) || null;
}

module.exports = {
  ROLES,
  INTERNAL_ROLES,
  ACTIVE_STATUS,
  PENDING_STATUS,
  USER_COLUMNS,
  getAllUsers,
  findActiveUserByUsername,
  findUserByUsername,
  findUserByEmail
};
