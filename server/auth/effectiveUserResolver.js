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
    const matches = users.filter(user => localUserMatchesEmployee(user, employee));
    const distinctIds = new Set(matches.map(user => String(user.id)));
    if (distinctIds.size > 1) {
      throw new EffectiveUserError(
        'Có nhiều tài khoản web cùng khớp một nhân sự.',
        'HR_IDENTITY_CONFLICT',
        409
      );
    }
    return matches[0] || null;
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

    const employee = employeeDirectory.findEmployeeByIdentifier(snapshot.employees, employeeIdentityFor(user));
    if (!employee) {
      if (user.hrManaged) {
        user = await persistIfChanged(user, { trangThai: LOCKED_STATUS, lockReason: 'hr_removed' });
        throw new EffectiveUserError(
          'Tài khoản không còn trong Danh sách nhân sự.',
          'ACCOUNT_HR_REMOVED',
          403
        );
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
      hrMatchedAt: new Date().toISOString(),
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
    return persistIfChanged(user, desired);
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
