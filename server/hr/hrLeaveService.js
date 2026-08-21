// ==========================================
// HR LEAVE SERVICE — logic nghiep vu: tinh gio nghi, co "nghi gap", resolve
// danh tinh nguoi gui/nguoi duyet tu users.json (khong doc qua Telegram).
// ==========================================
'use strict';

const CONFIG = require('../config');
const userRepository = require('../auth/userRepository');

/**
 * Tinh so gio giua 2 moc thoi gian ISO/parseable. Khong tru ngay nghi/le —
 * don gian hoa cho giai doan 1 (xem ghi chu trong CHINH-SACH-NGHI-PHEP.md
 * ve viec chi tru gio theo lich lam viec that, se can tich hop lich ca sau).
 */
function computeDurationHours(start, end) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!isFinite(startMs) || !isFinite(endMs) || endMs <= startMs) return null;
  return Math.round(((endMs - startMs) / (60 * 60 * 1000)) * 100) / 100;
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
  computeDurationHours,
  computeIsUrgent,
  resolveSenderIdentity,
  resolveApproverName
};
