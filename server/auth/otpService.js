// ==========================================
// OTP SERVICE — Quản lý sinh mã xác thực OTP (6 chữ số),
// lưu trữ tạm thời, kiểm tra thời hạn (5 phút), giới hạn số lần thử,
// và che mờ thông tin liên lạc (Email/SĐT).
// ==========================================
const crypto = require('crypto');

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
 * Che mờ số điện thoại để bảo mật khi hiển thị (vd: 0912345678 -> 09****5678).
 */
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return '';
  const clean = phone.trim().replace(/\s+/g, '');
  if (clean.length < 6) return clean;
  const start = clean.slice(0, 2);
  const end = clean.slice(-3);
  return `${start}****${end}`;
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

  // 3. Số điện thoại chính
  if (user.soDienThoai && user.soDienThoai.trim()) {
    channels.push({
      channel: 'phone',
      label: 'Số điện thoại',
      targetMasked: maskPhone(user.soDienThoai),
      targetRaw: user.soDienThoai.trim()
    });
  }

  // 4. Số điện thoại khôi phục
  if (user.sdtKhoiPhuc && user.sdtKhoiPhuc.trim() &&
      normalize(user.sdtKhoiPhuc) !== normalize(user.soDienThoai)) {
    channels.push({
      channel: 'recovery_phone',
      label: 'Số điện thoại khôi phục',
      targetMasked: maskPhone(user.sdtKhoiPhuc),
      targetRaw: user.sdtKhoiPhuc.trim()
    });
  }

  return channels;
}

/**
 * Sinh mã OTP ngẫu nhiên 6 chữ số và lưu vào bộ nhớ tạm.
 */
function generateResetOtp(identifier, targetRaw, channelType) {
  const normId = normalize(identifier);
  const now = Date.now();

  const existing = otpStore.get(normId);
  if (existing && existing.createdAt && (now - existing.createdAt) < RESEND_COOLDOWN_MS) {
    const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - (now - existing.createdAt)) / 1000);
    return { success: false, cooldown: true, waitSeconds };
  }

  const code = String(crypto.randomInt(100000, 999999));
  const expiresAt = now + OTP_TTL_MS;

  const record = {
    code,
    identifier: normId,
    target: targetRaw,
    channel: channelType,
    expiresAt,
    attempts: 0,
    createdAt: now
  };

  otpStore.set(normId, record);

  // Giả lập gửi OTP: log ra console server để dev/admin kiểm tra hoặc tích hợp SMS/Email service
  // TODO: thay bang tich hop SMS/Email that (Twilio/nodemailer/...) truoc khi dua len production —
  // hien tai day la kenh "gui" duy nhat, khong co gui that qua email/SDT.
  console.log(`\n[OTP SERVICE] Đã tạo mã OTP cho [${normId}] qua [${channelType} -> ${targetRaw}]: [${code}] (Hạn dùng 5 phút)\n`);

  return {
    success: true,
    targetMasked: channelType.includes('email') ? maskEmail(targetRaw) : maskPhone(targetRaw),
    expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    code // Trả về cho mục đích test/dev nếu cần
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
  maskPhone,
  getAvailableChannels,
  generateResetOtp,
  verifyResetOtp,
  clearResetOtp,
  clearAllOtp
};
