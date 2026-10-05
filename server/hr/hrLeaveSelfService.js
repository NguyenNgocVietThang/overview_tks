'use strict';
const { getPool } = require('../db/pool');
const leaveRepo = require('./hrLeaveRepository');
const { branchCodeToLabel } = require('../branch/branches');
const { parseIsoDateOnly, computeDurationSessions, computeVietnamLeaveTiming } = require('./hrLeaveService');

// Never resolve by editable display name, email or username. The stable FK is the identity.
async function loadActiveProfile(userId, pool = getPool()) {
  const { rows } = await pool.query(`
    SELECT u.id AS user_id, u.username, u.vai_tro, u.telegram_id, e.id AS hr_employee_id,
           e.ho_ten, e.bo_phan, e.branch
    FROM app_users u JOIN hr_employees e ON e.id = u.hr_employee_id
    WHERE u.id = $1 AND u.trang_thai = 'Đang hoạt động' AND NOT u.is_deleted AND e.is_active
  `, [userId]);
  return rows[0] || null;
}
function createHrLeaveSelfService({ loadProfile = loadActiveProfile, repo = leaveRepo, now = () => new Date() } = {}) {
  async function context(user) {
    const row = user && user.id ? await loadProfile(user.id) : null;
    if (!row) return { eligible: false, profile: null };
    return { eligible: true, profile: {
      userId: row.user_id, hrEmployeeId: row.hr_employee_id, username: row.username, telegramChatId: row.telegram_id || '',
      hoTen: row.ho_ten, boPhan: row.bo_phan, coSo: branchCodeToLabel(row.branch), vaiTro: row.vai_tro
    } };
  }
  async function submit(user, body = {}) {
    const ctx = await context(user);
    if (!ctx.eligible) throw new leaveRepo.HrError('Tài khoản cần đang hoạt động và liên kết nhân sự đang hoạt động.', 403, 'SELF_LEAVE_INELIGIBLE');
    if (typeof body.ly_do !== 'string' || !body.ly_do.trim()) throw new leaveRepo.HrError('Vui lòng nhập lý do nghỉ.', 400, 'INVALID_REASON');
    if (body.nguoi_ban_giao != null && typeof body.nguoi_ban_giao !== 'string') throw new leaveRepo.HrError('Người bàn giao phải là chuỗi ký tự.', 400, 'INVALID_HANDOVER');
    if (body.end_date != null && typeof body.end_date !== 'string') throw new leaveRepo.HrError('Ngày kết thúc không hợp lệ.', 400, 'INVALID_LEAVE_RANGE');
    const startDate = typeof body.start_date === 'string' ? body.start_date.trim() : '';
    const start = parseIsoDateOnly(startDate);
    const endDate = typeof body.end_date === 'string' && body.end_date.trim() ? body.end_date.trim() : startDate;
    const end = parseIsoDateOnly(endDate);
    const duration = computeDurationSessions(start, body.start_session, end, body.end_session);
    if (!duration || duration <= 0) throw new leaveRepo.HrError('Khoảng thời gian nghỉ không hợp lệ.', 400, 'INVALID_LEAVE_RANGE');
    const submittedAt = now();
    const timing = computeVietnamLeaveTiming(startDate, body.start_session, submittedAt);
    const profile = ctx.profile;
    return repo.createLeaveRequest({
      user_id: profile.userId, hr_employee_id: profile.hrEmployeeId, web_username: profile.username,
      telegram_chat_id: profile.telegramChatId,
      ho_ten: profile.hoTen, bo_phan: profile.boPhan, chuc_vu: profile.vaiTro,
      ly_do: body.ly_do.trim(), nguoi_ban_giao: (body.nguoi_ban_giao || '').trim(),
      start_date: startDate, start_session: body.start_session,
      end_date: endDate, end_session: body.end_session,
      tong_buoi_nghi: duration, tong_ngay_nghi: duration / 2,
      thoi_gian_gui: new Date(submittedAt).toISOString(),
      co_nghi_gap: timing.urgent, co_tu_y_nghi: false,
      trang_thai: timing.submissionViolation ? leaveRepo.LEAVE_STATUS.VIOLATION : leaveRepo.LEAVE_STATUS.PENDING,
      loai_yeu_cau: leaveRepo.LEAVE_TYPE.REQUEST
    }, profile.coSo);
  }
  return { context, submit };
}
module.exports = { createHrLeaveSelfService, loadActiveProfile };
