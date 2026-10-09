// ==========================================
// HR EMPLOYEES REPOSITORY — truy cap bang Postgres `hr_employees`. Chi lam
// data access thuan (khong suy dien vai tro/coSo) — server/hr/employeeDirectory.js
// la noi gan sheetVaiTro (qua roleForDepartment)/sheetCoSo va giu nguyen hinh
// dang "employee" (sourceBranch, rowIndex...) da dung o effectiveUserResolver.js.
// ==========================================
'use strict';

const { getPool } = require('../db/pool');

function rowToEmployee(row) {
  return {
    id: Number(row.id),
    branch: row.branch,
    hoTen: row.ho_ten || '',
    boPhan: row.bo_phan || '',
    soDienThoai: row.so_dien_thoai || '',
    email: row.email || '',
    telegramId: row.telegram_id || '',
    employmentStatus: row.employment_status === 'resigned' ? 'resigned' : 'active',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : ''
  };
}

/**
 * Toàn bộ nhân sự đang hoạt động (is_active), mọi cơ sở — dùng làm snapshot
 * cho cache TTL trong employeeDirectory.js.
 */
async function selectAllActive() {
  const { rows } = await getPool().query(
    'SELECT * FROM hr_employees WHERE is_active ORDER BY id ASC'
  );
  return rows.map(rowToEmployee);
}

async function insertEmployee({ branch, hoTen, boPhan, soDienThoai, email, telegramId, employmentStatus }) {
  const sql = `
    INSERT INTO hr_employees (branch, ho_ten, bo_phan, so_dien_thoai, email, telegram_id, employment_status)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `;
  const { rows } = await getPool().query(sql, [
    branch, hoTen || '', boPhan || '', soDienThoai || '', email || '', telegramId || '',
    employmentStatus === 'resigned' ? 'resigned' : 'active'
  ]);
  return rowToEmployee(rows[0]);
}

async function updateContactById(id, field, value) {
  if (field !== 'email' && field !== 'phone') {
    throw new Error(`hrEmployeesRepository.updateContactById: field không hợp lệ "${field}".`);
  }
  const column = field === 'email' ? 'email' : 'so_dien_thoai';
  const sql = `UPDATE hr_employees SET ${column} = $1, updated_at = now() WHERE id = $2 AND is_active RETURNING *`;
  const { rows } = await getPool().query(sql, [value, id]);
  return rows[0] ? rowToEmployee(rows[0]) : null;
}

async function updateDepartmentById(id, boPhan) {
  const sql = `UPDATE hr_employees SET bo_phan = $1, updated_at = now() WHERE id = $2 AND is_active RETURNING *`;
  const { rows } = await getPool().query(sql, [boPhan, id]);
  return rows[0] ? rowToEmployee(rows[0]) : null;
}

/** Sua thong tin + trang thai lam viec trong 1 cau lenh (da duoc service kiem tra trung/quyen). */
async function updateEmployeeById(id, { hoTen, boPhan, branch, soDienThoai, email, employmentStatus }) {
  const sql = `
    UPDATE hr_employees
    SET ho_ten = $1, bo_phan = $2, branch = $3, so_dien_thoai = $4, email = $5,
        employment_status = $6, updated_at = now()
    WHERE id = $7 AND is_active
    RETURNING *
  `;
  const { rows } = await getPool().query(sql, [
    hoTen, boPhan, branch, soDienThoai, email, employmentStatus, id
  ]);
  return rows[0] ? rowToEmployee(rows[0]) : null;
}

async function deactivateById(id) {
  const sql = `UPDATE hr_employees SET is_active = false, updated_at = now() WHERE id = $1 RETURNING *`;
  const { rows } = await getPool().query(sql, [id]);
  return rows[0] ? rowToEmployee(rows[0]) : null;
}

module.exports = {
  rowToEmployee,
  selectAllActive,
  insertEmployee,
  updateContactById,
  updateDepartmentById,
  updateEmployeeById,
  deactivateById
};
