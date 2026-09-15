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
    telegramId: row.telegram_id || ''
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

async function insertEmployee({ branch, hoTen, boPhan, soDienThoai, email, telegramId }) {
  const sql = `
    INSERT INTO hr_employees (branch, ho_ten, bo_phan, so_dien_thoai, email, telegram_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;
  const { rows } = await getPool().query(sql, [
    branch, hoTen || '', boPhan || '', soDienThoai || '', email || '', telegramId || ''
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
  deactivateById
};
