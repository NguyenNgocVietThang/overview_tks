// ==========================================
// HR LEAVE REPOSITORY — bang Postgres `hr_leave_requests` (migration 0016).
//
// Web chi doc + tao ban ghi nhap tay ("tu y nghi") + doi trang thai phe duyet.
// Don do bot Telegram (chay ngoai repo nay) tu INSERT thang vao cung bang;
// lien ket Telegram (`hr_telegram_links`) va phien hoi thoai
// (`hr_telegram_sessions`) do bot so huu hoan toan — web khong doc/ghi.
//
// Hinh dang ban ghi tra ve GIU NGUYEN nhu thoi con Google Sheets (chuoi
// "Sáng 22/08/2026" cho moc nghi, co_* la boolean...) de frontend/Excel export
// khong phai doi; cot that trong DB la ngay + buoi rieng (xem migration).
// ==========================================
'use strict';

const CONFIG = require('../config');
const { getPool } = require('../db/pool');
const { BRANCHES, branchLabelToCode, branchCodeToLabel } = require('../branch/branches');
const { matchesDepartment } = require('./hrDepartment');

// Thu tu = thu tu cot trong file Excel xuat ra (hrLeaveExportService.js).
const LEAVE_SCHEMA_HEADERS = [
  'Mã yêu cầu', 'Telegram chat_id', 'Telegram username', 'Tài khoản web',
  'Họ tên', 'Chức vụ', 'Lý do nghỉ', 'Loại yêu cầu',
  'Thời gian gửi', 'Thời gian bắt đầu', 'Thời gian kết thúc',
  'Tổng buổi nghỉ', 'Tổng ngày nghỉ quy đổi', 'Người bàn giao',
  'Trạng thái phê duyệt', 'Người phê duyệt', 'Thời điểm phê duyệt', 'Ghi chú/lý do từ chối',
  'Cờ nghỉ gấp', 'Cờ tự ý nghỉ', 'Thời gian tạo', 'Cập nhật lần cuối',
  'Tin nhắn', 'Cơ sở', 'Phòng ban'
];

const LEAVE_SCHEMA_FIELD_KEYS = [
  'request_id', 'telegram_chat_id', 'telegram_username', 'web_username',
  'ho_ten', 'chuc_vu', 'ly_do', 'loai_yeu_cau',
  'thoi_gian_gui', 'thoi_gian_bat_dau', 'thoi_gian_ket_thuc',
  'tong_buoi_nghi', 'tong_ngay_nghi', 'nguoi_ban_giao',
  'trang_thai', 'nguoi_duyet', 'thoi_diem_duyet', 'ghi_chu_duyet',
  'co_nghi_gap', 'co_tu_y_nghi', 'created_at', 'updated_at',
  'tin_nhan', 'co_so', 'bo_phan'
];

const LEAVE_TYPE = Object.freeze({
  REQUEST: 'Xin nghỉ phép',
  MANUAL_ABSENCE: 'Tự ý nghỉ (HR ghi nhận)'
});

const LEAVE_STATUS = Object.freeze({
  PENDING: 'Chưa duyệt',
  PROVISIONAL: 'Tạm duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  VIOLATION: 'Vi phạm'
});

const SESSIONS = Object.freeze(['Sáng', 'Chiều']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- Loi nghiep vu (statusCode < 500 duoc handleError() o routes tra thang) ---

class HrError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode || 400;
    this.code = code || 'HR_ERROR';
  }
}

// ---- Tien ich -------------------------------------------------------------

// Chuan hoa chuoi tim theo ten: gop khoang trang, ha chu — de "  Nguyen   Van A"
// va "nguyen van a" khop nhau. Loc o JS (khong o SQL) vi lower()/ILIKE cua
// Postgres phu thuoc collation cua DB va co the khong ha chu duoc tieng Viet.
function normalizeNameQuery(value) {
  return String(value || '')
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('vi-VN');
}

function toBranchCode(branch) {
  const code = branchLabelToCode(branch || BRANCHES.HANOI);
  if (!code) throw new HrError(`Cơ sở không hợp lệ: "${branch}".`, 400, 'INVALID_BRANCH');
  return code;
}

// Nhan 1 co so hoac danh sach co so (nguoi dung xem "Tat ca co so") -> mang ma.
// Mang rong = khong co co so nao duoc phep => khong truy van duoc du lieu nao.
function toBranchCodes(branches) {
  const list = Array.isArray(branches) ? branches : [branches];
  return Array.from(new Set(list.map(toBranchCode)));
}

// Tai khoan hard-code (admin) co the khong co id dang UUID -> luu NULL thay vi
// de Postgres nem loi 22P02.
function uuidOrNull(value) {
  const text = String(value || '').trim();
  return UUID.test(text) ? text : null;
}

function isoDateOrThrow(value, field) {
  const text = String(value || '').trim().slice(0, 10);
  if (!ISO_DATE.test(text)) {
    throw new HrError(`"${field}" phải có dạng YYYY-MM-DD.`, 400, 'INVALID_DATE');
  }
  return text;
}

function toIso(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

// 'YYYY-MM-DD' (DATE::text) + buoi -> 'Sáng 22/08/2026'.
function boundaryLabel(isoDate, session) {
  const [year, month, day] = String(isoDate).split('-');
  return `${session} ${day}/${month}/${year}`;
}

// Phong ban = bo_phan cua nhan su (hr_employees) gan voi don: khoa that
// hr_employee_id cua don, neu bot chua dien thi di vong qua tai khoan (user_id).
// Dung subquery (khong JOIN) de cung dung duoc trong RETURNING cua INSERT/UPDATE.
const SELECT_COLUMNS = `
  request_id, telegram_chat_id, telegram_username, web_username,
  ho_ten, chuc_vu, ly_do, loai_yeu_cau, thoi_gian_gui,
  start_date::text AS start_date, start_session,
  end_date::text AS end_date, end_session,
  tong_buoi_nghi, tong_ngay_nghi, nguoi_ban_giao,
  trang_thai, nguoi_duyet, thoi_diem_duyet, ghi_chu_duyet,
  co_nghi_gap, co_tu_y_nghi, created_at, updated_at, tin_nhan,
  branch,
  (SELECT e.bo_phan FROM hr_employees e
    WHERE e.id = COALESCE(
      hr_leave_requests.hr_employee_id,
      (SELECT u.hr_employee_id FROM app_users u WHERE u.id = hr_leave_requests.user_id)
    )) AS bo_phan`;

function rowToRequest(row) {
  return {
    request_id: row.request_id,
    telegram_chat_id: row.telegram_chat_id || '',
    telegram_username: row.telegram_username || '',
    web_username: row.web_username || '',
    ho_ten: row.ho_ten || '',
    chuc_vu: row.chuc_vu || '',
    ly_do: row.ly_do || '',
    loai_yeu_cau: row.loai_yeu_cau,
    thoi_gian_gui: toIso(row.thoi_gian_gui),
    thoi_gian_bat_dau: boundaryLabel(row.start_date, row.start_session),
    thoi_gian_ket_thuc: boundaryLabel(row.end_date, row.end_session),
    tong_buoi_nghi: Number(row.tong_buoi_nghi),
    tong_ngay_nghi: Number(row.tong_ngay_nghi),
    nguoi_ban_giao: row.nguoi_ban_giao || '',
    trang_thai: row.trang_thai,
    nguoi_duyet: row.nguoi_duyet || '',
    thoi_diem_duyet: toIso(row.thoi_diem_duyet),
    ghi_chu_duyet: row.ghi_chu_duyet || '',
    co_nghi_gap: !!row.co_nghi_gap,
    co_tu_y_nghi: !!row.co_tu_y_nghi,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    tin_nhan: row.tin_nhan || '',
    co_so: branchCodeToLabel(row.branch),
    bo_phan: row.bo_phan || ''
  };
}

function createHrLeaveRepository({ pool = getPool() } = {}) {
  /**
   * @param {Object} filters { status, employee, department, from, to } — from/to 'YYYY-MM-DD',
   *   loc theo KHOANG NGHI thuc te (giao voi [from, to]), khong theo ngay gui.
   * @param {string|string[]} branch Co so, hoac danh sach co so (xem "Tat ca co so").
   */
  async function getLeaveRequests(filters, branch) {
    filters = filters || {};
    const params = [toBranchCodes(branch)];
    const where = ['branch = ANY($1::text[])'];

    if (filters.status) {
      params.push(filters.status);
      where.push(`trang_thai = $${params.length}`);
    }
    if (filters.from) {
      params.push(isoDateOrThrow(filters.from, 'from'));
      where.push(`end_date >= $${params.length}::date`);
    }
    if (filters.to) {
      params.push(isoDateOrThrow(filters.to, 'to'));
      where.push(`start_date <= $${params.length}::date`);
    }

    const { rows } = await pool.query(
      `SELECT ${SELECT_COLUMNS} FROM hr_leave_requests
        WHERE ${where.join(' AND ')}
        ORDER BY thoi_gian_gui DESC, id DESC`,
      params
    );
    let items = rows.map(rowToRequest);

    if (filters.employee) {
      const needle = normalizeNameQuery(filters.employee);
      items = items.filter(item =>
        normalizeNameQuery(item.ho_ten).includes(needle) ||
        normalizeNameQuery(item.web_username).includes(needle)
      );
    }
    if (filters.department) {
      items = items.filter(item => matchesDepartment(item.bo_phan, filters.department));
    }
    return items;
  }

  async function getLeaveRequestById(id, branch) {
    const { rows } = await pool.query(
      `SELECT ${SELECT_COLUMNS} FROM hr_leave_requests WHERE request_id = $1 AND branch = ANY($2::text[])`,
      [id, toBranchCodes(branch)]
    );
    return rows[0] ? rowToRequest(rows[0]) : null;
  }

  /**
   * Tao 1 yeu cau nghi phep nhap tay (Quan ly ghi nhan). Don tu Telegram do bot
   * INSERT truc tiep, khong qua ham nay.
   * Khoang nghi truyen dang cau truc: start_date/end_date 'YYYY-MM-DD' +
   * start_session/end_session ('Sáng' | 'Chiều').
   */
  async function createLeaveRequest(data, branch) {
    const totalSessions = Number(data.tong_buoi_nghi);
    if (!Number.isInteger(totalSessions) || totalSessions <= 0) {
      throw new HrError('Tổng buổi nghỉ phải là số nguyên dương.', 400, 'INVALID_TOTAL_SESSIONS');
    }
    if (!SESSIONS.includes(data.start_session) || !SESSIONS.includes(data.end_session)) {
      throw new HrError('Buổi nghỉ phải là "Sáng" hoặc "Chiều".', 400, 'INVALID_LEAVE_RANGE');
    }
    const startDate = isoDateOrThrow(data.start_date, 'start_date');
    const endDate = isoDateOrThrow(data.end_date, 'end_date');
    const decidedAt = data.thoi_diem_duyet || null;

    const { rows } = await pool.query(
      `INSERT INTO hr_leave_requests (
         branch, source, user_id, web_username, ho_ten, chuc_vu,
         telegram_chat_id, telegram_username,
         loai_yeu_cau, ly_do, tin_nhan, nguoi_ban_giao, thoi_gian_gui,
         start_date, start_session, end_date, end_session, tong_buoi_nghi,
         trang_thai, nguoi_duyet, approver_user_id, thoi_diem_duyet, ghi_chu_duyet,
         decision_notified_at, co_nghi_gap, co_tu_y_nghi
       ) VALUES (
         $1, $2,
         COALESCE($3::uuid, (SELECT id FROM app_users
                              WHERE lower(username) = lower(NULLIF($4, '')) AND NOT is_deleted)),
         $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13::timestamptz, now()),
         $14::date, $15, $16::date, $17, $18,
         $19, $20, $21, $22::timestamptz, $23,
         CASE WHEN $22::timestamptz IS NOT NULL THEN now() END, $24, $25
       )
       RETURNING ${SELECT_COLUMNS}`,
      [
        toBranchCode(branch), data.source || 'web', uuidOrNull(data.user_id),
        data.web_username || '', data.ho_ten || '', data.chuc_vu || '',
        data.telegram_chat_id || '', data.telegram_username || '',
        data.loai_yeu_cau || LEAVE_TYPE.REQUEST, data.ly_do || '', data.tin_nhan || '',
        data.nguoi_ban_giao || '', data.thoi_gian_gui || null,
        startDate, data.start_session, endDate, data.end_session, totalSessions,
        data.trang_thai || LEAVE_STATUS.PENDING, data.nguoi_duyet || '',
        uuidOrNull(data.approver_user_id), decidedAt, data.ghi_chu_duyet || '',
        !!data.co_nghi_gap, !!data.co_tu_y_nghi
      ]
    );
    return rowToRequest(rows[0]);
  }

  /**
   * Doi trang thai phe duyet 1 yeu cau. Trigger DB tu xoa decision_notified_at
   * khi trang_thai doi de bot bao lai cho nhan vien.
   */
  async function updateLeaveRequestStatus(id, { status, approver, approverUserId, note }, branch) {
    if (!Object.values(LEAVE_STATUS).includes(status)) {
      throw new HrError(`Trạng thái không hợp lệ: "${status}".`, 400, 'INVALID_STATUS');
    }
    const { rows } = await pool.query(
      `UPDATE hr_leave_requests SET
         trang_thai = $3,
         nguoi_duyet = COALESCE(NULLIF($4, ''), nguoi_duyet),
         approver_user_id = COALESCE($5::uuid, approver_user_id),
         thoi_diem_duyet = now(),
         ghi_chu_duyet = COALESCE($6, ghi_chu_duyet)
       WHERE request_id = $1 AND branch = ANY($2::text[])
       RETURNING ${SELECT_COLUMNS}`,
      [id, toBranchCodes(branch), status, approver || '', uuidOrNull(approverUserId), note != null ? note : null]
    );
    if (!rows[0]) {
      throw new HrError(`Không tìm thấy yêu cầu nghỉ phép "${id}".`, 404, 'LEAVE_REQUEST_NOT_FOUND');
    }
    return rowToRequest(rows[0]);
  }

  /**
   * Dem so lan "nghi gap" theo tung nhan vien trong 1 thang (theo ngay bat dau
   * nghi) — badge canh bao.
   * @param {string} month 'YYYY-MM', mac dinh la thang hien tai
   */
  async function getUrgentFlagSummary(month, branch) {
    const targetMonth = month || new Date().toISOString().slice(0, 7);
    if (!ISO_MONTH.test(targetMonth)) {
      throw new HrError('"month" phải có dạng YYYY-MM.', 400, 'INVALID_MONTH');
    }
    const { rows } = await pool.query(
      `SELECT web_username, ho_ten FROM hr_leave_requests
        WHERE branch = ANY($1::text[]) AND co_nghi_gap
          AND start_date >= ($2 || '-01')::date
          AND start_date <  (($2 || '-01')::date + interval '1 month')`,
      [toBranchCodes(branch), targetMonth]
    );

    const counts = new Map(); // web_username || ho_ten -> { web_username, ho_ten, count }
    rows.forEach(row => {
      const key = row.web_username || row.ho_ten || 'unknown';
      const entry = counts.get(key) || { web_username: row.web_username, ho_ten: row.ho_ten, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    });
    return Array.from(counts.values()).map(entry => Object.assign(entry, {
      month: targetMonth,
      isOverThreshold: entry.count > CONFIG.HR_URGENT_FLAG_MONTHLY_THRESHOLD
    }));
  }

  return { getLeaveRequests, getLeaveRequestById, createLeaveRequest, updateLeaveRequestStatus, getUrgentFlagSummary };
}

const repository = createHrLeaveRepository();

module.exports = {
  LEAVE_TYPE,
  LEAVE_STATUS,
  LEAVE_SCHEMA_HEADERS,
  LEAVE_SCHEMA_FIELD_KEYS,
  HrError,
  createHrLeaveRepository,
  getLeaveRequests: (...args) => repository.getLeaveRequests(...args),
  getLeaveRequestById: (...args) => repository.getLeaveRequestById(...args),
  createLeaveRequest: (...args) => repository.createLeaveRequest(...args),
  updateLeaveRequestStatus: (...args) => repository.updateLeaveRequestStatus(...args),
  getUrgentFlagSummary: (...args) => repository.getUrgentFlagSummary(...args)
};
