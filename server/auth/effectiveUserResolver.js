'use strict';

const localUserStore = require('./localUserStore');
const employeeDirectory = require('../hr/employeeDirectory');
const { BRANCH_BOTH } = require('../branch/branches');

const { ROLES, ACTIVE_STATUS, LOCKED_STATUS } = localUserStore;

class EffectiveUserError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = 'EffectiveUserError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function employeeIdentityFor(user) {
  const username = String(user.username || '').trim();
  return {
    email: user.email || (username.includes('@') ? username : ''),
    phone: user.soDienThoai || (!username.includes('@') ? username : '')
  };
}

function localUserMatchesEmployee(user, employee) {
  const username = String(user.username || '').trim();
  const emails = [user.email, username.includes('@') ? username : ''].map(normalizedEmail).filter(Boolean);
  const phones = [user.soDienThoai, !username.includes('@') ? username : '']
    .map(localUserStore.normalizePhone).filter(Boolean);
  return (employee.email && emails.includes(employee.email)) ||
    (employee.soDienThoai && phones.includes(employee.soDienThoai));
}

function hasVerifiedEmployeeIdentity(user, employee) {
  return !!(
    (user.verifiedEmail && employee.email && normalizedEmail(user.email || user.username) === employee.email) ||
    (user.verifiedPhone && employee.soDienThoai && localUserStore.normalizePhone(user.soDienThoai || user.username) === employee.soDienThoai)
  );
}

// hrRowIndex (= hr_employees.id) la rang buoc on dinh giua TK web va mot dong
// nhan su. Tra '' khi TK chua gan (khong hrManaged, hoac hrRowIndex rong/null).
function boundRowIndex(user) {
  if (!user || !user.hrManaged) return '';
  const value = user.hrRowIndex;
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function changedFields(user, desired) {
  const changes = {};
  for (const [key, value] of Object.entries(desired)) {
    if (user[key] !== value) changes[key] = value;
  }
  return changes;
}

function createEffectiveUserResolver(options = {}) {
  const store = options.store || localUserStore;
  const directory = options.directory || employeeDirectory;

  async function findAccountForEmployee(employee) {
    const users = await store.getAllUsers();
    const seen = new Set();
    const matches = users.filter(user => {
      if (!localUserMatchesEmployee(user, employee) || seen.has(String(user.id))) return false;
      seen.add(String(user.id));
      return true;
    });
    const conflict = () => new EffectiveUserError(
      'Có nhiều tài khoản web cùng khớp một nhân sự.',
      'HR_IDENTITY_CONFLICT',
      409
    );
    // Uu tien TK da gan dung dong nay qua hrRowIndex; TK da gan dong KHAC
    // khong the nhan dong nay (resolveUser chan nhay dong) nen bo qua — ap dung
    // ca khi chi co 1 TK khop (vd TK gan dong X con giu email cu trung nhan su Y).
    const rowIndex = String(employee.rowIndex);
    const bound = matches.filter(user => boundRowIndex(user) === rowIndex);
    if (bound.length === 1) return bound[0];
    if (bound.length > 1) throw conflict();
    const unbound = matches.filter(user => !boundRowIndex(user));
    if (unbound.length > 1) throw conflict();
    if (unbound.length) return unbound[0];
    if (matches.length) {
      // Chi con TK da gan dong khac khop email/SĐT: tra null se de luong Google
      // roi xuong tim TK theo email va dang nhap nham vao TK do -> fail closed.
      throw new EffectiveUserError(
        'Email/SĐT của nhân sự này đang thuộc một tài khoản đã gắn nhân sự khác.',
        'HR_IDENTITY_CONFLICT',
        409
      );
    }
    return null;
  }

  async function persistIfChanged(user, desired) {
    const changes = changedFields(user, desired);
    return Object.keys(changes).length ? store.updateUser(user.id, changes) : { ...user };
  }

  async function resolveUser(inputUser) {
    if (!inputUser) return null;
    let user = { ...inputUser, assignedCoSo: Object.hasOwn(inputUser, 'assignedCoSo') ? inputUser.assignedCoSo : inputUser.coSo || '' };
    const isHardcodedAdmin = store.isHardcodedAdmin || localUserStore.isHardcodedAdmin;
    const hardcoded = isHardcodedAdmin(user.email) || isHardcodedAdmin(user.username);
    if (hardcoded) {
      return persistIfChanged(user, {
        vaiTro: ROLES.QUAN_LY,
        coSo: BRANCH_BOTH,
        trangThai: ACTIVE_STATUS,
        lockReason: ''
      });
    }

    // Quyền, vai trò, cơ sở và Bộ phận của mọi tài khoản thông thường là dữ liệu quản trị
    // tài khoản (app_users). Không đọc hay đồng bộ từ hồ sơ nhân sự khi đăng nhập.
    // Giữ cơ chế cũ duy nhất: tài khoản từng bị khóa 'hr_removed' (khóa tự động thời đồng bộ HR)
    // được gỡ khóa; khóa thủ công và khóa do nghỉ việc ('hr_resigned') giữ nguyên.
    if (user.lockReason === 'hr_removed') {
      const saved = await persistIfChanged(user, { trangThai: ACTIVE_STATUS, lockReason: '' });
      return { ...saved, assignedCoSo: user.assignedCoSo };
    }
    return user;
  }

  return { resolveUser, findAccountForEmployee };
}

const defaultResolver = createEffectiveUserResolver();

module.exports = {
  EffectiveUserError,
  employeeIdentityFor,
  localUserMatchesEmployee,
  hasVerifiedEmployeeIdentity,
  createEffectiveUserResolver,
  resolveUser: defaultResolver.resolveUser,
  findAccountForEmployee: defaultResolver.findAccountForEmployee
};
