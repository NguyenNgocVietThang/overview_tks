// ==========================================
// LOCAL USER STORE — Lưu trữ và quản lý tài khoản người dùng cục bộ tại
// server/data/users.json. Đảm bảo an toàn thông tin, không ghi ra Google Sheet.
// Hỗ trợ atomic write, cache in-memory, và kiểm soát đồng thời.
// Hỗ trợ số điện thoại chính, email khôi phục và số điện thoại khôi phục.
// ==========================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DEFAULT_STORE_PATH = path.join(DATA_DIR, 'users.json');

const ACTIVE_STATUS = 'Đang hoạt động';
const LOCKED_STATUS = 'Khóa';
const PENDING_STATUS = 'Chờ duyệt';

const ROLES = Object.freeze({
  QUAN_LY: 'Quản lý',
  KE_TOAN: 'Kế toán',
  TRUONG_KHO: 'Trưởng kho',
  TRO_LY: 'Trợ lý',
  LAI_XE: 'Lái xe',
  KHACH: 'Khách'
});

const HARDCODED_ADMINS = Object.freeze([
  'thangnnv2003@gmail.com',
  'thangnnv2003@gmail',
  'thangnnv2003',
  'admin@tokosi.vn',
  'admin'
]);

function isHardcodedAdmin(identifier) {
  if (!identifier) return false;
  const norm = String(identifier).trim().toLowerCase();
  return HARDCODED_ADMINS.includes(norm);
}

let currentStorePath = DEFAULT_STORE_PATH;
let inMemoryUsers = null;
let isInitialized = false;

function normalize(str) {
  return String(str || '').trim().toLowerCase();
}

function normalizePhone(str) {
  if (!str) return '';
  let clean = String(str).trim().replace(/[^\d+]/g, '');
  if (clean.startsWith('+84')) {
    clean = '0' + clean.slice(3);
  } else if (clean.startsWith('84') && clean.length === 11) {
    clean = '0' + clean.slice(2);
  }
  return clean;
}

function formatDateVN(date = new Date()) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${date.getFullYear()}`;
}

function ensureDataDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Khởi tạo dữ liệu người dùng mặc định ban đầu nếu chưa có file dữ liệu.
 */
function createDefaultUsers() {
  const defaultAdminHash = bcrypt.hashSync('Admin@123', 10);
  const defaultThangHash = bcrypt.hashSync('Thang@2026', 10);
  return [
    {
      id: 'admin-default',
      username: 'admin',
      hoTen: 'Quản trị viên hệ thống',
      email: 'admin@tokosi.vn',
      soDienThoai: '',
      emailKhoiPhuc: '',
      sdtKhoiPhuc: '',
      passwordHash: defaultAdminHash,
      vaiTro: ROLES.QUAN_LY,
      coSo: 'Cả hai',
      trangThai: ACTIVE_STATUS,
      ngayTao: formatDateVN(),
      dangNhapGanNhat: ''
    },
    {
      id: 'c2619c62-e841-486a-9803-48c40ab0a398',
      username: 'thangnnv2003@gmail.com',
      hoTen: 'Nguyễn Ngọc Việt Thắng',
      email: 'thangnnv2003@gmail.com',
      soDienThoai: '',
      emailKhoiPhuc: 'thangnnv2003@gmail.com',
      sdtKhoiPhuc: '0974089295',
      passwordHash: defaultThangHash,
      vaiTro: ROLES.QUAN_LY,
      coSo: 'Cả hai',
      trangThai: ACTIVE_STATUS,
      ngayTao: '01/01/2026',
      dangNhapGanNhat: ''
    }
  ];
}

/**
 * Đảm bảo các tài khoản Admin mặc định (đặc biệt là thangnnv2003@gmail.com)
 * luôn tồn tại trong danh sách và luôn giữ quyền Quản lý + Đang hoạt động.
 */
function ensureHardcodedAdmins(users) {
  if (!Array.isArray(users)) return false;
  let modified = false;

  let thangUser = users.find(u => isHardcodedAdmin(u.email) || isHardcodedAdmin(u.username));
  if (!thangUser) {
    const defaultThangHash = bcrypt.hashSync('Thang@2026', 10);
    thangUser = {
      id: 'c2619c62-e841-486a-9803-48c40ab0a398',
      username: 'thangnnv2003@gmail.com',
      hoTen: 'Nguyễn Ngọc Việt Thắng',
      email: 'thangnnv2003@gmail.com',
      soDienThoai: '',
      emailKhoiPhuc: 'thangnnv2003@gmail.com',
      sdtKhoiPhuc: '0974089295',
      passwordHash: defaultThangHash,
      vaiTro: ROLES.QUAN_LY,
      coSo: 'Cả hai',
      trangThai: ACTIVE_STATUS,
      ngayTao: '01/01/2026',
      dangNhapGanNhat: ''
    };
    users.push(thangUser);
    modified = true;
  }

  for (const u of users) {
    if (isHardcodedAdmin(u.email) || isHardcodedAdmin(u.username)) {
      if (u.vaiTro !== ROLES.QUAN_LY) {
        u.vaiTro = ROLES.QUAN_LY;
        modified = true;
      }
      if (u.trangThai !== ACTIVE_STATUS) {
        u.trangThai = ACTIVE_STATUS;
        modified = true;
      }
    }
  }

  return modified;
}

let lastLoadedMtime = 0;

function loadFromDisk() {
  ensureDataDir(currentStorePath);
  if (fs.existsSync(currentStorePath)) {
    try {
      const stats = fs.statSync(currentStorePath);
      const raw = fs.readFileSync(currentStorePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        inMemoryUsers = parsed;
        const modified = ensureHardcodedAdmins(inMemoryUsers);
        if (modified) {
          saveToDisk(inMemoryUsers);
        }
        lastLoadedMtime = stats.mtimeMs;
        return inMemoryUsers;
      }
    } catch (err) {
      console.error('Lỗi khi đọc file users.json, khởi tạo lại bộ nhớ:', err.message);
    }
  }

  inMemoryUsers = createDefaultUsers();
  saveToDisk(inMemoryUsers);
  return inMemoryUsers;
}

function saveToDisk(users) {
  ensureDataDir(currentStorePath);
  const tempPath = `${currentStorePath}.${Date.now()}.${Math.random().toString(36).substring(2, 7)}.tmp`;
  const data = JSON.stringify(users, null, 2);
  fs.writeFileSync(tempPath, data, 'utf8');
  fs.renameSync(tempPath, currentStorePath);
  try {
    lastLoadedMtime = fs.statSync(currentStorePath).mtimeMs;
  } catch (e) {}
}

function initStore(customPath) {
  if (customPath) {
    currentStorePath = customPath;
  }
  loadFromDisk();
  isInitialized = true;
}

function ensureLoaded() {
  if (!isInitialized || !inMemoryUsers) {
    initStore();
    return inMemoryUsers;
  }
  // Kiểm tra nếu file users.json trên đĩa bị sửa đổi từ bên ngoài thì reload vào RAM
  try {
    if (fs.existsSync(currentStorePath)) {
      const currentMtime = fs.statSync(currentStorePath).mtimeMs;
      if (currentMtime > lastLoadedMtime) {
        loadFromDisk();
      }
    }
  } catch (e) {}
  return inMemoryUsers;
}

/**
 * Lấy danh sách toàn bộ người dùng (bản sao).
 */
async function getAllUsers() {
  const users = ensureLoaded();
  return users.map(u => ({ ...u }));
}

/**
 * Tìm user theo ID.
 */
async function getUserById(id) {
  if (!id) return null;
  const users = ensureLoaded();
  const found = users.find(u => String(u.id) === String(id));
  return found ? { ...found } : null;
}

/**
 * Tìm user theo username (không phân biệt hoa thường).
 */
async function getUserByUsername(username) {
  if (!username) return null;
  const target = normalize(username);
  const users = ensureLoaded();
  const found = users.find(u => normalize(u.username) === target);
  return found ? { ...found } : null;
}

/**
 * Tìm user theo email (không phân biệt hoa thường).
 */
async function getUserByEmail(email) {
  if (!email) return null;
  const target = normalize(email);
  const users = ensureLoaded();
  const found = users.find(u => normalize(u.email) === target);
  return found ? { ...found } : null;
}

/**
 * Tìm user theo số điện thoại (chính hoặc khôi phục).
 */
async function getUserByPhone(phone) {
  if (!phone) return null;
  const target = normalizePhone(phone);
  if (!target) return null;
  const users = ensureLoaded();
  const found = users.find(u =>
    normalizePhone(u.soDienThoai) === target ||
    normalizePhone(u.username) === target ||
    normalizePhone(u.sdtKhoiPhuc) === target
  );
  return found ? { ...found } : null;
}

/**
 * Tìm user bằng bất kỳ định danh nào (username, email, SĐT chính, email khôi phục, SĐT khôi phục).
 */
async function getUserByIdentifier(identifier) {
  if (!identifier) return null;
  const target = normalize(identifier);
  const targetPhone = normalizePhone(identifier);
  const users = ensureLoaded();

  const found = users.find(u => {
    if (normalize(u.username) === target) return true;
    if (u.email && normalize(u.email) === target) return true;
    if (u.emailKhoiPhuc && normalize(u.emailKhoiPhuc) === target) return true;
    if (targetPhone) {
      if (u.soDienThoai && normalizePhone(u.soDienThoai) === targetPhone) return true;
      if (u.sdtKhoiPhuc && normalizePhone(u.sdtKhoiPhuc) === targetPhone) return true;
      if (normalizePhone(u.username) === targetPhone) return true;
    }
    return false;
  });

  return found ? { ...found } : null;
}

/**
 * Tìm user hoạt động theo username, email hoặc số điện thoại.
 */
async function getActiveUserByUsername(usernameOrIdentifier) {
  if (!usernameOrIdentifier) return null;
  const target = normalize(usernameOrIdentifier);
  const targetPhone = normalizePhone(usernameOrIdentifier);
  const users = ensureLoaded();

  const found = users.find(u => {
    if (u.trangThai !== ACTIVE_STATUS) return false;
    if (normalize(u.username) === target) return true;
    if (u.email && normalize(u.email) === target) return true;
    if (targetPhone && u.soDienThoai && normalizePhone(u.soDienThoai) === targetPhone) return true;
    if (targetPhone && normalizePhone(u.username) === targetPhone) return true;
    return false;
  });

  return found ? { ...found } : null;
}

/**
 * Tạo mới user.
 */
async function createUser(userData) {
  const users = ensureLoaded();
  const username = String(userData.username || '').trim();
  const email = String(userData.email || '').trim().toLowerCase();
  const soDienThoai = normalizePhone(userData.soDienThoai || '');
  const emailKhoiPhuc = String(userData.emailKhoiPhuc || '').trim().toLowerCase();
  const sdtKhoiPhuc = normalizePhone(userData.sdtKhoiPhuc || '');

  if (!username) throw new Error('Tên tài khoản không được để trống.');

  if (users.some(u => normalize(u.username) === normalize(username))) {
    const err = new Error('Tên tài khoản đã tồn tại.');
    err.code = 'USER_EXISTS';
    throw err;
  }

  if (email && users.some(u => u.email && normalize(u.email) === email)) {
    const err = new Error('Email này đã được sử dụng.');
    err.code = 'USER_EXISTS';
    throw err;
  }

  if (soDienThoai && users.some(u => u.soDienThoai && normalizePhone(u.soDienThoai) === soDienThoai)) {
    const err = new Error('Số điện thoại này đã được sử dụng.');
    err.code = 'USER_EXISTS';
    throw err;
  }

  const isTargetAdmin = isHardcodedAdmin(userData.email) || isHardcodedAdmin(username);

  const newUser = {
    id: userData.id || crypto.randomUUID(),
    username,
    hoTen: String(userData.hoTen || username).trim(),
    email,
    soDienThoai: userData.soDienThoai ? String(userData.soDienThoai).trim() : '',
    emailKhoiPhuc,
    sdtKhoiPhuc: userData.sdtKhoiPhuc ? String(userData.sdtKhoiPhuc).trim() : '',
    passwordHash: userData.passwordHash || '',
    vaiTro: isTargetAdmin ? ROLES.QUAN_LY : (userData.vaiTro || ROLES.KHACH),
    coSo: userData.coSo || (isTargetAdmin ? 'Cả hai' : ''),
    trangThai: isTargetAdmin ? ACTIVE_STATUS : (userData.trangThai || ACTIVE_STATUS),
    ngayTao: userData.ngayTao || formatDateVN(),
    dangNhapGanNhat: userData.dangNhapGanNhat || ''
  };

  users.push(newUser);
  saveToDisk(users);
  return { ...newUser };
}

/**
 * Cập nhật thông tin user theo ID.
 */
async function updateUser(id, updates) {
  const users = ensureLoaded();
  const index = users.findIndex(u => String(u.id) === String(id));
  if (index < 0) {
    throw new Error('Không tìm thấy tài khoản để cập nhật.');
  }

  const current = users[index];
  const isTargetAdmin = isHardcodedAdmin(current.email) || isHardcodedAdmin(current.username);

  // Kiểm tra trùng username mới nếu có đổi
  if (updates.username && normalize(updates.username) !== normalize(current.username)) {
    if (users.some((u, i) => i !== index && normalize(u.username) === normalize(updates.username))) {
      const err = new Error('Tên tài khoản mới đã tồn tại.');
      err.code = 'USER_EXISTS';
      throw err;
    }
  }

  // Kiểm tra trùng email mới nếu có đổi
  if (updates.email && normalize(updates.email) !== normalize(current.email)) {
    if (users.some((u, i) => i !== index && u.email && normalize(u.email) === normalize(updates.email))) {
      const err = new Error('Email mới đã được sử dụng.');
      err.code = 'USER_EXISTS';
      throw err;
    }
  }

  // Kiểm tra trùng số điện thoại mới nếu có đổi
  if (updates.soDienThoai && normalizePhone(updates.soDienThoai) !== normalizePhone(current.soDienThoai)) {
    const newNormPhone = normalizePhone(updates.soDienThoai);
    if (users.some((u, i) => i !== index && u.soDienThoai && normalizePhone(u.soDienThoai) === newNormPhone)) {
      const err = new Error('Số điện thoại mới đã được sử dụng.');
      err.code = 'USER_EXISTS';
      throw err;
    }
  }

  const safeVaiTro = isTargetAdmin ? ROLES.QUAN_LY : (updates.vaiTro !== undefined ? String(updates.vaiTro).trim() : current.vaiTro);
  const safeTrangThai = isTargetAdmin ? ACTIVE_STATUS : (updates.trangThai !== undefined ? String(updates.trangThai).trim() : current.trangThai);

  const updated = {
    ...current,
    ...updates,
    id: current.id, // ID không được đổi
    vaiTro: safeVaiTro,
    trangThai: safeTrangThai,
    username: updates.username !== undefined ? String(updates.username).trim() : current.username,
    email: updates.email !== undefined ? String(updates.email).trim().toLowerCase() : current.email,
    soDienThoai: updates.soDienThoai !== undefined ? String(updates.soDienThoai).trim() : (current.soDienThoai || ''),
    emailKhoiPhuc: updates.emailKhoiPhuc !== undefined ? String(updates.emailKhoiPhuc).trim().toLowerCase() : (current.emailKhoiPhuc || ''),
    sdtKhoiPhuc: updates.sdtKhoiPhuc !== undefined ? String(updates.sdtKhoiPhuc).trim() : (current.sdtKhoiPhuc || '')
  };

  users[index] = updated;
  saveToDisk(users);
  return { ...updated };
}

/**
 * Xóa user theo ID.
 */
async function deleteUser(id) {
  const users = ensureLoaded();
  const index = users.findIndex(u => String(u.id) === String(id));
  if (index < 0) {
    throw new Error('Không tìm thấy tài khoản cần xóa.');
  }
  const target = users[index];
  if (isHardcodedAdmin(target.email) || isHardcodedAdmin(target.username)) {
    throw new Error('Không thể xóa tài khoản Quản trị viên hệ thống mặc định.');
  }
  const deleted = users.splice(index, 1)[0];
  saveToDisk(users);
  return { ...deleted };
}

/**
 * Nạp trực tiếp danh sách users (phục vụ test hoặc migration).
 */
function setInMemoryUsers(users) {
  inMemoryUsers = users.map(u => ({ ...u }));
  isInitialized = true;
  lastLoadedMtime = Infinity;
}

module.exports = {
  ACTIVE_STATUS,
  LOCKED_STATUS,
  PENDING_STATUS,
  ROLES,
  HARDCODED_ADMINS,
  isHardcodedAdmin,
  initStore,
  getAllUsers,
  getUserById,
  getUserByUsername,
  getUserByEmail,
  getUserByPhone,
  getUserByIdentifier,
  getActiveUserByUsername,
  createUser,
  updateUser,
  deleteUser,
  setInMemoryUsers,
  formatDateVN,
  normalizePhone
};
