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
 * Moi ngay co 2 buoi (Sang va Chieu). Khoang tinh bao gom ca buoi bat dau
 * va buoi ket thuc (bat dau o dau buoi bat dau, ket thuc o cuoi buoi ket thuc).
 *
 * @param {Date} startDate  - Doi tuong Date ngay bat dau (chi dung phan ngay)
 * @param {'Sáng'|'Chiều'} startSession - Buoi bat dau
 * @param {Date} endDate    - Doi tuong Date ngay ket thuc (chi dung phan ngay)
 * @param {'Sáng'|'Chiều'} endSession   - Buoi ket thuc
 * @returns {number|null}   - So buoi nguyen, hoac null neu thu tu/dau vao khong hop le
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

/**
 * Parse ngày theo nhiều định dạng hỗ trợ:
 * - dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy
 * - dd/mm, dd-mm, dd.mm (mặc định là năm hiện tại hoặc năm của referenceDate)
 * - Hỗ trợ ngày và tháng 1 hoặc 2 chữ số (vd: 27/8, 5/9, 27/08/2026, 27-8)
 * - Nhận dạng từ ngữ tương đối: "hôm nay", "ngày mai", "ngày kia", "ngày mốt"...
 *
 * @param {string} text - Chuỗi văn bản nhập vào
 * @param {Date|string|number} [referenceDate] - Mốc thời gian tham chiếu (mặc định: new Date())
 * @returns {Date|null} - Đối tượng Date (00:00:00 local time) hoặc null nếu không hợp lệ
 */
function parseVietnameseDate(text, referenceDate) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  let ref = referenceDate instanceof Date ? referenceDate : (referenceDate ? new Date(referenceDate) : new Date());
  if (!Number.isFinite(ref.getTime())) {
    ref = new Date();
  }

  // 1. Nhận dạng các từ khóa ngày tương đối (hỗ trợ cả có dấu và không dấu)
  const normalized = raw.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

  if (normalized === 'hom nay' || normalized === 'nay') {
    return new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  }
  if (normalized === 'ngay mai' || normalized === 'mai') {
    return new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + 1);
  }
  if (
    normalized === 'ngay kia' ||
    normalized === 'kia' ||
    normalized === 'ngay mot' ||
    normalized === 'mot'
  ) {
    return new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + 2);
  }

  // 2. Nhận dạng định dạng số: dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, dd/mm, dd-mm, dd.mm
  // Chấp nhận d/m, d-m, dd/mm, dd-mm, d/m/yyyy, dd-mm-yyyy...
  const match = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{4}))?$/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = match[3] != null ? Number(match[3]) : ref.getFullYear();

    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
    return date;
  }

  return null;
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

const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

/** Quy doi 1 thoi diem (instant) sang ngay-lich + gio theo gio Bangkok. */
function getBangkokDateHour(instant) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    dateOnly: new Date(Number(values.year), Number(values.month) - 1, Number(values.day)),
    hour: Number(values.hour)
  };
}

/**
 * "Nghi gap" (tu dong gan co, KHONG tu tu choi — dung tinh than
 * CHINH-SACH-NGHI-PHEP.md dieu 6.6.3): tin nhan gui tu HR_URGENT_LATE_NIGHT_HOUR
 * tro di (gio Bangkok) VA ca nghi bat dau ngay hom sau lien ke (theo lich Bangkok).
 */
function computeIsUrgent(startTime, messageTime) {
  const startMs = new Date(startTime).getTime();
  const msgMs = new Date(messageTime).getTime();
  if (!isFinite(startMs) || !isFinite(msgMs)) return false;

  const msg = getBangkokDateHour(new Date(msgMs));
  if (msg.hour < CONFIG.HR_URGENT_LATE_NIGHT_HOUR) return false;

  const start = getBangkokDateHour(new Date(startMs));
  const nextDay = new Date(msg.dateOnly);
  nextDay.setDate(nextDay.getDate() + 1);
  return start.dateOnly.getTime() === nextDay.getTime();
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
  parseVietnameseDate,
  formatVietnameseDate,
  formatLeaveBoundary,
  computeIsUrgent,
  resolveSenderIdentity,
  resolveApproverName
};
