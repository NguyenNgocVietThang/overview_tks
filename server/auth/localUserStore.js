// ==========================================
// LOCAL USER STORE — Cache cục bộ (server/data/users.json) cho tài khoản
// người dùng, dùng cho đọc nhanh trong lúc server chạy. Atomic write, cache
// in-memory, kiểm soát đồng thời. Hỗ trợ số điện thoại chính, email khôi phục
// và số điện thoại khôi phục.
//
// NGUỒN LƯU TRỮ BỀN VỮNG là Google Sheets (tab "Users", spreadsheet KiotViet
// — xem usersSheetsClient.js): đĩa cục bộ trên Render là ephemeral, mất sạch
// mỗi khi container restart/redeploy. hydrateFromSheets() nạp lại từ Sheets
// lúc server khởi động; createUser/updateUser/deleteUser đẩy thay đổi ngược
// lại Sheets (trừ lần đổi chỉ có dangNhapGanNhat — xem TRACKED_SYNC_FIELDS).
// Đồng bộ chỉ bật khi isUsersSheetSyncRuntimeEnabled() (mặc định bật trên
// Render, tắt ở local/test để không ghi nhầm vào spreadsheet production).
// ==========================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { normalizeCoSo, BRANCH_BOTH } = require('../branch/branches');
const CONFIG = require('../config');
const usersSheetsClient = require('../sheets/usersSheetsClient');
const { USER_COLUMNS, buildColumnIndex, rowToUser, userToRow } = require('./userSheetColumns');

// Cac truong duoc dong bo len Google Sheets (tab Users) khi thay doi — TRU
// id/ngayTao (bat bien sau khi tao) va dangNhapGanNhat (doi o MOI lan dang
// nhap cua MOI user; neu dong bo ca truong nay se ton 1 lan ghi Sheets API
// moi lan dang nhap, khong can thiet va co the cham rate limit).
const TRACKED_SYNC_FIELDS = Object.keys(USER_COLUMNS).filter(
  key => key !== 'id' && key !== 'ngayTao' && key !== 'dangNhapGanNhat'
);

// Cung quy uoc voi isKiotVietSyncRuntimeEnabled/isTelegramBotRuntimeEnabled:
// tu bat khi chay tren Render (RENDER=true, Render tu set), tat mac dinh o
// local/test de KHONG vo tinh ghi du lieu test vao spreadsheet Users THAT
// (SPREADSHEET_ID cuc local/test tro thang vao spreadsheet production, khong
// co spreadsheet test rieng) — xem npm test trong server/auth/*.test.js.
function isUsersSheetSyncRuntimeEnabled(env = process.env) {
  if (env.USERS_SHEET_SYNC_ENABLED != null) {
    return String(env.USERS_SHEET_SYNC_ENABLED).toLowerCase() === 'true';
  }
  return String(env.RENDER).toLowerCase() === 'true';
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const DEFAULT_STORE_PATH = path.join(DATA_DIR, 'users.json');

const ACTIVE_STATUS = 'Đang hoạt động';
const INACTIVE_STATUS = 'Không hoạt động';
const LOCKED_STATUS = 'Khóa';
const PENDING_STATUS = 'Chờ duyệt';

const ROLES = Object.freeze({
  QUAN_LY: 'Quản lý',
  KE_TOAN: 'Kế toán',
  TRUONG_KHO: 'Trưởng kho',
  TRO_LY: 'Trợ lý',
  LAI_XE: 'Lái xe',
  NHAN_VIEN_KHO: 'Nhân viên kho',
  NHAN_VIEN_SALE: 'Nhân viên sale',
  NHAN_VIEN_MUA_HANG: 'Nhân viên mua hàng',
  KHACH: 'Khách'
});

const HARDCODED_ADMINS = Object.freeze([
  'thangnnv2003@gmail.com',
  'thangnnv2003@gmail',
  'thangnnv2003',
  'admin@tokosi.vn',
  'admin'
]);

function isProtectedSuperAdmin(identifier) {
  if (!identifier) return false;
  const norm = String(identifier).trim().toLowerCase();
  return norm === 'thangnnv2003@gmail.com' || norm === 'thangnnv2003@gmail' || norm === 'thangnnv2003';
}

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
      // Admin cung phai phu trach ca hai co so, neu khong se bi middleware co so
      // chan (BRANCH_UNASSIGNED) du dang la Quan ly.
      if (normalizeCoSo(u.coSo) !== BRANCH_BOTH) {
        u.coSo = BRANCH_BOTH;
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
 * Vá thêm cột còn thiếu vào hàng header (hàng 1) của tab Users trên Sheets —
 * không bắt admin phải tự chạy scripts/setupUsersSheet.js trước khi deploy.
 * Chỉ APPEND cột thiếu vào cuối, không đụng cột đã có (an toàn với sheet đang chạy thật).
 */
async function ensureSheetHeadersUpToDate(currentHeaders) {
  const expectedHeaders = Object.values(USER_COLUMNS);
  const missing = expectedHeaders.filter(h => !currentHeaders.includes(h));
  if (!missing.length) return currentHeaders;
  const patched = currentHeaders.concat(missing);
  await usersSheetsClient.usersUpdateRow(CONFIG.SHEET_USERS, 1, patched);
  return patched;
}

/**
 * Nạp lại toàn bộ danh sách người dùng từ Google Sheets (tab Users) — nguồn
 * lưu trữ BỀN VỮNG, không bị mất khi container Render restart (đĩa cục bộ là
 * ephemeral). Gọi 1 lần lúc server khởi động (server/index.js), KHÔNG tự động
 * chạy bên trong ensureLoaded()/initStore() để không phá test hiện có
 * (adminUserRoutes.test.js gọi initStore(tempPath) với file luôn luôn chưa
 * tồn tại — nếu tự hydrate ở đó, test sẽ gọi Google Sheets API thật).
 *
 * Fail-soft: lỗi (chưa cấu hình SPREADSHEET_ID, mất mạng, sheet chưa share
 * Editor cho service account...) chỉ log cảnh báo, KHÔNG throw — giữ nguyên
 * trạng thái local đã có (file cũ hoặc 2 admin mặc định), đúng convention
 * hiện có của codebase cho các tích hợp Sheets tuỳ chọn.
 */
async function hydrateFromSheets() {
  if (!isUsersSheetSyncRuntimeEnabled()) {
    console.warn('[Users] Đồng bộ Google Sheets đang tắt ở runtime này — đặt USERS_SHEET_SYNC_ENABLED=true để bật ngoài Render.');
    return;
  }
  try {
    const rawRows = await usersSheetsClient.usersGetValues(CONFIG.SHEET_USERS);
    if (!rawRows || !rawRows.length) {
      console.warn('[Users] Tab "Users" trên Google Sheets rỗng — giữ nguyên dữ liệu cục bộ hiện có.');
      return;
    }

    const [headers, ...rows] = rawRows;
    await ensureSheetHeadersUpToDate(headers).catch(err => {
      console.error('[Users] Không thể vá header tab Users:', err.message);
    });

    const colIndex = buildColumnIndex(headers);
    const usersFromSheet = rows
      .filter(row => row.some(cellValue => cellValue !== '' && cellValue !== undefined))
      .map(row => rowToUser(row, colIndex))
      .filter(u => u.username); // bo qua hang rong/hong (khong co username)

    if (!usersFromSheet.length) {
      console.warn('[Users] Tab "Users" không có hàng dữ liệu hợp lệ — giữ nguyên dữ liệu cục bộ hiện có.');
      return;
    }

    inMemoryUsers = usersFromSheet;
    ensureHardcodedAdmins(inMemoryUsers);
    saveToDisk(inMemoryUsers);
    isInitialized = true;
    console.log(`[Users] Đã đồng bộ ${usersFromSheet.length} tài khoản từ Google Sheets.`);
  } catch (err) {
    console.error('[Users] Không thể đồng bộ từ Google Sheets, dùng dữ liệu cục bộ hiện có:', err.message);
  }
}

/**
 * So sánh 2 user object trên tập TRACKED_SYNC_FIELDS — dùng để quyết định có
 * cần đẩy lên Sheets hay không (bỏ qua các lần chỉ đổi dangNhapGanNhat).
 */
function hasTrackedChange(before, after) {
  return TRACKED_SYNC_FIELDS.some(field => String(before ? before[field] || '' : '') !== String(after[field] || ''));
}

/**
 * Đẩy 1 user (tạo mới/cập nhật/xoá mềm) lên tab Users trên Google Sheets —
 * upsert theo cột ID (đọc-tìm-ghi, giống pattern hrLeaveRepository.upsertAutomaticLink).
 * Best-effort: lỗi chỉ log, KHÔNG throw — thao tác local đã lưu thành công rồi,
 * không được để lỗi đồng bộ Sheets làm hỏng phản hồi API.
 */
async function pushUserToSheet(user) {
  if (!isUsersSheetSyncRuntimeEnabled()) return;
  try {
    const rawRows = await usersSheetsClient.usersGetValues(CONFIG.SHEET_USERS);
    let headers = rawRows[0];
    if (!headers || !headers.length) {
      headers = Object.values(USER_COLUMNS);
      await usersSheetsClient.usersUpdateRow(CONFIG.SHEET_USERS, 1, headers);
    } else {
      headers = await ensureSheetHeadersUpToDate(headers);
    }

    const rows = rawRows.slice(1);
    const idColIndex = headers.indexOf(USER_COLUMNS.id);
    const existingIndex = idColIndex >= 0
      ? rows.findIndex(row => String(row[idColIndex] || '') === String(user.id))
      : -1;

    const row = userToRow(user, headers);
    if (existingIndex >= 0) {
      const rowNumber = existingIndex + 2; // +1 header, +1 vi Sheets 1-indexed
      await usersSheetsClient.usersUpdateRow(CONFIG.SHEET_USERS, rowNumber, row);
    } else {
      await usersSheetsClient.usersAppendRow(CONFIG.SHEET_USERS, row);
    }
  } catch (err) {
    console.error(`[Users] Không thể đồng bộ tài khoản "${user.username || user.id}" lên Google Sheets:`, err.message);
  }
}

/**
 * Lấy danh sách toàn bộ người dùng (bản sao, loại trừ tài khoản đã bị xóa).
 */
async function getAllUsers() {
  const users = ensureLoaded();
  return users
    .filter(u => !u.isDeleted && u.trangThai !== 'Đã xóa')
    .map(u => ({ ...u }));
}

/**
 * Tìm user theo ID.
 */
async function getUserById(id) {
  if (!id) return null;
  const users = ensureLoaded();
  const found = users.find(u => String(u.id) === String(id) && !u.isDeleted && u.trangThai !== 'Đã xóa');
  return found ? { ...found } : null;
}

/**
 * Tìm user theo username (không phân biệt hoa thường).
 */
async function getUserByUsername(username) {
  if (!username) return null;
  const target = normalize(username);
  const users = ensureLoaded();
  const found = users.find(u => normalize(u.username) === target && !u.isDeleted && u.trangThai !== 'Đã xóa');
  return found ? { ...found } : null;
}

/**
 * Tìm user theo email (không phân biệt hoa thường).
 */
async function getUserByEmail(email) {
  if (!email) return null;
  const target = normalize(email);
  const users = ensureLoaded();
  const found = users.find(u => normalize(u.email) === target && !u.isDeleted && u.trangThai !== 'Đã xóa');
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
    !u.isDeleted && u.trangThai !== 'Đã xóa' && (
      normalizePhone(u.soDienThoai) === target ||
      normalizePhone(u.username) === target ||
      normalizePhone(u.sdtKhoiPhuc) === target
    )
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
    if (u.isDeleted || u.trangThai === 'Đã xóa') return false;
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
 * Tìm user hoạt động theo username, email hoặc số điện thoại để đăng nhập.
 * Cho phép tài khoản "Đang hoạt động" và "Không hoạt động". Chặn tài khoản "Khóa" hoặc "Đã xóa".
 */
async function getActiveUserByUsername(usernameOrIdentifier) {
  if (!usernameOrIdentifier) return null;
  const target = normalize(usernameOrIdentifier);
  const targetPhone = normalizePhone(usernameOrIdentifier);
  const users = ensureLoaded();

  const found = users.find(u => {
    if (u.trangThai === LOCKED_STATUS || u.isDeleted || u.trangThai === 'Đã xóa') return false;
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

  if (users.some(u => !u.isDeleted && normalize(u.username) === normalize(username))) {
    const err = new Error('Tên tài khoản đã tồn tại.');
    err.code = 'USER_EXISTS';
    throw err;
  }

  if (email && users.some(u => !u.isDeleted && u.email && normalize(u.email) === email)) {
    const err = new Error('Email này đã được sử dụng.');
    err.code = 'USER_EXISTS';
    throw err;
  }

  if (soDienThoai && users.some(u => !u.isDeleted && u.soDienThoai && normalizePhone(u.soDienThoai) === soDienThoai)) {
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
    // Chuan hoa mot lan nua o day (ngoai adminUserRoutes) vi cac script setup
    // ghi thang vao store, khong di qua route.
    coSo: normalizeCoSo(userData.coSo) || (isTargetAdmin ? BRANCH_BOTH : ''),
    trangThai: isTargetAdmin ? ACTIVE_STATUS : (userData.trangThai || ACTIVE_STATUS),
    ngayTao: userData.ngayTao || formatDateVN(),
    dangNhapGanNhat: userData.dangNhapGanNhat || ''
  };

  users.push(newUser);
  saveToDisk(users);
  await pushUserToSheet(newUser);
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
  const isTargetThang = isProtectedSuperAdmin(current.email) || isProtectedSuperAdmin(current.username);
  const isTargetAdmin = isHardcodedAdmin(current.email) || isHardcodedAdmin(current.username);

  // Kiểm tra trùng username mới nếu có đổi
  if (updates.username && normalize(updates.username) !== normalize(current.username)) {
    if (users.some((u, i) => i !== index && !u.isDeleted && normalize(u.username) === normalize(updates.username))) {
      const err = new Error('Tên tài khoản mới đã tồn tại.');
      err.code = 'USER_EXISTS';
      throw err;
    }
  }

  // Kiểm tra trùng email mới nếu có đổi
  if (updates.email && normalize(updates.email) !== normalize(current.email)) {
    if (users.some((u, i) => i !== index && !u.isDeleted && u.email && normalize(u.email) === normalize(updates.email))) {
      const err = new Error('Email mới đã được sử dụng.');
      err.code = 'USER_EXISTS';
      throw err;
    }
  }

  // Kiểm tra trùng số điện thoại mới nếu có đổi
  if (updates.soDienThoai && normalizePhone(updates.soDienThoai) !== normalizePhone(current.soDienThoai)) {
    const newNormPhone = normalizePhone(updates.soDienThoai);
    if (users.some((u, i) => i !== index && !u.isDeleted && u.soDienThoai && normalizePhone(u.soDienThoai) === newNormPhone)) {
      const err = new Error('Số điện thoại mới đã được sử dụng.');
      err.code = 'USER_EXISTS';
      throw err;
    }
  }

  // Admin cung luon phu trach ca hai co so — neu de rong ho se bi
  // BRANCH_UNASSIGNED chan khoi moi du lieu, ke ca khi dang la Quan ly.
  const safeCoSo = isTargetAdmin
    ? BRANCH_BOTH
    : (updates.coSo !== undefined ? normalizeCoSo(updates.coSo) : normalizeCoSo(current.coSo));
  // Bảo vệ tuyệt đối: thangnnv2003@gmail.com và các admin mặc định không thể bị hạ quyền hoặc khóa
  const safeVaiTro = (isTargetThang || isTargetAdmin)
    ? ROLES.QUAN_LY
    : (updates.vaiTro !== undefined ? String(updates.vaiTro).trim() : current.vaiTro);
  const safeTrangThai = (isTargetThang || isTargetAdmin)
    ? ACTIVE_STATUS
    : (updates.trangThai !== undefined ? String(updates.trangThai).trim() : current.trangThai);

  const updated = {
    ...current,
    ...updates,
    id: current.id, // ID không được đổi
    coSo: safeCoSo,
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
  if (hasTrackedChange(current, updated)) {
    await pushUserToSheet(updated);
  }
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
  if (isProtectedSuperAdmin(target.email) || isProtectedSuperAdmin(target.username)) {
    throw new Error('Không ai có quyền xóa tài khoản thangnnv2003@gmail.com.');
  }
  if (isHardcodedAdmin(target.email) || isHardcodedAdmin(target.username)) {
    throw new Error('Không thể xóa tài khoản Quản trị viên hệ thống mặc định.');
  }
  const deleted = users.splice(index, 1)[0];
  saveToDisk(users);
  // Xoa mem tren Sheets: giu lai hang (audit), chi danh dau trang thai — dung
  // pattern xoa mem da dung o cac module khac trong repo (khong xoa vat ly hang).
  await pushUserToSheet({ ...deleted, trangThai: 'Đã xóa' });
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
  INACTIVE_STATUS,
  LOCKED_STATUS,
  PENDING_STATUS,
  ROLES,
  HARDCODED_ADMINS,
  isHardcodedAdmin,
  isProtectedSuperAdmin,
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
  normalizePhone,
  hydrateFromSheets,
  isUsersSheetSyncRuntimeEnabled
};
