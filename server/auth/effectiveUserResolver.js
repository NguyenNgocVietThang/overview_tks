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
    let user = { ...inputUser };
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

    let snapshot;
    try {
      snapshot = await directory.getSnapshot();
    } catch (err) {
      if (user.hrManaged) throw err;
      return user;
    }

    const boundRow = boundRowIndex(user);
    let employee;
    try {
      employee = employeeDirectory.findEmployeeByIdentifier(snapshot.employees, employeeIdentityFor(user));
    } catch (err) {
      // Email va SĐT tro hai nhan su khac nhau. TK da gan mot dong thi giu
      // nguyen rang buoc cu (khong lam TK loi 409 moi request); TK chua gan
      // thi van fail closed nhu truoc.
      if (boundRow && err && err.code === 'HR_IDENTITY_CONFLICT') {
        console.warn(`[effectiveUser] TK ${user.id} (gan dong ${boundRow}): email/SĐT trỏ hai nhân sự khác nhau, giữ ràng buộc cũ.`);
        return user;
      }
      throw err;
    }
    if (employee && boundRow && String(employee.rowIndex) !== boundRow) {
      // TK da gan dong A nhung email/SĐT hien tai khop dong B (vd tu doi email
      // sang email nhan su khac). KHONG nhay sang B: giu nguyen vai tro/co so/
      // email/hrRowIndex, khong persist gi tu dong B. Muon gan TK sang dong khac
      // phai go/sua rang buoc (app_users.hr_employee_id) chu dong.
      console.warn(`[effectiveUser] TK ${user.id} đã gắn dòng nhân sự ${boundRow} nhưng khớp dòng ${employee.rowIndex}; giữ ràng buộc cũ.`);
      return user;
    }
    if (!employee) {
      // Khong con khop dong nhan su nao (vd sua/nhap lai SĐT-email) KHONG con
      // tu khoa tai khoan nua; giu nguyen vai tro/quyen da co. Chi go khoa
      // 'hr_removed' cu de cac tai khoan tung bi khoa theo co che nay dang nhap lai duoc.
      if (user.hrManaged) {
        if (user.lockReason === 'hr_removed') {
          user = await persistIfChanged(user, { trangThai: ACTIVE_STATUS, lockReason: '' });
        }
        return user;
      }
      if (user.vaiTro && user.vaiTro !== ROLES.KHACH && !user.legacyOverride) {
        user = await persistIfChanged(user, {
          legacyOverride: true,
          vaiTroOverride: user.vaiTro,
          coSoOverride: user.coSo || ''
        });
      }
      return user;
    }

    const account = await findAccountForEmployee(employee);
    if (account && String(account.id) !== String(user.id)) {
      throw new EffectiveUserError(
        'Nhân sự này đang khớp với một tài khoản web khác.',
        'HR_IDENTITY_CONFLICT',
        409
      );
    }

    const trustedLegacyInternal = !user.hrManaged && user.vaiTro && user.vaiTro !== ROLES.KHACH;
    if (!user.hrManaged && !trustedLegacyInternal && !hasVerifiedEmployeeIdentity(user, employee)) {
      return { ...user, hrVerificationRequired: true };
    }

    const roleOverride = user.vaiTroOverride || (user.legacyOverride ? user.vaiTro : '');
    const branchOverride = user.coSoOverride || (user.legacyOverride ? user.coSo : '');
    const desired = {
      hrManaged: true,
      hrSourceBranch: employee.sourceBranch,
      hrRowIndex: employee.rowIndex,
      sheetVaiTro: employee.sheetVaiTro,
      sheetCoSo: employee.sheetCoSo,
      hoTen: employee.hoTen || user.hoTen,
      email: employee.email || user.email || '',
      soDienThoai: employee.soDienThoai || user.soDienThoai || '',
      vaiTro: roleOverride || employee.sheetVaiTro,
      coSo: branchOverride || employee.sheetCoSo,
      roleSource: roleOverride ? 'override' : 'sheet'
    };
    if (user.lockReason === 'hr_removed') {
      desired.trangThai = ACTIVE_STATUS;
      desired.lockReason = '';
    }
    // resolveUser chay MOI request: neu dat hrMatchedAt = now vao desired thi
    // luc nao cung "khac" -> ghi DB + xoa cache moi request (tung gop phan can
    // Disk IO Supabase). Chi danh dau thoi diem khop khi co truong khac thay doi
    // (gom lan gan dau) hoac TK chua tung co hrMatchedAt.
    const changes = changedFields(user, desired);
    if (!Object.keys(changes).length && user.hrMatchedAt) return { ...user };
    changes.hrMatchedAt = new Date().toISOString();
    return store.updateUser(user.id, changes);
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
