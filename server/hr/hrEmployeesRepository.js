// ==========================================
// HR EMPLOYEES REPOSITORY — truy cap bang Postgres `hr_employees`. Chi lam
// data access thuan (khong suy dien vai tro/coSo) — server/hr/employeeDirectory.js
// la noi gan sheetVaiTro (qua roleForDepartment)/sheetCoSo va giu nguyen hinh
// dang "employee" (sourceBranch, rowIndex...) da dung o effectiveUserResolver.js.
// ==========================================
'use strict';

const { getPool } = require('../db/pool');
const { normalizeGender } = require('./hrGender');

// Cot DATE cua Postgres duoc `pg` tra ve dang Date (nua dem gio may chu). Chuan hoa ve 'YYYY-MM-DD'
// de web, file Excel va phep tinh so ngay lam viec doc cung mot gia tri.
function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

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
    chucVu: row.chuc_vu || '',
    ngayVaoLam: dateOnly(row.ngay_vao_lam),
    ngaySinh: dateOnly(row.ngay_sinh),
    soCccd: row.so_cccd || '',
    diaChiHienTai: row.dia_chi_hien_tai || '',
    nguoiThanQuanHe: row.nguoi_than_quan_he || '',
    nguoiThanHoTen: row.nguoi_than_ho_ten || '',
    nguoiThanSoDienThoai: row.nguoi_than_so_dien_thoai || '',
    gioiTinh: normalizeGender(row.gioi_tinh),
    hoSoDayDu: !!row.ho_so_day_du,
    vanTayDaDangKy: !!row.van_tay_da_dang_ky,
    insuranceNumber: row.insurance_number || '',
    ngayNghiViec: dateOnly(row.ngay_nghi_viec),
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

async function updateExtendedById(id, row) {
  const sql = `UPDATE hr_employees SET
    chuc_vu=$1, ngay_vao_lam=$2, ngay_sinh=$3, so_cccd=$4, dia_chi_hien_tai=$5,
    nguoi_than_quan_he=$6, nguoi_than_ho_ten=$7, nguoi_than_so_dien_thoai=$8,
    gioi_tinh=$9, ho_so_day_du=$10, van_tay_da_dang_ky=$11, ngay_nghi_viec=$12,
    insurance_number=$13, updated_at=now() WHERE id=$14 AND is_active RETURNING *`;
  const { rows } = await getPool().query(sql, [row.chucVu || '', row.ngayVaoLam, row.ngaySinh,
    row.soCccd || '', row.diaChiHienTai || '', row.nguoiThanQuanHe || '', row.nguoiThanHoTen || '',
    row.nguoiThanSoDienThoai || '', row.gioiTinh || '', !!row.hoSoDayDu, !!row.vanTayDaDangKy,
    row.ngayNghiViec, row.insuranceNumber || '', id]);
  return rows[0] ? rowToEmployee(rows[0]) : null;
}

async function updateInsuranceNumbers(rows) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      const result = await client.query(
        'UPDATE hr_employees SET insurance_number=$1, updated_at=now() WHERE id=$2 AND is_active RETURNING id',
        [row.insuranceNumber, row.id]
      );
      if (result.rowCount !== 1) throw new Error(`Nhân sự ID ${row.id} không còn tồn tại.`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}

module.exports = {
  dateOnly,
  rowToEmployee,
  selectAllActive,
  insertEmployee,
  updateContactById,
  updateDepartmentById,
  updateEmployeeById,
  deactivateById,
  updateExtendedById,
  updateInsuranceNumbers
};
