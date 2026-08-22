// ==========================================
// HR LEAVE SERVICE — logic nghiep vu: tinh buoi nghi, co "nghi gap", resolve
// danh tinh nguoi gui/nguoi duyet tu users.json (khong doc qua Telegram).
// ==========================================
'use strict';

const CONFIG = require('../config');
const userRepository = require('../auth/userRepository');

/**
 * Tinh so buoi nghi dua tren ngay + buoi bat dau/ket thuc.
 *
 * Moi ngay thuong co 2 buoi; Chu nhat bi bo qua hoan toan. Khoang tinh bao
 * gom ca buoi bat dau va buoi ket thuc.
 *
 * @param {Date} startDate  - Doi tuong Date ngay bat dau (chi dung phan ngay)
 * @param {'Sáng'|'Chiều'} startSession - Buoi bat dau
 * @param {Date} endDate    - Doi tuong Date ngay ket thuc (chi dung phan ngay)
 * @param {'Sáng'|'Chiều'} endSession   - Buoi ket thuc
 * @returns {number|null}   - So buoi nguyen (co the bang 0 neu chi co Chu nhat),
 *                            hoac null neu thu tu/dau vao khong hop le
 */
function computeDurationSessions(startDate, startSession, endDate, endSession) {
  const sessionIndex = { 'Sáng': 0, 'Chiều': 1 };
  if (startDate == null || endDate == null) return null;
  if (!(startSession in sessionIndex) || !(endSession in sessionIndex)) return null;

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  if (end < start) return null;
  if (end.getTime() === start.getTime() && sessionIndex[endSession] < sessionIndex[startSession]) {
    return null;
  }

  let totalSessions = 0;
  for (const day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
    if (day.getDay() === 0) continue; // Chu nhat khong tinh phep.
    const firstSession = day.getTime() === start.getTime() ? sessionIndex[startSession] : 0;
    const lastSession = day.getTime() === end.getTime() ? sessionIndex[endSession] : 1;
    totalSessions += Math.max(0, lastSession - firstSession + 1);
  }
  return totalSessions;
}

function getSessionStartTime(startDate, startSession) {
  if (startDate == null) return null;
  const start = new Date(startDate);
  if (!Number.isFinite(start.getTime())) return null;
  if (startSession === 'Sáng') start.setHours(7, 45, 0, 0);
  else if (startSession === 'Chiều') start.setHours(12, 30, 0, 0);
  else return null;
  return start;
}

function computeSubmissionViolation(messageTime, startDate, startSession) {
  const submittedAt = new Date(messageTime);
  const sessionStartsAt = getSessionStartTime(startDate, startSession);
  if (!Number.isFinite(submittedAt.getTime()) || !sessionStartsAt) return false;
  return submittedAt.getTime() > sessionStartsAt.getTime();
}

function parseIsoDateOnly(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) ||
      date.getMonth() !== Number(match[2]) - 1 ||
      date.getDate() !== Number(match[3])) return null;
  return date;
}

function formatVietnameseDate(date) {
  const parsed = new Date(date);
  if (!Number.isFinite(parsed.getTime())) return null;
  const pad = value => String(value).padStart(2, '0');
  return `${pad(parsed.getDate())}/${pad(parsed.getMonth() + 1)}/${parsed.getFullYear()}`;
}

function formatLeaveBoundary(date, session) {
  if (session !== 'Sáng' && session !== 'Chiều') return null;
  const formattedDate = formatVietnameseDate(date);
  return formattedDate ? `${session} ${formattedDate}` : null;
}

/**
 * "Nghi gap" (tu dong gan co, KHONG tu tu choi — dung tinh than
 * CHINH-SACH-NGHI-PHEP.md dieu 6.6.3): thoi gian bat dau nghi cach thoi
 * diem nhan tin duoi nguong gio cau hinh.
 */
function computeIsUrgent(startTime, messageTime, thresholdHours) {
  const threshold = thresholdHours != null ? thresholdHours : CONFIG.HR_URGENT_NOTICE_HOURS_THRESHOLD;
  const startMs = new Date(startTime).getTime();
  const msgMs = new Date(messageTime).getTime();
  if (!isFinite(startMs) || !isFinite(msgMs)) return false;
  const diffHours = (startMs - msgMs) / (60 * 60 * 1000);
  return diffHours < threshold;
}

/**
 * Lay ho ten/chuc vu (vaiTro + coSo) hien tai cua 1 tai khoan web, dung de
 * "snapshot" vao dong Sheet tai thoi diem gui yeu cau (khong join truc tiep
 * moi lan doc, giu on dinh du lieu lich su ke ca khi ho so user doi sau nay).
 */
async function resolveSenderIdentity(webUsername) {
  const user = await userRepository.findUserByUsername(webUsername);
  if (!user) return null;
  const chucVu = [user.vaiTro, user.coSo].filter(Boolean).join(' · ');
  return { hoTen: user.hoTen, chucVu, vaiTro: user.vaiTro };
}

/** Nguoi duyet lay truc tiep tu req.user (JWT), khong can doc lai users.json. */
function resolveApproverName(reqUser) {
  return (reqUser && (reqUser.hoTen || reqUser.username)) || 'unknown';
}

module.exports = {
  computeDurationSessions,
  getSessionStartTime,
  computeSubmissionViolation,
  parseIsoDateOnly,
  formatVietnameseDate,
  formatLeaveBoundary,
  computeIsUrgent,
  resolveSenderIdentity,
  resolveApproverName
};
