// ==========================================
// APP USERS REPOSITORY — truy cap bang Postgres `app_users` (+ join
// `hr_employees` de suy ra hrSourceBranch). Day la tang duy nhat trong repo
// noi ket noi Postgres cho tai khoan dang nhap; localUserStore.js goi qua day
// thay vi tu viet SQL, giu logic validate/quy tac nghiep vu (trung
// username/email/SDT, bao ve hardcoded admin...) o localUserStore.js nhu cu.
//
// Object JS tra ve giu DUNG hinh dang cu (truoc khi co Postgres): coSo/vaiTro/
// trangThai/sheetVaiTro/... la chuoi tieng Viet nhu localUserStore.js/Sheets
// dang dung — chi rieng cot `co_so` trong DB dung dinh danh noi bo
// ('hanoi'/'saigon'/'both'/'') theo dung quy uoc branch da co (SCHEMA.md);
// moi chuyen doi Viet<->noi bo nam gon trong module nay.
// ==========================================
'use strict';

const { getPool } = require('../db/pool');
const { BRANCHES, BRANCH_BOTH, normalizeCoSo, branchCodeToLabel } = require('../branch/branches');

// co_so (app_users) co 3 trang thai + rong, khac voi branch (hr_employees,
// KiotViet) chi co 2 gia tri — xem ghi chu trong server/branch/branches.js.
const CO_SO_TO_DB = Object.freeze({
  [BRANCHES.HANOI]: 'hanoi',
  [BRANCHES.SAIGON]: 'saigon',
  [BRANCH_BOTH]: 'both',
  '': ''
});

const CO_SO_FROM_DB = Object.freeze({
  hanoi: BRANCHES.HANOI,
  saigon: BRANCHES.SAIGON,
  both: BRANCH_BOTH,
  '': ''
});

function coSoToDb(label) {
  const normalized = normalizeCoSo(label);
  return CO_SO_TO_DB[normalized] || '';
}

function coSoFromDb(code) {
  return CO_SO_FROM_DB[code || ''] || '';
}

function toIsoOrNull(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toBigIntOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Anh xa 1 dong SQL (app_users JOIN hr_employees) -> object user dung dinh
// dang camelCase hien co. `hr_branch` la cot ket qua cua LEFT JOIN, co the null.
function rowToUser(row) {
  return {
    id: row.id,
    hoTen: row.ho_ten || '',
    username: row.username || '',
    passwordHash: row.password_hash || '',
    vaiTro: row.vai_tro || '',
    coSo: coSoFromDb(row.co_so),
    trangThai: row.trang_thai || '',
    ngayTao: row.ngay_tao || '',
    dangNhapGanNhat: row.dang_nhap_gan_nhat || '',
    email: row.email || '',
    soDienThoai: row.so_dien_thoai || '',
    telegramId: row.telegram_id || '',
    emailKhoiPhuc: row.email_khoi_phuc || '',
    sdtKhoiPhuc: row.sdt_khoi_phuc || '',
    isDeleted: !!row.is_deleted,
    lockReason: row.lock_reason || '',
    hrManaged: !!row.hr_managed,
    hrSourceBranch: branchCodeToLabel(row.hr_branch),
    hrRowIndex: row.hr_employee_id != null ? Number(row.hr_employee_id) : '',
    hrMatchedAt: row.hr_matched_at ? new Date(row.hr_matched_at).toISOString() : '',
    sheetVaiTro: row.sheet_vai_tro || '',
    sheetCoSo: row.sheet_co_so || '',
    vaiTroOverride: row.vai_tro_override || '',
    coSoOverride: row.co_so_override || '',
    roleSource: row.role_source || '',
    legacyOverride: !!row.legacy_override,
    verifiedEmail: !!row.verified_email,
    verifiedPhone: !!row.verified_phone,
    hrVerificationRequired: !!row.hr_verification_required
  };
}

// Danh sach cot co the ghi (INSERT/UPDATE), cung ham chuyen gia tri JS -> SQL.
const WRITABLE_COLUMNS = Object.freeze([
  ['hoTen', 'ho_ten', v => String(v || '')],
  ['username', 'username', v => String(v || '')],
  ['passwordHash', 'password_hash', v => String(v || '')],
  ['vaiTro', 'vai_tro', v => String(v || '')],
  ['coSo', 'co_so', v => coSoToDb(v)],
  ['trangThai', 'trang_thai', v => String(v || '')],
  ['ngayTao', 'ngay_tao', v => String(v || '')],
  ['dangNhapGanNhat', 'dang_nhap_gan_nhat', v => String(v || '')],
  ['email', 'email', v => String(v || '')],
  ['soDienThoai', 'so_dien_thoai', v => String(v || '')],
  ['telegramId', 'telegram_id', v => String(v || '').trim()],
  ['emailKhoiPhuc', 'email_khoi_phuc', v => String(v || '')],
  ['sdtKhoiPhuc', 'sdt_khoi_phuc', v => String(v || '')],
  ['isDeleted', 'is_deleted', v => !!v],
  ['lockReason', 'lock_reason', v => String(v || '')],
  ['hrManaged', 'hr_managed', v => !!v],
  // hrSourceBranch KHONG co cot rieng — suy ra tu JOIN hr_employees, chi ghi
  // hr_employee_id (hrRowIndex) la du de xac dinh branch mot cach nhat quan.
  ['hrRowIndex', 'hr_employee_id', v => toBigIntOrNull(v)],
  ['hrMatchedAt', 'hr_matched_at', v => toIsoOrNull(v)],
  ['sheetVaiTro', 'sheet_vai_tro', v => String(v || '')],
  ['sheetCoSo', 'sheet_co_so', v => String(v || '')],
  ['vaiTroOverride', 'vai_tro_override', v => String(v || '')],
  ['coSoOverride', 'co_so_override', v => String(v || '')],
  ['roleSource', 'role_source', v => String(v || '')],
  ['legacyOverride', 'legacy_override', v => !!v],
  ['verifiedEmail', 'verified_email', v => !!v],
  ['verifiedPhone', 'verified_phone', v => !!v],
  ['hrVerificationRequired', 'hr_verification_required', v => !!v]
]);

const SELECT_SQL = `
  SELECT u.*, e.branch AS hr_branch
  FROM app_users u
  LEFT JOIN hr_employees e ON e.id = u.hr_employee_id
`;

/**
 * Lấy toàn bộ tài khoản chưa bị xóa mềm — dùng làm snapshot cho cache TTL
 * trong localUserStore.js (không lọc thêm theo trạng thái ở đây, việc lọc
 * theo Khóa/Chờ duyệt/... là logic nghiệp vụ, để ở localUserStore.js).
 */
async function selectAllRows() {
  const { rows } = await getPool().query(`${SELECT_SQL} WHERE NOT u.is_deleted`);
  return rows.map(rowToUser);
}

async function insertUser(user) {
  const columns = ['id'];
  const placeholders = ['$1'];
  const values = [user.id];
  let i = 2;
  for (const [jsKey, dbCol, toSql] of WRITABLE_COLUMNS) {
    columns.push(dbCol);
    placeholders.push(`$${i}`);
    values.push(toSql(user[jsKey]));
    i += 1;
  }
  const sql = `INSERT INTO app_users (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
  const { rows } = await getPool().query(sql, values);
  return rowToUser({ ...rows[0], hr_branch: null });
}

async function attachBranch(row) {
  if (!row.hr_employee_id) return rowToUser({ ...row, hr_branch: null });
  const { rows } = await getPool().query('SELECT branch FROM hr_employees WHERE id = $1', [row.hr_employee_id]);
  return rowToUser({ ...row, hr_branch: rows[0] ? rows[0].branch : null });
}

/**
 * Cập nhật một phần (patch) theo id. Chỉ các field nằm trong WRITABLE_COLUMNS
 * mới được ghi; field lạ (ví dụ hrSourceBranch — chỉ đọc, suy ra từ join) bị
 * bỏ qua âm thầm, đúng ý định "derived field".
 */
async function updateUserRow(id, patch) {
  const sets = [];
  const values = [];
  let i = 1;
  for (const [jsKey, dbCol, toSql] of WRITABLE_COLUMNS) {
    if (!(jsKey in patch)) continue;
    sets.push(`${dbCol} = $${i}`);
    values.push(toSql(patch[jsKey]));
    i += 1;
  }
  if (!sets.length) {
    const { rows } = await getPool().query(`${SELECT_SQL} WHERE u.id = $1`, [id]);
    return rows[0] ? rowToUser(rows[0]) : null;
  }
  sets.push('updated_at = now()');
  values.push(id);
  const sql = `UPDATE app_users SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`;
  const { rows } = await getPool().query(sql, values);
  if (!rows.length) return null;
  return attachBranch(rows[0]);
}

async function softDeleteUser(id) {
  const sql = `
    UPDATE app_users
    SET is_deleted = true, trang_thai = 'Đã xóa', updated_at = now()
    WHERE id = $1
    RETURNING *
  `;
  const { rows } = await getPool().query(sql, [id]);
  if (!rows.length) return null;
  return attachBranch(rows[0]);
}

module.exports = {
  coSoToDb,
  coSoFromDb,
  rowToUser,
  selectAllRows,
  insertUser,
  updateUserRow,
  softDeleteUser
};
