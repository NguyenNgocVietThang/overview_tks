// ==========================================
// USER WRITE REPOSITORY — Thao tác ghi dữ liệu người dùng vào localUserStore
// (lưu trữ tại server/data/users.json, KHÔNG ghi ra Google Sheet để bảo mật).
// ==========================================
const crypto = require('crypto');
const localUserStore = require('./localUserStore');
const { ACTIVE_STATUS, ROLES, normalizePhone } = require('./userRepository');

/**
 * Tạo tài khoản Khách hoạt động ngay cho đăng ký email, số điện thoại hoặc Google.
 */
async function createActiveGuest({ id, email = '', soDienThoai = '', hoTen = '', username = '', passwordHash = '' }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPhone = normalizePhone(soDienThoai);
  const normalizedUsername = String(username || normalizedEmail || normalizedPhone || '').trim().toLowerCase();
  const normalizedHoTen = String(hoTen || normalizedUsername || '').trim();

  if (normalizedEmail) {
    const existingEmail = await localUserStore.getUserByEmail(normalizedEmail);
    if (existingEmail) {
      const err = new Error('Email này đã được đăng ký.');
      err.code = 'USER_EXISTS';
      throw err;
    }
  }

  if (normalizedPhone) {
    const existingPhone = await localUserStore.getUserByPhone(normalizedPhone);
    if (existingPhone) {
      const err = new Error('Số điện thoại này đã được đăng ký.');
      err.code = 'USER_EXISTS';
      throw err;
    }
  }

  const existingUsername = await localUserStore.getUserByUsername(normalizedUsername);
  if (existingUsername) {
    const err = new Error('Tài khoản này đã tồn tại.');
    err.code = 'USER_EXISTS';
    throw err;
  }

  return localUserStore.createUser({
    id: id || crypto.randomUUID(),
    username: normalizedUsername,
    email: normalizedEmail,
    soDienThoai: normalizedPhone,
    hoTen: normalizedHoTen,
    passwordHash,
    vaiTro: ROLES.KHACH,
    coSo: '',
    trangThai: ACTIVE_STATUS
  });
}

/**
 * Kích hoạt tài khoản Google cũ ở trạng thái "Chờ duyệt" sang hoạt động.
 */
async function activatePendingGuest({ email, hoTen }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = await localUserStore.getUserByEmail(normalizedEmail);
  if (!user) {
    throw new Error('Không tìm thấy tài khoản chờ duyệt.');
  }

  return localUserStore.updateUser(user.id, {
    vaiTro: ROLES.KHACH,
    trangThai: ACTIVE_STATUS,
    hoTen: user.hoTen || hoTen || normalizedEmail
  });
}

/**
 * Cập nhật thông tin hồ sơ người dùng theo ID (họ tên, email, soDienThoai, passwordHash...).
 */
async function updateUserFields(userId, fields) {
  return localUserStore.updateUser(userId, fields);
}

module.exports = {
  createActiveGuest,
  activatePendingGuest,
  updateUserFields
};
