// ==========================================
// HR EMPLOYEE ADMIN SERVICE — them / sua nhan su (tab "Danh sach nhan su") kem
// trang thai lam viec. Quyen goi: 'hr.employees.manage' (kiem o route).
//
// - Email / SDT / bo phan cua hr_employees duoc effectiveUserResolver dung de gan
//   tai khoan vao dong nhan su va suy ra vai tro => ghi chung phai qua cac chot
//   chong leo thang cua accountPolicy (dinh danh admin cung, vai tro cao hon quyen
//   nguoi thao tac) giong route quan tri tai khoan.
// - Chuyen sang 'resigned' khoa cac tai khoan dang nhap lien ket (lock_reason
//   'hr_resigned'); chuyen lai 'active' chi mo khoa dung loai khoa nay, khong dung
//   khoa thu cong. Khong dung 'hr_removed' vi resolver tu mo khoa gia tri do.
// ==========================================
'use strict';

const hrEmployeesRepository = require('./hrEmployeesRepository');
const employeeDirectory = require('./employeeDirectory');
const localUserStore = require('../auth/localUserStore');
const accountPolicy = require('../auth/accountPolicy');
const accountAuditLog = require('../auth/accountAuditLog');
const { allowedBranches, branchLabelToCode, branchCodeToLabel } = require('../branch/branches');

const LOCK_REASON_RESIGNED = 'hr_resigned';
const STATUS_ACTIVE = 'active';
const STATUS_RESIGNED = 'resigned';
const STATUS_LABELS = Object.freeze({ [STATUS_ACTIVE]: 'Đang làm việc', [STATUS_RESIGNED]: 'Đã nghỉ việc' });

class HrEmployeeAdminError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.name = 'HrEmployeeAdminError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function toStatus(value) {
  const v = clean(value);
  if (v === STATUS_RESIGNED || v === STATUS_LABELS[STATUS_RESIGNED]) return STATUS_RESIGNED;
  if (v === '' || v === STATUS_ACTIVE || v === STATUS_LABELS[STATUS_ACTIVE]) return STATUS_ACTIVE;
  throw new HrEmployeeAdminError('Trạng thái nhân sự không hợp lệ.', 400, 'INVALID_EMPLOYMENT_STATUS');
}

function createHrEmployeeAdminService(options = {}) {
  const repo = options.repo || hrEmployeesRepository;
  const directory = options.directory || employeeDirectory;
  const userStore = options.userStore || localUserStore;
  const policy = options.policy || accountPolicy;
  const auditLog = options.auditLog || accountAuditLog;

  function parseInput(body) {
    const input = body || {};
    const hoTen = clean(input.hoTen);
    const boPhan = clean(input.boPhan);
    if (!hoTen) throw new HrEmployeeAdminError('Vui lòng nhập họ và tên.', 400, 'INVALID_NAME');
    if (!boPhan) throw new HrEmployeeAdminError('Vui lòng nhập chức vụ.', 400, 'INVALID_DEPARTMENT');
    const branch = branchLabelToCode(clean(input.coSo));
    if (branch !== 'hanoi' && branch !== 'saigon') {
      throw new HrEmployeeAdminError('Cơ sở phải là Hà Nội hoặc Sài Gòn.', 400, 'INVALID_BRANCH');
    }
    const email = directory.normalizeEmail(input.email);
    if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) {
      throw new HrEmployeeAdminError('Email không hợp lệ.', 400, 'INVALID_EMAIL');
    }
    const soDienThoai = localUserStore.normalizePhone(input.soDienThoai);
    if (soDienThoai && !/^\+?\d{8,15}$/.test(soDienThoai)) {
      throw new HrEmployeeAdminError('Số điện thoại không hợp lệ.', 400, 'INVALID_PHONE');
    }
    return { hoTen, boPhan, branch, email, soDienThoai, employmentStatus: toStatus(input.trangThai) };
  }

  function assertBranchAllowed(actor, branchCode) {
    if (!allowedBranches(actor).includes(branchCodeToLabel(branchCode))) {
      throw new HrEmployeeAdminError('Bạn không có quyền với cơ sở này.', 403, 'BRANCH_FORBIDDEN');
    }
  }

  async function assertNoDuplicate(selfId, { email, soDienThoai }) {
    const snapshot = await directory.getSnapshot({ forceRefresh: true });
    const clash = snapshot.employees.find(e => String(e.rowIndex) !== String(selfId) && (
      (email && e.email === email) || (soDienThoai && e.soDienThoai === soDienThoai)
    ));
    if (clash) {
      throw new HrEmployeeAdminError('Email hoặc số điện thoại đã thuộc nhân sự khác.', 409, 'HR_IDENTITY_CONFLICT');
    }
    return snapshot;
  }

  function assertPolicy(actor, input, existing) {
    const identity = policy.checkProtectedIdentity(actor, [input.email, input.soDienThoai]);
    if (identity) throw new HrEmployeeAdminError(identity, 403, policy.PROTECTED_IDENTITY_CODE);
    const candidates = [{ sheetVaiTro: directory.roleForDepartment(input.boPhan) }];
    if (existing) candidates.push({ sheetVaiTro: existing.sheetVaiTro });
    const escalation = policy.checkHrRoleEscalation(actor, candidates);
    if (escalation) throw new HrEmployeeAdminError(escalation, 403, policy.HR_ROLE_ESCALATION_CODE);
  }

  function linkedTo(user, employee) {
    if (user.hrRowIndex !== '' && user.hrRowIndex != null && String(user.hrRowIndex) === String(employee.rowIndex)) return true;
    const { emails, phones } = policy.hrIdentitiesOf(user);
    return (employee.email && emails.includes(employee.email)) ||
      (employee.soDienThoai && phones.includes(employee.soDienThoai));
  }

  // Tra ve { locked, unlocked, skipped } theo ten tai khoan de route/giao dien bao lai.
  async function syncAccounts(actor, employee, status) {
    const result = { locked: [], unlocked: [], skipped: [] };
    const users = (await userStore.getAllUsers()).filter(u => linkedTo(u, employee));
    for (const user of users) {
      const name = user.hoTen || user.username;
      if (status === STATUS_RESIGNED) {
        if (user.trangThai === localUserStore.LOCKED_STATUS) continue;
        if (policy.isSeniorAdmin(user) || String(user.id) === String(actor && actor.id) ||
            policy.checkProtectedManager(actor, user, 'khóa tài khoản')) {
          result.skipped.push(name);
          continue;
        }
        const updated = await userStore.updateUser(user.id, {
          trangThai: localUserStore.LOCKED_STATUS, lockReason: LOCK_REASON_RESIGNED
        });
        result.locked.push(name);
        await auditLog.record({
          action: auditLog.ACTIONS.UPDATE, actor, target: updated,
          changes: auditLog.diffUser(user, updated)
        });
      } else if (user.lockReason === LOCK_REASON_RESIGNED) {
        const updated = await userStore.updateUser(user.id, {
          trangThai: localUserStore.ACTIVE_STATUS, lockReason: ''
        });
        result.unlocked.push(name);
        await auditLog.record({
          action: auditLog.ACTIONS.UPDATE, actor, target: updated,
          changes: auditLog.diffUser(user, updated)
        });
      }
    }
    return result;
  }

  async function createEmployee(actor, body) {
    const input = parseInput(body);
    assertBranchAllowed(actor, input.branch);
    assertPolicy(actor, input, null);
    await assertNoDuplicate(null, input);
    const row = await repo.insertEmployee(input);
    directory.clearCache();
    const snapshot = await directory.getSnapshot({ forceRefresh: true });
    const employee = snapshot.employees.find(e => String(e.rowIndex) === String(row.id));
    const accounts = input.employmentStatus === STATUS_RESIGNED
      ? await syncAccounts(actor, employee, STATUS_RESIGNED)
      : { locked: [], unlocked: [], skipped: [] };
    return { employee, accounts };
  }

  async function updateEmployee(actor, id, body) {
    const input = parseInput(body);
    const snapshot = await directory.getSnapshot({ forceRefresh: true });
    const existing = snapshot.employees.find(e => String(e.rowIndex) === String(id));
    if (!existing) throw new HrEmployeeAdminError('Không tìm thấy nhân sự.', 404, 'HR_EMPLOYEE_NOT_FOUND');
    assertBranchAllowed(actor, branchLabelToCode(existing.sourceBranch));
    assertBranchAllowed(actor, input.branch);
    assertPolicy(actor, input, existing);
    await assertNoDuplicate(id, input);
    const row = await repo.updateEmployeeById(Number(id), input);
    if (!row) throw new HrEmployeeAdminError('Không tìm thấy nhân sự.', 404, 'HR_EMPLOYEE_NOT_FOUND');
    directory.clearCache();
    const refreshed = await directory.getSnapshot({ forceRefresh: true });
    const employee = refreshed.employees.find(e => String(e.rowIndex) === String(id));
    const statusChanged = existing.employmentStatus !== input.employmentStatus;
    const accounts = statusChanged
      ? await syncAccounts(actor, employee, input.employmentStatus)
      : { locked: [], unlocked: [], skipped: [] };
    return { employee, accounts };
  }

  return { createEmployee, updateEmployee, syncAccounts };
}

module.exports = {
  LOCK_REASON_RESIGNED,
  STATUS_ACTIVE,
  STATUS_RESIGNED,
  STATUS_LABELS,
  HrEmployeeAdminError,
  createHrEmployeeAdminService
};
