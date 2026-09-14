// ==========================================
// OTP SERVICE — Quản lý sinh mã xác thực OTP (6 chữ số),
// lưu trữ tạm thời, kiểm tra thời hạn (5 phút), giới hạn số lần thử,
// và che mờ thông tin liên lạc (Email/SĐT).
// ==========================================
const crypto = require('crypto');
const emailSender = require('../notifications/emailSender');

const OTP_TTL_MS = 5 * 60 * 1000; // 5 phút
const MAX_OTP_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 giay giua 2 lan gui OTP cho cung 1 tai khoan

// Lưu trữ OTP tạm thời trong bộ nhớ: Map<normalizedIdentifier, OtpRecord>
const otpStore = new Map();

function normalize(str) {
  return String(str || '').trim().toLowerCase();
}

/**
 * Che mờ địa chỉ email để bảo mật khi hiển thị (vd: nguyenvana@gmail.com -> ng***a@gmail.com).
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const parts = email.trim().split('@');
  if (parts.length !== 2) return email;
  const [user, domain] = parts;
  if (user.length <= 2) {
    return `${user.charAt(0)}***@${domain}`;
  }
  const start = user.slice(0, 2);
  const end = user.slice(-1);
  return `${start}***${end}@${domain}`;
}

/**
 * Lấy danh sách các kênh gửi OTP khả dụng của người dùng.
 */
function getAvailableChannels(user) {
  if (!user) return [];
  const channels = [];

  // 1. Email chính
  if (user.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) {
    channels.push({
      channel: 'email',
      label: 'Email chính',
      targetMasked: maskEmail(user.email),
      targetRaw: user.email.toLowerCase()
    });
  }

  // 2. Email khôi phục
  if (user.emailKhoiPhuc && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.emailKhoiPhuc) &&
      normalize(user.emailKhoiPhuc) !== normalize(user.email)) {
    channels.push({
      channel: 'recovery_email',
      label: 'Email khôi phục',
      targetMasked: maskEmail(user.emailKhoiPhuc),
      targetRaw: user.emailKhoiPhuc.toLowerCase()
    });
  }

  return channels;
}

/**
 * Gửi mã OTP THẬT qua Email (Gmail SMTP). Nếu CHƯA được cấu hình (thiếu
 * SMTP_USER/SMTP_APP_PASSWORD) và không phải production, fallback về
 * console.log — chỉ dùng cho dev/test local. Ở production mà chưa cấu hình,
 * báo lỗi thật thay vì âm thầm coi như đã gửi thành công.
 */
async function deliverOtp(channelType, targetRaw, code, expiresInSeconds) {
  if (!emailSender.isConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      console.error(`[OTP] Kênh "${channelType}" chưa cấu hình gửi thật (thiếu SMTP_USER/SMTP_APP_PASSWORD) — từ chối gửi OTP.`);
      return { ok: false, error: 'EMAIL_NOT_CONFIGURED' };
    }
    console.log(`\n[OTP DEV] Kênh "${channelType}" chưa cấu hình gửi thật — log mã để dev/test kiểm tra.`);
    console.log(`[OTP DEV] [${channelType} -> ${targetRaw}]: [${code}] (Hạn dùng ${Math.round(expiresInSeconds / 60)} phút)\n`);
    return { ok: true };
  }

  return emailSender.sendOtpEmail({ to: targetRaw, code, expiresInSeconds });
}

/**
 * Sinh mã OTP ngẫu nhiên 6 chữ số, gửi THẬT qua Email/SMS, và chỉ lưu vào
 * bộ nhớ tạm (bắt đầu tính cooldown) nếu gửi thành công — gửi thất bại thì
 * không tốn lượt cooldown, cho phép người dùng bấm gửi lại ngay.
 */
async function generateResetOtp(identifier, targetRaw, channelType) {
  const normId = normalize(identifier);
  const now = Date.now();

  const existing = otpStore.get(normId);
  if (existing && existing.createdAt && (now - existing.createdAt) < RESEND_COOLDOWN_MS) {
    const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - (now - existing.createdAt)) / 1000);
    return { success: false, cooldown: true, waitSeconds };
  }

  const code = String(crypto.randomInt(100000, 999999));
  const expiresInSeconds = Math.floor(OTP_TTL_MS / 1000);

  const delivery = await deliverOtp(channelType, targetRaw, code, expiresInSeconds);
  if (!delivery.ok) {
    return {
      success: false,
      error: 'Không gửi được mã OTP, vui lòng thử lại sau ít phút.'
    };
  }

  otpStore.set(normId, {
    code,
    identifier: normId,
    target: targetRaw,
    channel: channelType,
    expiresAt: now + OTP_TTL_MS,
    attempts: 0,
    createdAt: now
  });

  return {
    success: true,
    targetMasked: maskEmail(targetRaw),
    expiresInSeconds,
    code // Trả về cho mục đích test/dev nếu cần — KHÔNG forward field này ra response API
  };
}

/**
 * Xác thực mã OTP người dùng nhập vào.
 */
function verifyResetOtp(identifier, inputCode) {
  const normId = normalize(identifier);
  const record = otpStore.get(normId);

  if (!record) {
    return { valid: false, error: 'Mã OTP không tồn tại hoặc đã hết hạn. Vui lòng yêu cầu mã mới.' };
  }

  if (Date.now() > record.expiresAt) {
    otpStore.delete(normId);
    return { valid: false, error: 'Mã OTP đã hết hạn (quá 5 phút). Vui lòng yêu cầu mã mới.' };
  }

  record.attempts += 1;
  if (record.attempts > MAX_OTP_ATTEMPTS) {
    otpStore.delete(normId);
    return { valid: false, error: 'Bạn đã nhập sai mã OTP quá 5 lần. Vui lòng gửi lại mã mới.' };
  }

  const cleanInput = String(inputCode || '').trim();
  if (cleanInput !== record.code) {
    const remaining = MAX_OTP_ATTEMPTS - record.attempts;
    return {
      valid: false,
      error: `Mã OTP không chính xác. Bạn còn ${remaining} lần thử.`
    };
  }

  // OTP hợp lệ
  return {
    valid: true,
    identifier: record.identifier,
    target: record.target,
    channel: record.channel
  };
}

/**
 * Xóa mã OTP sau khi đổi mật khẩu thành công.
 */
function clearResetOtp(identifier) {
  const normId = normalize(identifier);
  otpStore.delete(normId);
}

/**
 * Xóa toàn bộ OTP store (phục vụ testing).
 */
function clearAllOtp() {
  otpStore.clear();
}

module.exports = {
  OTP_TTL_MS,
  MAX_OTP_ATTEMPTS,
  maskEmail,
  getAvailableChannels,
  generateResetOtp,
  verifyResetOtp,
  clearResetOtp,
  clearAllOtp
};
