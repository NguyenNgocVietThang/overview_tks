'use strict';

const CONFIG = require('../config');
const hrSheetsClient = require('../sheets/hrSheetsClient');
const { BRANCHES, BRANCH_BOTH } = require('../branch/branches');
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
    .replace(/[\u0300-\u036f]/g, '')
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
    'MARKETING': ROLES.KHACH,
    'HAU CAN': ROLES.KHACH,
    'BAO VE': ROLES.KHACH
  };
  return roles[department] || ROLES.KHACH;
}

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

function headerIndexes(values) {
  const index = new Map((values[0] || []).map((header, position) => [normalizeText(header), position]));
  return {
    email: index.get(normalizeText(REQUIRED_HEADERS.email)),
    phone: index.get(normalizeText(REQUIRED_HEADERS.soDienThoai))
  };
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
  if (byEmail && byPhone && (byEmail.sourceBranch !== byPhone.sourceBranch || byEmail.rowIndex !== byPhone.rowIndex)) {
    throw new HrDirectoryError('Email và số điện thoại đang trỏ tới hai nhân sự khác nhau.', 'HR_IDENTITY_CONFLICT');
  }
  return byEmail || byPhone || null;
}

function createEmployeeDirectory(options = {}) {
  const now = options.now || (() => Date.now());
  const getClient = options.getClient || (branch => hrSheetsClient.getHrClient(branch));
  const branches = options.branches || (() => {
    const result = [];
    if (CONFIG.HR_SPREADSHEET_ID) result.push(BRANCHES.HANOI);
    if (CONFIG.HR_SPREADSHEET_ID_SG) result.push(BRANCHES.SAIGON);
    return result;
  });
  let lastSuccess = null;
  let loading = null;

  async function fetchSnapshot() {
    const configuredBranches = branches();
    if (!configuredBranches.length) {
      throw new HrDirectoryError('Chưa cấu hình spreadsheet nhân sự.', 'HR_DIRECTORY_UNAVAILABLE', 503);
    }
    const groups = await Promise.all(configuredBranches.map(async branch => {
      const values = await getClient(branch).hrGetValues(CONFIG.HR_SHEET_EMPLOYEES || 'Danh sách nhân sự');
      return parseEmployeeRows(values, branch);
    }));
    return { employees: groups.flat(), loadedAt: now(), stale: false };
  }

  async function getSnapshot(options = {}) {
    const forceRefresh = !!options.forceRefresh;
    if (!forceRefresh && lastSuccess && now() - lastSuccess.loadedAt < FRESH_TTL_MS) return lastSuccess;
    if (loading) return loading;
    loading = fetchSnapshot().then(snapshot => {
      lastSuccess = snapshot;
      return snapshot;
    }).catch(err => {
      if (lastSuccess && now() - lastSuccess.loadedAt <= STALE_TTL_MS) {
        return { ...lastSuccess, stale: true };
      }
      if (err instanceof HrDirectoryError && err.code === 'HR_DIRECTORY_SCHEMA_INVALID') throw err;
      throw new HrDirectoryError('Không thể đối chiếu Danh sách nhân sự.', 'HR_DIRECTORY_UNAVAILABLE', 503);
    }).finally(() => { loading = null; });
    return loading;
  }

  function clearCache() {
    lastSuccess = null;
    loading = null;
  }

  async function updateEmployeeContact(originalEmployee, field, rawValue) {
    if (!['email', 'phone'].includes(field)) {
      throw new HrDirectoryError('Trường liên hệ không hợp lệ.', 'INVALID_CONTACT_FIELD', 400);
    }
    const normalizedValue = field === 'email' ? normalizeEmail(rawValue) : normalizePhone(rawValue);
    if (!normalizedValue) throw new HrDirectoryError('Giá trị liên hệ không hợp lệ.', 'INVALID_CONTACT_VALUE', 400);

    const snapshot = await getSnapshot({ forceRefresh: true });
    const duplicate = snapshot.employees.find(employee => {
      const sameRow = employee.sourceBranch === originalEmployee.sourceBranch && employee.rowIndex === originalEmployee.rowIndex;
      if (sameRow) return false;
      return field === 'email' ? employee.email === normalizedValue : employee.soDienThoai === normalizedValue;
    });
    if (duplicate) {
      throw new HrDirectoryError('Email hoặc số điện thoại đã thuộc nhân sự khác.', 'HR_IDENTITY_CONFLICT', 409);
    }

    const sourceMatches = snapshot.employees.filter(employee => (
      employee.sourceBranch === originalEmployee.sourceBranch &&
      ((originalEmployee.email && employee.email === originalEmployee.email) ||
       (originalEmployee.soDienThoai && employee.soDienThoai === originalEmployee.soDienThoai))
    ));
    if (sourceMatches.length !== 1) {
      throw new HrDirectoryError('Không xác định duy nhất dòng nhân sự cần cập nhật.', 'HR_IDENTITY_CONFLICT', 409);
    }
    const currentEmployee = sourceMatches[0];
    const client = getClient(currentEmployee.sourceBranch);
    if (client.invalidateHrSheetCache) client.invalidateHrSheetCache(CONFIG.HR_SHEET_EMPLOYEES || 'Danh sách nhân sự');
    const values = await client.hrGetValues(CONFIG.HR_SHEET_EMPLOYEES || 'Danh sách nhân sự');
    parseEmployeeRows(values, currentEmployee.sourceBranch);
    const indexes = headerIndexes(values);
    const row = [...(values[currentEmployee.rowIndex - 1] || [])];
    row[field === 'email' ? indexes.email : indexes.phone] = normalizedValue;
    await client.hrUpdateRow(CONFIG.HR_SHEET_EMPLOYEES || 'Danh sách nhân sự', currentEmployee.rowIndex, row);
    clearCache();
    const refreshed = await getSnapshot({ forceRefresh: true });
    return findEmployeeByIdentifier(refreshed.employees, normalizedValue);
  }

  return { getSnapshot, clearCache, updateEmployeeContact };
}

const defaultDirectory = createEmployeeDirectory();

module.exports = {
  FRESH_TTL_MS,
  STALE_TTL_MS,
  REQUIRED_HEADERS,
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
  updateEmployeeContact: defaultDirectory.updateEmployeeContact
};
