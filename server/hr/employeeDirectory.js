'use strict';

const hrEmployeesRepository = require('./hrEmployeesRepository');
const { createTtlSnapshotCache } = require('../lib/ttlSnapshotCache');
const { BRANCH_BOTH, branchCodeToLabel } = require('../branch/branches');
const { ROLES, normalizePhone } = require('../auth/localUserStore');

const FRESH_TTL_MS = 10 * 1000;
const STALE_TTL_MS = 15 * 60 * 1000;
const REQUIRED_HEADERS = Object.freeze({
  hoTen: 'HỌ VÀ TÊN',
  boPhan: 'BỘ PHẬN',
  soDienThoai: 'SĐT',
  email: 'EMAIL',
  telegramId: 'ID TELEGRAM'
});

const DEPARTMENT_FOR_ROLE = Object.freeze({
  [ROLES.QUAN_LY]: 'BAN QUẢN LÝ',
  [ROLES.KE_TOAN]: 'KẾ TOÁN',
  [ROLES.TRUONG_KHO]: 'TRƯỞNG KHO',
  [ROLES.TRO_LY]: 'TRỢ LÝ',
  [ROLES.LAI_XE]: 'LÁI XE',
  [ROLES.NHAN_VIEN_KHO]: 'KHO',
  [ROLES.NHAN_VIEN_SALE]: 'SALE',
  [ROLES.NHAN_VIEN_MARKETING]: 'MARKETING',
  [ROLES.NHAN_VIEN_MUA_HANG]: 'MUA HÀNG'
  // ROLES.KHACH: cố ý không map — không có phòng ban duy nhất để ghi ngược lại
  // (HẬU CẦN/BẢO VỆ đều suy ra Khách), nên giữ nguyên BỘ PHẬN gốc.
});

class HrDirectoryError extends Error {
  constructor(message, code, statusCode = 409) {
    super(message);
    this.name = 'HrDirectoryError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeText(value) {
  return String(value == null ? '' : value)
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function normalizeEmail(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function normalizeTelegramId(value) {
  if (value === undefined || value === null || value === '') return '';
  return String(value).trim().replace(/\.0$/, '');
}

function roleForDepartment(value) {
  const department = normalizeText(value);
  const roles = {
    'BAN QUAN LY': ROLES.QUAN_LY,
    'TRUONG CHI NHANH': ROLES.QUAN_LY,
    'KE TOAN': ROLES.KE_TOAN,
    'TRUONG KHO': ROLES.TRUONG_KHO,
    'KHO': ROLES.NHAN_VIEN_KHO,
    'TRO LY': ROLES.TRO_LY,
    'LAI XE': ROLES.LAI_XE,
    'SALE': ROLES.NHAN_VIEN_SALE,
    'MUA HANG': ROLES.NHAN_VIEN_MUA_HANG,
    'DAT HANG': ROLES.NHAN_VIEN_MUA_HANG,
    'MARKETING': ROLES.NHAN_VIEN_MARKETING,
    'HAU CAN': ROLES.KHACH,
    'BAO VE': ROLES.KHACH
  };
  return roles[department] || ROLES.KHACH;
}

/**
 * Parse hàng thô đọc từ tab "Danh sách nhân sự" (Google Sheets) thành object
 * employee — CHỈ còn dùng bởi script backfill một lần (server/scripts/
 * backfillUsersAndHrToPostgres.js); app đang chạy không còn đọc Sheet này.
 */
function parseEmployeeRows(values, sourceBranch) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new HrDirectoryError('Tab Danh sách nhân sự không có hàng tiêu đề.', 'HR_DIRECTORY_SCHEMA_INVALID', 503);
  }
  const headerIndex = new Map(values[0].map((header, index) => [normalizeText(header), index]));
  const indexes = {};
  for (const [key, header] of Object.entries(REQUIRED_HEADERS)) {
    const index = headerIndex.get(normalizeText(header));
    if (index === undefined) {
      throw new HrDirectoryError(`Thiếu cột bắt buộc "${header}" trong Danh sách nhân sự.`, 'HR_DIRECTORY_SCHEMA_INVALID', 503);
    }
    indexes[key] = index;
  }

  return values.slice(1).map((row, offset) => ({ row, offset })).filter(({ row }) => (
    Array.isArray(row) && row.some(value => value !== '' && value !== undefined && value !== null)
  )).map(({ row, offset }) => ({
    sourceBranch,
    rowIndex: offset + 2,
    hoTen: String(row[indexes.hoTen] || '').trim(),
    boPhan: String(row[indexes.boPhan] || '').trim(),
    email: normalizeEmail(row[indexes.email]),
    soDienThoai: normalizePhone(row[indexes.soDienThoai]),
    telegramId: normalizeTelegramId(row[indexes.telegramId]),
    sheetVaiTro: roleForDepartment(row[indexes.boPhan]),
    sheetCoSo: BRANCH_BOTH
  }));
}

function uniqueMatch(employees, predicate) {
  const matches = employees.filter(predicate);
  if (matches.length > 1) {
    throw new HrDirectoryError('Định danh nhân sự xuất hiện ở nhiều dòng.', 'HR_IDENTITY_CONFLICT');
  }
  return matches[0] || null;
}

function findEmployeeByIdentifier(employees, identifier) {
  const source = identifier && typeof identifier === 'object'
    ? identifier
    : (String(identifier || '').includes('@') ? { email: identifier } : { phone: identifier });
  const email = normalizeEmail(source.email);
  const phone = normalizePhone(source.phone || source.soDienThoai);
  const byEmail = email ? uniqueMatch(employees, employee => employee.email === email) : null;
  const byPhone = phone ? uniqueMatch(employees, employee => employee.soDienThoai === phone) : null;
  if (byEmail && byPhone && byEmail.rowIndex !== byPhone.rowIndex) {
    throw new HrDirectoryError('Email và số điện thoại đang trỏ tới hai nhân sự khác nhau.', 'HR_IDENTITY_CONFLICT');
  }
  return byEmail || byPhone || null;
}

/**
 * `repo.selectAllActive()` trả về hàng thô (branch, hoTen, boPhan, email,
 * soDienThoai, telegramId, id) từ bảng Postgres `hr_employees`. Hàm này ánh
 * xạ sang hình dạng employee đã dùng khắp nơi (effectiveUserResolver.js,
 * adminUserRoutes.js...): `sourceBranch` là nhãn tiếng Việt (như Sheet cũ),
 * `rowIndex` giờ là `hr_employees.id` thật (ổn định, không lệch khi có dòng
 * bị thêm/xoá — khác con trỏ số dòng Sheet cũ).
 */
function mapEmployeeRow(row) {
  return {
    sourceBranch: branchCodeToLabel(row.branch),
    rowIndex: row.id,
    hoTen: row.hoTen,
    boPhan: row.boPhan,
    email: row.email,
    soDienThoai: row.soDienThoai,
    telegramId: row.telegramId,
    sheetVaiTro: roleForDepartment(row.boPhan),
    sheetCoSo: BRANCH_BOTH
  };
}

function createEmployeeDirectory(options = {}) {
  const now = options.now || (() => Date.now());
  const repo = options.repo || hrEmployeesRepository;

  async function fetchSnapshot() {
    const rows = await repo.selectAllActive();
    return { employees: rows.map(mapEmployeeRow) };
  }

  const cache = createTtlSnapshotCache({
    fetch: fetchSnapshot,
    freshTtlMs: FRESH_TTL_MS,
    staleTtlMs: STALE_TTL_MS,
    now,
    onUnavailable: () => {
      throw new HrDirectoryError('Không thể đối chiếu Danh sách nhân sự.', 'HR_DIRECTORY_UNAVAILABLE', 503);
    }
  });

  async function getSnapshot(getOptions = {}) {
    return cache.get(getOptions);
  }

  function clearCache() {
    cache.clear();
  }

  async function updateEmployeeContact(originalEmployee, field, rawValue) {
    if (!['email', 'phone'].includes(field)) {
      throw new HrDirectoryError('Trường liên hệ không hợp lệ.', 'INVALID_CONTACT_FIELD', 400);
    }
    const normalizedValue = field === 'email' ? normalizeEmail(rawValue) : normalizePhone(rawValue);
    if (!normalizedValue) throw new HrDirectoryError('Giá trị liên hệ không hợp lệ.', 'INVALID_CONTACT_VALUE', 400);

    const snapshot = await getSnapshot({ forceRefresh: true });
    const duplicate = snapshot.employees.find(employee => (
      employee.rowIndex !== originalEmployee.rowIndex &&
      (field === 'email' ? employee.email === normalizedValue : employee.soDienThoai === normalizedValue)
    ));
    if (duplicate) {
      throw new HrDirectoryError('Email hoặc số điện thoại đã thuộc nhân sự khác.', 'HR_IDENTITY_CONFLICT', 409);
    }

    const updated = await repo.updateContactById(originalEmployee.rowIndex, field, normalizedValue);
    if (!updated) {
      throw new HrDirectoryError('Không xác định duy nhất dòng nhân sự cần cập nhật.', 'HR_IDENTITY_CONFLICT', 409);
    }
    clearCache();
    const refreshed = await getSnapshot({ forceRefresh: true });
    return findEmployeeByIdentifier(refreshed.employees, normalizedValue);
  }

  async function writeDepartmentForRole(sourceBranch, rowIndex, role) {
    const department = DEPARTMENT_FOR_ROLE[role];
    if (!department || !sourceBranch || !rowIndex) return false;
    const updated = await repo.updateDepartmentById(rowIndex, department);
    if (!updated) return false;
    clearCache();
    return true;
  }

  return { getSnapshot, clearCache, updateEmployeeContact, writeDepartmentForRole };
}

const defaultDirectory = createEmployeeDirectory();

module.exports = {
  FRESH_TTL_MS,
  STALE_TTL_MS,
  REQUIRED_HEADERS,
  DEPARTMENT_FOR_ROLE,
  HrDirectoryError,
  normalizeText,
  normalizeEmail,
  normalizeTelegramId,
  roleForDepartment,
  parseEmployeeRows,
  findEmployeeByIdentifier,
  createEmployeeDirectory,
  getSnapshot: defaultDirectory.getSnapshot,
  clearCache: defaultDirectory.clearCache,
  updateEmployeeContact: defaultDirectory.updateEmployeeContact,
  writeDepartmentForRole: defaultDirectory.writeDepartmentForRole
};
