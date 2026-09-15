// ==========================================
// LOCAL USER STORE — tai khoan dang nhap. NGUON LUU TRU BEN VUNG la Postgres
// (bang `app_users`, xem server/db/migrations/0009_app_users_hr_employees.sql)
// — truoc day la Google Sheets tab "Users" + cache dia cuc bo, da bo hoan
// toan (xem server/scripts/backfillUsersAndHrToPostgres.js cho lan chuyen du
// lieu mot lan). Doc qua cache TTL ngan han (createTtlSnapshotCache) de khong
// query Postgres tren moi request nhung van thay thay doi trong vai giay;
// ghi (createUser/updateUser/deleteUser) luon di thang qua Postgres roi xoa
// cache ngay.
// ==========================================
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { normalizeCoSo, BRANCH_BOTH } = require('../branch/branches');
const { createTtlSnapshotCache } = require('../lib/ttlSnapshotCache');
const appUsersRepository = require('./appUsersRepository');

const FRESH_TTL_MS = 10 * 1000;
const STALE_TTL_MS = 15 * 60 * 1000;

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

// Repository co the doi (options.repository, chi dung trong test) — cache tao
// LAI moi lan initStore() de khong dinh vao repository cua lan truoc.
let repository = appUsersRepository;
let cache = createCache();

function createCache() {
  return createTtlSnapshotCache({
    fetch: async () => ({ users: await repository.selectAllRows() }),
    freshTtlMs: FRESH_TTL_MS,
    staleTtlMs: STALE_TTL_MS,
    onUnavailable: err => { throw err; }
  });
}

async function ensureSnapshot(options = {}) {
  const snapshot = await cache.get(options);
  return snapshot.users;
}

/**
 * Danh sach tai khoan Admin mac dinh (dac biet thangnnv2003@gmail.com) phai
 * luon co san — tao trong Postgres neu chua ton tai. Goi tu hydrateFromSheets()
 * (ten ham giu nguyen de server/index.js khong phai sua — xem cuoi file).
 */
async function ensureHardcodedAdminsInDb() {
  const users = await ensureSnapshot({ forceRefresh: true });
  const hasThang = users.some(u => isHardcodedAdmin(u.email) || isHardcodedAdmin(u.username));
  let modified = false;

  if (!hasThang) {
    await repository.insertUser({
      id: 'c2619c62-e841-486a-9803-48c40ab0a398',
      username: 'thangnnv2003@gmail.com',
      hoTen: 'Nguyễn Ngọc Việt Thắng',
      email: 'thangnnv2003@gmail.com',
      soDienThoai: '',
      emailKhoiPhuc: 'thangnnv2003@gmail.com',
      sdtKhoiPhuc: '0974089295',
      passwordHash: bcrypt.hashSync('Thang@2026', 10),
      vaiTro: ROLES.QUAN_LY,
      coSo: BRANCH_BOTH,
      trangThai: ACTIVE_STATUS,
      ngayTao: '01/01/2026',
      dangNhapGanNhat: ''
    });
    modified = true;
  }

  const hasAdmin = users.some(u => normalize(u.username) === 'admin');
  if (!hasAdmin && !hasThang) {
    // Chi tao 'admin' mac dinh khi CHUA co tai khoan nao — tranh tao lai sau
    // khi Quan ly da doi ten dang nhap/xoa tai khoan admin mac dinh ban dau.
    await repository.insertUser({
      id: crypto.randomUUID(),
      username: 'admin',
      hoTen: 'Quản trị viên hệ thống',
      email: 'admin@tokosi.vn',
      soDienThoai: '',
      emailKhoiPhuc: '',
      sdtKhoiPhuc: '',
      passwordHash: bcrypt.hashSync('Admin@123', 10),
      vaiTro: ROLES.QUAN_LY,
      coSo: BRANCH_BOTH,
      trangThai: ACTIVE_STATUS,
      ngayTao: formatDateVN(),
      dangNhapGanNhat: ''
    });
    modified = true;
  }

  for (const u of users) {
    if (isHardcodedAdmin(u.email) || isHardcodedAdmin(u.username)) {
      const patch = {};
      if (u.vaiTro !== ROLES.QUAN_LY) patch.vaiTro = ROLES.QUAN_LY;
      if (u.trangThai !== ACTIVE_STATUS) patch.trangThai = ACTIVE_STATUS;
      if (normalizeCoSo(u.coSo) !== BRANCH_BOTH) patch.coSo = BRANCH_BOTH;
      if (Object.keys(patch).length) {
        await repository.updateUserRow(u.id, { ...u, ...patch });
        modified = true;
      }
    }
  }

  if (modified) cache.clear();
  return modified;
}

/**
 * Khoi tao store. Truoc day nap file cache tu dia — nay chi doi lai
 * repository/cache (dung trong test, xem options.repository) vi Postgres
 * luon la nguon du lieu, khong con file de "khoi tao".
 */
function initStore(_customPath, options = {}) {
  if (options.repository) repository = options.repository;
  cache = createCache();
}

/**
 * Truoc day nap toan bo tab "Users" tu Google Sheets luc server khoi dong.
 * Postgres luon la nguon du lieu hien tai (khong can "nap lai" tu dau), nen
 * ham nay gio chi dam bao 2 tai khoan Admin mac dinh ton tai va lam nong
 * cache — GIU NGUYEN TEN de server/index.js khong phai sua. Fail-soft dung
 * quy uoc cu: loi (mat ket noi Postgres...) chi log, KHONG throw.
 */
async function hydrateFromSheets() {
  try {
    await ensureHardcodedAdminsInDb();
    console.log('[Users] Đã sẵn sàng đọc tài khoản từ Postgres (app_users).');
  } catch (err) {
    console.error('[Users] Không thể khởi tạo tài khoản Admin mặc định trong Postgres:', err.message);
  }
}

// Giu lai de tuong thich nguoc (khong con dieu khien hanh vi nao) — dong bo
// Sheets khong con ton tai trong ma dang chay.
function isUsersSheetSyncRuntimeEnabled() {
  return false;
}

async function getAllUsers() {
  const users = await ensureSnapshot();
  return users
    .filter(u => !u.isDeleted && u.trangThai !== 'Đã xóa')
    .map(u => ({ ...u }));
}

async function getUserById(id) {
  if (!id) return null;
  const users = await ensureSnapshot();
  const found = users.find(u => String(u.id) === String(id) && !u.isDeleted && u.trangThai !== 'Đã xóa');
  return found ? { ...found } : null;
}

async function getUserByUsername(username) {
  if (!username) return null;
  const target = normalize(username);
  const users = await ensureSnapshot();
  const found = users.find(u => normalize(u.username) === target && !u.isDeleted && u.trangThai !== 'Đã xóa');
  return found ? { ...found } : null;
}

async function getUserByEmail(email) {
  if (!email) return null;
  const target = normalize(email);
  const users = await ensureSnapshot();
  const found = users.find(u => normalize(u.email) === target && !u.isDeleted && u.trangThai !== 'Đã xóa');
  return found ? { ...found } : null;
}

async function getUserByPhone(phone) {
  if (!phone) return null;
  const target = normalizePhone(phone);
  if (!target) return null;
  const users = await ensureSnapshot();
  const found = users.find(u =>
    !u.isDeleted && u.trangThai !== 'Đã xóa' && (
      normalizePhone(u.soDienThoai) === target ||
      normalizePhone(u.username) === target ||
      normalizePhone(u.sdtKhoiPhuc) === target
    )
  );
  return found ? { ...found } : null;
}

async function getUserByIdentifier(identifier) {
  if (!identifier) return null;
  const target = normalize(identifier);
  const targetPhone = normalizePhone(identifier);
  const users = await ensureSnapshot();

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

async function getActiveUserByUsername(usernameOrIdentifier) {
  if (!usernameOrIdentifier) return null;
  const target = normalize(usernameOrIdentifier);
  const targetPhone = normalizePhone(usernameOrIdentifier);
  const users = await ensureSnapshot();

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

async function createUser(userData) {
  const users = await ensureSnapshot();
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

  const inserted = await repository.insertUser(newUser);
  cache.clear();
  return inserted;
}

async function updateUser(id, updates) {
  const users = await ensureSnapshot();
  const current = users.find(u => String(u.id) === String(id));
  if (!current) {
    throw new Error('Không tìm thấy tài khoản để cập nhật.');
  }

  const isTargetThang = isProtectedSuperAdmin(current.email) || isProtectedSuperAdmin(current.username);
  const isTargetAdmin = isHardcodedAdmin(current.email) || isHardcodedAdmin(current.username);

  if (updates.username && normalize(updates.username) !== normalize(current.username)) {
    if (users.some(u => String(u.id) !== String(id) && !u.isDeleted && normalize(u.username) === normalize(updates.username))) {
      const err = new Error('Tên tài khoản mới đã tồn tại.');
      err.code = 'USER_EXISTS';
      throw err;
    }
  }

  if (updates.email && normalize(updates.email) !== normalize(current.email)) {
    if (users.some(u => String(u.id) !== String(id) && !u.isDeleted && u.email && normalize(u.email) === normalize(updates.email))) {
      const err = new Error('Email mới đã được sử dụng.');
      err.code = 'USER_EXISTS';
      throw err;
    }
  }

  if (updates.soDienThoai && normalizePhone(updates.soDienThoai) !== normalizePhone(current.soDienThoai)) {
    const newNormPhone = normalizePhone(updates.soDienThoai);
    if (users.some(u => String(u.id) !== String(id) && !u.isDeleted && u.soDienThoai && normalizePhone(u.soDienThoai) === newNormPhone)) {
      const err = new Error('Số điện thoại mới đã được sử dụng.');
      err.code = 'USER_EXISTS';
      throw err;
    }
  }

  const safeCoSo = isTargetAdmin
    ? BRANCH_BOTH
    : (updates.coSo !== undefined ? normalizeCoSo(updates.coSo) : normalizeCoSo(current.coSo));
  const safeVaiTro = (isTargetThang || isTargetAdmin)
    ? ROLES.QUAN_LY
    : (updates.vaiTro !== undefined ? String(updates.vaiTro).trim() : current.vaiTro);
  const safeTrangThai = (isTargetThang || isTargetAdmin)
    ? ACTIVE_STATUS
    : (updates.trangThai !== undefined ? String(updates.trangThai).trim() : current.trangThai);

  const updated = {
    ...current,
    ...updates,
    id: current.id,
    coSo: safeCoSo,
    vaiTro: safeVaiTro,
    trangThai: safeTrangThai,
    username: updates.username !== undefined ? String(updates.username).trim() : current.username,
    email: updates.email !== undefined ? String(updates.email).trim().toLowerCase() : current.email,
    soDienThoai: updates.soDienThoai !== undefined ? String(updates.soDienThoai).trim() : (current.soDienThoai || ''),
    emailKhoiPhuc: updates.emailKhoiPhuc !== undefined ? String(updates.emailKhoiPhuc).trim().toLowerCase() : (current.emailKhoiPhuc || ''),
    sdtKhoiPhuc: updates.sdtKhoiPhuc !== undefined ? String(updates.sdtKhoiPhuc).trim() : (current.sdtKhoiPhuc || '')
  };

  const saved = await repository.updateUserRow(id, updated);
  cache.clear();
  return saved || { ...updated };
}

async function deleteUser(id) {
  const users = await ensureSnapshot();
  const target = users.find(u => String(u.id) === String(id));
  if (!target) {
    throw new Error('Không tìm thấy tài khoản cần xóa.');
  }
  if (isProtectedSuperAdmin(target.email) || isProtectedSuperAdmin(target.username)) {
    throw new Error('Không ai có quyền xóa tài khoản thangnnv2003@gmail.com.');
  }
  if (isHardcodedAdmin(target.email) || isHardcodedAdmin(target.username)) {
    throw new Error('Không thể xóa tài khoản Quản trị viên hệ thống mặc định.');
  }
  await repository.softDeleteUser(id);
  cache.clear();
  return { ...target, isDeleted: true, trangThai: 'Đã xóa' };
}

/**
 * Nap truc tiep 1 danh sach user vao cache (khong qua Postgres) — phuc vu
 * unit test seed du lieu gia, khong lam thay doi du lieu that.
 */
function setInMemoryUsers(users) {
  cache.set({ users: users.map(u => ({ ...u })) });
  // Repository gia (test) co seed() de ghi cung 1 du lieu vao "nguon" — nho
  // vay cac lan ghi sau (createUser/updateUser/deleteUser) xoa cache thi lan
  // doc lai van thay dung du lieu da seed, khong bi rong. appUsersRepository
  // (Postgres) that khong co ham nay nen khong anh huong luc chay thuc te.
  if (typeof repository.seed === 'function') {
    repository.seed(users);
  }
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
