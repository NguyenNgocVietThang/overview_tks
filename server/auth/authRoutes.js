// ==========================================
// AUTH ROUTES — dang nhap mat khau/Google, dang ky Khach (email/SDT), dang xuat,
// reset mat khau qua OTP, quan ly thong tin khoi phuc va doc thong tin phien.
// ==========================================
const express = require('express');
const crypto = require('crypto');
const CONFIG = require('../config');
const { hashPassword, comparePassword, signToken } = require('./authService');
const {
  findActiveUserByUsername,
  findUserByUsername,
  findUserByEmail,
  findUserByPhone,
  findUserByIdentifier,
  findUserById,
  ACTIVE_STATUS,
  PENDING_STATUS,
  ROLES,
  normalizePhone,
  isHardcodedAdmin
} = require('./userRepository');
const { createActiveGuest, activatePendingGuest, updateUserFields } = require('./userWriteRepository');
const { verifyGoogleIdToken } = require('./googleAuthService');
const { AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE_MS, requireAuth } = require('./authMiddleware');
const otpService = require('./otpService');

const router = express.Router();

// Rate limit & Lockout tracker: theo doi so lan dang nhap sai
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 phut
const failedLogins = new Map(); // Map<normalizedIdentifier, { count: number, lockedUntil: number }>

function clearFailedLogins(identifier) {
  if (identifier) {
    failedLogins.delete(String(identifier).trim().toLowerCase());
    const phone = normalizePhone(identifier);
    if (phone) failedLogins.delete(phone);
  } else {
    failedLogins.clear();
  }
}

// Rate limit cho cac route quen mat khau (channels/send-otp/verify): gioi han
// theo ca identifier va IP de chan vua do 1 tai khoan vua do nhieu tai khoan
// tu cung 1 nguon.
const FORGOT_PW_WINDOW_MS = 10 * 60 * 1000; // 10 phut
const FORGOT_PW_MAX_PER_IDENTIFIER = 8;
const FORGOT_PW_MAX_PER_IP = 20;
const forgotPwHitsByIdentifier = new Map(); // Map<string, { count, windowStart }>
const forgotPwHitsByIp = new Map(); // Map<string, { count, windowStart }>

function checkAndBumpRateLimit(map, key, max) {
  if (!key) return true;
  const now = Date.now();
  const entry = map.get(key);
  if (!entry || now - entry.windowStart > FORGOT_PW_WINDOW_MS) {
    map.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count += 1;
  return true;
}

function forgotPasswordRateLimit(req, res, next) {
  const identifierKey = String((req.body && req.body.identifier) || '').trim().toLowerCase();
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  const idOk = checkAndBumpRateLimit(forgotPwHitsByIdentifier, identifierKey, FORGOT_PW_MAX_PER_IDENTIFIER);
  const ipOk = checkAndBumpRateLimit(forgotPwHitsByIp, ip, FORGOT_PW_MAX_PER_IP);
  if (!idOk || !ipOk) {
    return res.status(429).json({ error: 'Bạn thao tác quá nhiều lần, vui lòng thử lại sau ít phút.' });
  }
  next();
}

/**
 * Sinh danh sach kenh OTP gia, deterministic theo identifier, dung cho tai
 * khoan khong ton tai de tranh lo thong tin qua enumeration (response giong
 * het tai khoan that ve hinh dang va tinh on dinh giua cac lan goi).
 */
function fakeChannelsForIdentifier(identifier) {
  const hash = crypto.createHash('sha256').update(String(identifier || '')).digest('hex');
  const maskedUser = hash.slice(0, 2);
  return [
    {
      channel: 'email',
      label: 'Email chính',
      targetMasked: `${maskedUser}***@••••.com`,
      targetRaw: null
    }
  ];
}

const FAKE_CHANNEL_LABELS = {
  email: 'Email chính',
  recovery_email: 'Email khôi phục',
  phone: 'Số điện thoại',
  recovery_phone: 'Số điện thoại khôi phục'
};

function fakeSendOtpResponse(identifier, channelType) {
  const label = FAKE_CHANNEL_LABELS[channelType] || 'kênh liên hệ';
  const hash = crypto.createHash('sha256').update(`${String(identifier || '')}|${channelType}`).digest('hex');
  const targetMasked = channelType.includes('email')
    ? `${hash.slice(0, 2)}***@••••.com`
    : `${hash.slice(0, 2)}****${hash.slice(2, 5)}`;
  return {
    ok: true,
    message: `Mã xác nhận OTP đã được gửi đến ${label.toLowerCase()} (${targetMasked}).`,
    targetMasked,
    channel: channelType,
    expiresInSeconds: Math.floor(otpService.OTP_TTL_MS / 1000)
  };
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
    path: '/'
  };
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    hoTen: user.hoTen,
    email: user.email || '',
    vaiTro: user.vaiTro,
    coSo: user.coSo
  };
}

function publicProfile(user) {
  return {
    id: user.id,
    username: user.username,
    hoTen: user.hoTen,
    vaiTro: user.vaiTro,
    coSo: user.coSo,
    email: user.email || '',
    soDienThoai: user.soDienThoai || '',
    emailKhoiPhuc: user.emailKhoiPhuc || '',
    sdtKhoiPhuc: user.sdtKhoiPhuc || '',
    hasPassword: !!user.passwordHash
  };
}

function signIn(res, user) {
  const safeUser = publicUser(user);
  res.cookie(AUTH_COOKIE_NAME, signToken(safeUser), cookieOptions());
  return safeUser;
}

// -------------------------------------------------------------
// POST /api/auth/login
// -------------------------------------------------------------
router.post('/api/auth/login', async (req, res) => {
  try {
    const username = req.body && req.body.username;
    const password = req.body && req.body.password;
    if (!username || !password) {
      return res.status(400).json({ error: 'Vui lòng nhập tài khoản và mật khẩu.' });
    }

    const normIdentifier = String(username).trim().toLowerCase();
    const now = Date.now();

    // Kiem tra trang thai tam khoa
    const lockRecord = failedLogins.get(normIdentifier);
    if (lockRecord && lockRecord.lockedUntil && now < lockRecord.lockedUntil) {
      const remainingSec = Math.ceil((lockRecord.lockedUntil - now) / 1000);
      return res.status(423).json({
        error: `Tài khoản tạm thời bị khóa do nhập sai quá 5 lần. Vui lòng thử lại sau ${remainingSec} giây hoặc đổi mật khẩu qua OTP.`,
        locked: true,
        lockoutRemainingSeconds: remainingSec,
        suggestReset: true,
        identifier: username
      });
    }

    let user = await findActiveUserByUsername(username);
    if (!user) {
      // Ghi nhan lan thu sai ngay ca khi khong tim thay user de tranh do pass
      let rec = failedLogins.get(normIdentifier) || { count: 0, lockedUntil: 0 };
      if (rec.lockedUntil && now >= rec.lockedUntil) rec = { count: 0, lockedUntil: 0 };
      rec.count += 1;
      if (rec.count >= MAX_FAILED_ATTEMPTS) {
        rec.lockedUntil = now + LOCKOUT_DURATION_MS;
        failedLogins.set(normIdentifier, rec);
        const remainingSec = Math.ceil(LOCKOUT_DURATION_MS / 1000);
        return res.status(423).json({
          error: `Bạn đã nhập sai mật khẩu quá 5 lần. Tài khoản bị tạm khóa 5 phút. Vui lòng đặt lại mật khẩu qua OTP.`,
          locked: true,
          lockoutRemainingSeconds: remainingSec,
          suggestReset: true,
          identifier: username
        });
      }
      failedLogins.set(normIdentifier, rec);
      const remaining = MAX_FAILED_ATTEMPTS - rec.count;
      return res.status(401).json({
        error: `Tài khoản hoặc mật khẩu không đúng. (Còn ${remaining} lần thử)`
      });
    }

    const passwordOk = await comparePassword(password, user.passwordHash);
    if (!passwordOk) {
      let rec = failedLogins.get(normIdentifier) || { count: 0, lockedUntil: 0 };
      if (rec.lockedUntil && now >= rec.lockedUntil) rec = { count: 0, lockedUntil: 0 };
      rec.count += 1;
      if (rec.count >= MAX_FAILED_ATTEMPTS) {
        rec.lockedUntil = now + LOCKOUT_DURATION_MS;
        failedLogins.set(normIdentifier, rec);
        const remainingSec = Math.ceil(LOCKOUT_DURATION_MS / 1000);
        return res.status(423).json({
          error: `Bạn đã nhập sai mật khẩu quá 5 lần. Tài khoản bị tạm khóa 5 phút. Vui lòng đặt lại mật khẩu qua OTP.`,
          locked: true,
          lockoutRemainingSeconds: remainingSec,
          suggestReset: true,
          identifier: username
        });
      }
      failedLogins.set(normIdentifier, rec);
      const remaining = MAX_FAILED_ATTEMPTS - rec.count;
      return res.status(401).json({
        error: `Tài khoản hoặc mật khẩu không đúng. (Còn ${remaining} lần thử)`
      });
    }

    // Dang nhap thanh cong -> xoa bo dem loi
    clearFailedLogins(username);
    if (user.username) clearFailedLogins(user.username);
    if (user.email) clearFailedLogins(user.email);
    if (user.soDienThoai) clearFailedLogins(user.soDienThoai);

    if (isHardcodedAdmin(user.email) || isHardcodedAdmin(user.username)) {
      user.vaiTro = ROLES.QUAN_LY;
      user.trangThai = ACTIVE_STATUS;
    }

    // Neu dang nhap bang email ma tai khoan chua co truong email -> cap nhat vao ho so
    if (normIdentifier.includes('@') && !user.email) {
      const updated = await updateUserFields(user.id, { email: normIdentifier });
      if (updated) user = updated;
    }

    res.status(200).json(signIn(res, user));
  } catch (err) {
    console.error('=== LOI /api/auth/login ===');
    console.error(err.stack);
    console.error('===========================');
    res.status(500).json({ error: 'Không đăng nhập được, vui lòng thử lại.' });
  }
});

// -------------------------------------------------------------
// POST /api/auth/register (Email hoac So dien thoai)
// -------------------------------------------------------------
router.post('/api/auth/register', async (req, res) => {
  try {
    const hoTen = String((req.body && req.body.hoTen) || '').trim();
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const soDienThoai = String((req.body && req.body.soDienThoai) || '').trim();
    const password = String((req.body && req.body.password) || '');

    if (!hoTen) {
      return res.status(400).json({ error: 'Vui lòng nhập họ và tên.' });
    }
    if (hoTen.length > 100) {
      return res.status(400).json({ error: 'Họ tên không được dài quá 100 ký tự.' });
    }

    if (!email && !soDienThoai) {
      return res.status(400).json({ error: 'Vui lòng nhập email hoặc số điện thoại để đăng ký.' });
    }

    if (email) {
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Email không hợp lệ.' });
      }
    }

    if (soDienThoai) {
      const normPhone = normalizePhone(soDienThoai);
      if (!/^(0|\+84)(3|5|7|8|9)[0-9]{8}$/.test(normPhone) && !/^[0-9]{10}$/.test(normPhone)) {
        return res.status(400).json({ error: 'Số điện thoại không hợp lệ (yêu cầu 10 số).' });
      }
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 8 ký tự.' });
    }
    if (password.length > 128) {
      return res.status(400).json({ error: 'Mật khẩu không được dài quá 128 ký tự.' });
    }

    // Kiem tra trung lap
    if (email) {
      const existingByEmail = await findUserByEmail(email);
      const existingByUsername = existingByEmail ? null : await findUserByUsername(email);
      if (existingByEmail || existingByUsername) {
        return res.status(409).json({ error: 'Email này đã được đăng ký.' });
      }
    }

    if (soDienThoai) {
      const normPhone = normalizePhone(soDienThoai);
      const existingByPhone = await findUserByPhone(normPhone);
      const existingByUsername = existingByPhone ? null : await findUserByUsername(normPhone);
      if (existingByPhone || existingByUsername) {
        return res.status(409).json({ error: 'Số điện thoại này đã được đăng ký.' });
      }
    }

    const passwordHash = await hashPassword(password);
    const username = email || normalizePhone(soDienThoai);
    const isTargetAdmin = isHardcodedAdmin(email) || isHardcodedAdmin(username);
    const user = {
      id: crypto.randomUUID(),
      username,
      hoTen,
      email,
      soDienThoai: normalizePhone(soDienThoai),
      vaiTro: isTargetAdmin ? ROLES.QUAN_LY : ROLES.KHACH,
      coSo: isTargetAdmin ? 'Cả hai' : ''
    };

    try {
      await createActiveGuest({ ...user, passwordHash });
    } catch (err) {
      if (err && err.code === 'USER_EXISTS') {
        return res.status(409).json({ error: err.message || 'Tài khoản này đã được đăng ký.' });
      }
      throw err;
    }

    res.status(201).json(signIn(res, user));
  } catch (err) {
    console.error('=== LOI /api/auth/register ===');
    console.error(err.stack);
    console.error('=============================');
    res.status(500).json({ error: 'Không đăng ký được, vui lòng thử lại.' });
  }
});

// -------------------------------------------------------------
// FORGOT PASSWORD / OTP ROUTES
// -------------------------------------------------------------

/**
 * Tra ve cac kenh nhan OTP kha dung cho tai khoan (Email / SDT da che mo)
 */
router.post('/api/auth/forgot-password/channels', forgotPasswordRateLimit, async (req, res) => {
  try {
    const identifier = req.body && req.body.identifier;
    if (!identifier) {
      return res.status(400).json({ error: 'Vui lòng nhập tên tài khoản, email hoặc số điện thoại.' });
    }

    const user = await findUserByIdentifier(identifier);
    if (!user) {
      // Tra ve kenh gia thay vi 404 de tranh lo thong tin tai khoan nao ton tai (user enumeration)
      return res.status(200).json({
        identifier,
        channels: fakeChannelsForIdentifier(identifier)
      });
    }

    const channels = otpService.getAvailableChannels(user);
    if (!channels || channels.length === 0) {
      return res.status(400).json({
        error: 'Tài khoản chưa có Email hoặc Số điện thoại xác minh để nhận mã OTP. Vui lòng liên hệ quản trị viên.'
      });
    }

    res.status(200).json({
      identifier: user.username,
      channels
    });
  } catch (err) {
    console.error('=== LOI /api/auth/forgot-password/channels ===', err);
    res.status(500).json({ error: 'Không lấy được phương thức gửi mã, vui lòng thử lại.' });
  }
});

/**
 * Gui ma OTP den kenh da chon
 */
router.post('/api/auth/forgot-password/send-otp', forgotPasswordRateLimit, async (req, res) => {
  try {
    const identifier = req.body && req.body.identifier;
    const channelType = req.body && req.body.channel; // 'email' | 'phone' | 'recovery_email' | 'recovery_phone'
    if (!identifier || !channelType) {
      return res.status(400).json({ error: 'Thiếu thông tin tài khoản hoặc kênh gửi mã OTP.' });
    }

    const user = await findUserByIdentifier(identifier);
    if (!user) {
      // Tra ve response gia giong het tai khoan that de tranh lo user enumeration
      return res.status(200).json(fakeSendOtpResponse(identifier, channelType));
    }

    const channels = otpService.getAvailableChannels(user);
    const chosen = channels.find(c => c.channel === channelType);
    if (!chosen) {
      return res.status(400).json({ error: 'Kênh gửi mã không hợp lệ cho tài khoản này.' });
    }

    const otpResult = otpService.generateResetOtp(user.username, chosen.targetRaw, chosen.channel);
    if (!otpResult.success && otpResult.cooldown) {
      return res.status(429).json({ error: `Vui lòng đợi ${otpResult.waitSeconds} giây trước khi yêu cầu mã mới.` });
    }

    res.status(200).json({
      ok: true,
      message: `Mã xác nhận OTP đã được gửi đến ${chosen.label.toLowerCase()} (${chosen.targetMasked}).`,
      targetMasked: chosen.targetMasked,
      channel: chosen.channel,
      expiresInSeconds: otpResult.expiresInSeconds
    });
  } catch (err) {
    console.error('=== LOI /api/auth/forgot-password/send-otp ===', err);
    res.status(500).json({ error: 'Không gửi được mã OTP, vui lòng thử lại.' });
  }
});

/**
 * Xac thuc ma OTP va cap nhat mat khau moi
 */
router.post('/api/auth/forgot-password/verify', forgotPasswordRateLimit, async (req, res) => {
  try {
    const identifier = req.body && req.body.identifier;
    const otp = req.body && req.body.otp;
    const newPassword = String((req.body && req.body.newPassword) || '');

    if (!identifier || !otp) {
      return res.status(400).json({ error: 'Vui lòng nhập tài khoản và mã OTP.' });
    }

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 8 ký tự.' });
    }
    if (newPassword.length > 128) {
      return res.status(400).json({ error: 'Mật khẩu mới không được dài quá 128 ký tự.' });
    }

    const user = await findUserByIdentifier(identifier);
    if (!user) {
      // Cung status/message nhu OTP sai/het han de khong lo enumeration qua buoc verify
      return res.status(400).json({ error: 'Mã OTP không tồn tại hoặc đã hết hạn. Vui lòng yêu cầu mã mới.' });
    }

    const verifyResult = otpService.verifyResetOtp(user.username, otp);
    if (!verifyResult.valid) {
      return res.status(400).json({ error: verifyResult.error });
    }

    const passwordHash = await hashPassword(newPassword);
    await updateUserFields(user.id, { passwordHash });

    // Xoa OTP va xoa lockout neu co
    otpService.clearResetOtp(user.username);
    clearFailedLogins(user.username);
    if (user.email) clearFailedLogins(user.email);
    if (user.soDienThoai) clearFailedLogins(user.soDienThoai);

    res.status(200).json({
      ok: true,
      message: 'Đặt lại mật khẩu thành công! Bạn có thể đăng nhập bằng mật khẩu mới.'
    });
  } catch (err) {
    console.error('=== LOI /api/auth/forgot-password/verify ===', err);
    res.status(500).json({ error: 'Không đặt lại được mật khẩu, vui lòng thử lại.' });
  }
});

// -------------------------------------------------------------
// GOOGLE AUTH
// -------------------------------------------------------------
router.get('/api/auth/google-config', (req, res) => {
  res.status(200).json({ clientId: CONFIG.GOOGLE_CLIENT_ID || null });
});

router.post('/api/auth/google', async (req, res) => {
  try {
    const credential = req.body && req.body.credential;
    if (!credential) {
      return res.status(400).json({ error: 'Thiếu thông tin đăng nhập Google.' });
    }
    if (!CONFIG.GOOGLE_CLIENT_ID) {
      return res.status(500).json({ error: 'Đăng nhập bằng Google chưa được cấu hình.' });
    }

    let profile;
    try {
      profile = await verifyGoogleIdToken(credential);
    } catch (err) {
      return res.status(401).json({ error: 'Không xác thực được với Google, vui lòng thử lại.' });
    }
    if (!profile.email || !profile.emailVerified) {
      return res.status(401).json({ error: 'Email Google chưa được xác minh.' });
    }

    const email = profile.email.toLowerCase().trim();
    const googleName = (profile.name || '').trim();
    const isTargetAdmin = isHardcodedAdmin(email);

    let user = await findUserByEmail(email);

    if (!user) {
      const assignedRole = isTargetAdmin ? ROLES.QUAN_LY : ROLES.KHACH;
      const created = await createActiveGuest({
        email,
        hoTen: googleName || email,
        username: email,
        vaiTro: assignedRole
      });
      user = created || {
        id: crypto.randomUUID(),
        username: email,
        hoTen: googleName || email,
        email,
        vaiTro: assignedRole,
        coSo: isTargetAdmin ? 'Cả hai' : '',
        trangThai: ACTIVE_STATUS
      };
    } else {
      if (isTargetAdmin || isHardcodedAdmin(user.username)) {
        user.vaiTro = ROLES.QUAN_LY;
        user.trangThai = ACTIVE_STATUS;
      }
      if (user.trangThai !== ACTIVE_STATUS && user.trangThai !== PENDING_STATUS) {
        return res.status(403).json({ error: 'Tài khoản đã bị khóa.' });
      }

      // Tai khoan da ton tai -> dong bo ten va email tu Google vao ho so nguoi dung
      const updates = {};
      if (!user.email || user.email.toLowerCase() !== email) {
        updates.email = email;
      }
      if (googleName && (!user.hoTen || user.hoTen === user.username || user.hoTen === user.email || user.hoTen !== googleName)) {
        updates.hoTen = googleName;
      }
      if (isTargetAdmin || isHardcodedAdmin(user.username)) {
        updates.vaiTro = ROLES.QUAN_LY;
        updates.trangThai = ACTIVE_STATUS;
      } else if (user.trangThai === PENDING_STATUS) {
        await activatePendingGuest({ email, hoTen: googleName || user.hoTen });
        updates.vaiTro = ROLES.KHACH;
        updates.trangThai = ACTIVE_STATUS;
      }
      if (Object.keys(updates).length > 0) {
        const updated = await updateUserFields(user.id, updates);
        user = { ...user, ...updates, ...(updated || {}) };
      }
    }

    if (user.trangThai !== ACTIVE_STATUS) {
      return res.status(403).json({ error: 'Tài khoản đã bị khóa.' });
    }

    clearFailedLogins(email);
    res.status(200).json(signIn(res, user));
  } catch (err) {
    console.error('=== LOI /api/auth/google ===');
    console.error(err.stack);
    console.error('=============================');
    res.status(500).json({ error: 'Không đăng nhập được, vui lòng thử lại.' });
  }
});

router.post('/api/auth/logout', (req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
  res.status(200).json({ ok: true });
});

router.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    let user = await findUserById(req.user.id);
    if (!user) {
      return res.status(401).json({ error: 'Tài khoản không tồn tại hoặc đã bị xóa.' });
    }
    if (isHardcodedAdmin(user.email) || isHardcodedAdmin(user.username)) {
      user.vaiTro = ROLES.QUAN_LY;
      user.trangThai = ACTIVE_STATUS;
    }
    if (user.trangThai !== ACTIVE_STATUS) {
      return res.status(403).json({ error: 'Tài khoản đã bị tạm khóa.' });
    }
    // Tự động làm mới cookie token nếu vai trò hoặc thông tin có cập nhật mới
    if (user.vaiTro !== req.user.vaiTro || user.hoTen !== req.user.hoTen || user.coSo !== req.user.coSo) {
      signIn(res, user);
    }
    res.status(200).json(publicUser(user));
  } catch (err) {
    res.status(200).json(req.user);
  }
});

// -------------------------------------------------------------
// PROFILE & RECOVERY CONTACTS
// -------------------------------------------------------------
router.get('/api/auth/profile', requireAuth, async (req, res) => {
  try {
    const user = await findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    }
    res.status(200).json(publicProfile(user));
  } catch (err) {
    console.error('=== LOI GET /api/auth/profile ===', err);
    res.status(500).json({ error: 'Không tải được hồ sơ, vui lòng thử lại.' });
  }
});

router.post('/api/auth/profile', requireAuth, async (req, res) => {
  try {
    const hoTen = String((req.body && req.body.hoTen) || '').trim();
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();

    if (!hoTen) {
      return res.status(400).json({ error: 'Vui lòng nhập họ tên.' });
    }
    if (hoTen.length > 100) {
      return res.status(400).json({ error: 'Họ tên không được dài quá 100 ký tự.' });
    }
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Email không hợp lệ.' });
    }

    const current = await findUserById(req.user.id);
    if (!current) {
      return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    }
    if (email !== (current.email || '').toLowerCase()) {
      const other = await findUserByEmail(email);
      if (other && String(other.id) !== String(current.id)) {
        return res.status(409).json({ error: 'Email này đã được sử dụng bởi tài khoản khác.' });
      }
    }

    await updateUserFields(current.id, { hoTen, email });
    const updated = { ...current, hoTen, email };
    signIn(res, updated);
    res.status(200).json(publicProfile(updated));
  } catch (err) {
    console.error('=== LOI POST /api/auth/profile ===', err);
    res.status(500).json({ error: 'Không cập nhật được hồ sơ, vui lòng thử lại.' });
  }
});

/**
 * Cap nhat thong tin lien he & khoi phuc (SDT chinh, Email khoi phuc, SDT khoi phuc).
 * BAT BUOC phai nhap dung mat khau hien tai cua tai khoan.
 */
router.post('/api/auth/recovery', requireAuth, async (req, res) => {
  try {
    const current = await findUserById(req.user.id);
    if (!current) {
      return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    }

    const matKhauXacNhan = String((req.body && req.body.matKhauXacNhan) || '');
    const soDienThoai = String((req.body && req.body.soDienThoai) || '').trim();
    const emailKhoiPhuc = String((req.body && req.body.emailKhoiPhuc) || '').trim().toLowerCase();
    const sdtKhoiPhuc = String((req.body && req.body.sdtKhoiPhuc) || '').trim();

    // Neu tai khoan co mat khau -> bat buoc xac thuc mat khau
    if (current.passwordHash) {
      if (!matKhauXacNhan) {
        return res.status(400).json({ error: 'Vui lòng nhập mật khẩu hiện tại để xác nhận thay đổi.' });
      }
      const passwordOk = await comparePassword(matKhauXacNhan, current.passwordHash);
      if (!passwordOk) {
        return res.status(401).json({ error: 'Mật khẩu xác nhận không chính xác.' });
      }
    }

    // Validate email khoi phuc
    if (emailKhoiPhuc) {
      if (emailKhoiPhuc.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailKhoiPhuc)) {
        return res.status(400).json({ error: 'Email khôi phục không đúng định dạng.' });
      }
    }

    // Validate so dien thoai chinh neu duoc truyen
    let normPhone = '';
    const hasPhoneInBody = req.body && req.body.soDienThoai !== undefined;
    if (hasPhoneInBody && soDienThoai) {
      normPhone = normalizePhone(soDienThoai);
      if (!/^(0|\+84)(3|5|7|8|9)[0-9]{8}$/.test(normPhone) && !/^[0-9]{10}$/.test(normPhone)) {
        return res.status(400).json({ error: 'Số điện thoại chính không hợp lệ (yêu cầu 10 số).' });
      }
      // Kiem tra trung lap SDT voi tai khoan khac
      const otherPhone = await findUserByPhone(normPhone);
      if (otherPhone && String(otherPhone.id) !== String(current.id)) {
        return res.status(409).json({ error: 'Số điện thoại này đã được sử dụng bởi tài khoản khác.' });
      }
    }

    // Validate SDT khoi phuc
    let normRecoveryPhone = '';
    if (sdtKhoiPhuc) {
      normRecoveryPhone = normalizePhone(sdtKhoiPhuc);
      if (!/^(0|\+84)(3|5|7|8|9)[0-9]{8}$/.test(normRecoveryPhone) && !/^[0-9]{10}$/.test(normRecoveryPhone)) {
        return res.status(400).json({ error: 'Số điện thoại khôi phục không hợp lệ (yêu cầu 10 số).' });
      }
    }

    const updates = {
      emailKhoiPhuc,
      sdtKhoiPhuc: normRecoveryPhone
    };
    if (hasPhoneInBody) {
      updates.soDienThoai = normPhone;
    }

    const updated = await updateUserFields(current.id, updates);
    res.status(200).json({
      ok: true,
      message: 'Đã cập nhật thông tin khôi phục thành công.',
      profile: publicProfile(updated)
    });
  } catch (err) {
    if (err && err.code === 'USER_EXISTS') {
      return res.status(409).json({ error: err.message });
    }
    console.error('=== LOI POST /api/auth/recovery ===', err);
    res.status(500).json({ error: 'Không cập nhật được thông tin khôi phục, vui lòng thử lại.' });
  }
});

router.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const matKhauHienTai = String((req.body && req.body.matKhauHienTai) || '');
    const matKhauMoi = String((req.body && req.body.matKhauMoi) || '');

    const current = await findUserById(req.user.id);
    if (!current) {
      return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    }

    if (current.passwordHash) {
      if (!matKhauHienTai) {
        return res.status(400).json({ error: 'Vui lòng nhập mật khẩu hiện tại.' });
      }
      const passwordOk = await comparePassword(matKhauHienTai, current.passwordHash);
      if (!passwordOk) {
        return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng.' });
      }
    }

    if (matKhauMoi.length < 8) {
      return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 8 ký tự.' });
    }
    if (matKhauMoi.length > 128) {
      return res.status(400).json({ error: 'Mật khẩu mới không được dài quá 128 ký tự.' });
    }

    const passwordHash = await hashPassword(matKhauMoi);
    await updateUserFields(current.id, { passwordHash });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('=== LOI POST /api/auth/change-password ===', err);
    res.status(500).json({ error: 'Không đổi được mật khẩu, vui lòng thử lại.' });
  }
});

module.exports = router;
module.exports.clearFailedLogins = clearFailedLogins;
module.exports.failedLogins = failedLogins;
