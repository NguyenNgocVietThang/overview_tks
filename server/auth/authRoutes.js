// ==========================================
// AUTH ROUTES — dang nhap mat khau/Google, dang ky Khach, dang xuat va doc
// thong tin phien hien tai.
// ==========================================
const express = require('express');
const crypto = require('crypto');
const CONFIG = require('../config');
const { hashPassword, comparePassword, signToken } = require('./authService');
const {
  findActiveUserByUsername,
  findUserByUsername,
  findUserByEmail,
  ACTIVE_STATUS,
  PENDING_STATUS,
  ROLES
} = require('./userRepository');
const { createActiveGuest, activatePendingGuest } = require('./userWriteRepository');
const { verifyGoogleIdToken } = require('./googleAuthService');
const { AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE_MS, requireAuth } = require('./authMiddleware');

const router = express.Router();

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    // Render (production) phuc vu qua HTTPS -> bat Secure; local dev qua
    // http://localhost thi Secure=true se khien trinh duyet khong gui cookie.
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
    vaiTro: user.vaiTro,
    coSo: user.coSo
  };
}

function signIn(res, user) {
  const safeUser = publicUser(user);
  res.cookie(AUTH_COOKIE_NAME, signToken(safeUser), cookieOptions());
  return safeUser;
}

router.post('/api/auth/login', async (req, res) => {
  try {
    const username = req.body && req.body.username;
    const password = req.body && req.body.password;
    if (!username || !password) {
      return res.status(400).json({ error: 'Vui lòng nhập tài khoản và mật khẩu.' });
    }

    const user = await findActiveUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Tài khoản hoặc mật khẩu không đúng.' });
    }

    const passwordOk = await comparePassword(password, user.passwordHash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Tài khoản hoặc mật khẩu không đúng.' });
    }

    res.status(200).json(signIn(res, user));
  } catch (err) {
    console.error('=== LOI /api/auth/login ===');
    console.error(err.stack);
    console.error('===========================');
    res.status(500).json({ error: 'Không đăng nhập được, vui lòng thử lại.' });
  }
});

router.post('/api/auth/register', async (req, res) => {
  try {
    const hoTen = String((req.body && req.body.hoTen) || '').trim();
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const password = String((req.body && req.body.password) || '');

    if (!hoTen || !email || !password) {
      return res.status(400).json({ error: 'Vui lòng nhập đầy đủ họ tên, email và mật khẩu.' });
    }
    if (hoTen.length > 100) {
      return res.status(400).json({ error: 'Họ tên không được dài quá 100 ký tự.' });
    }
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Email không hợp lệ.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 8 ký tự.' });
    }
    if (password.length > 128) {
      return res.status(400).json({ error: 'Mật khẩu không được dài quá 128 ký tự.' });
    }

    const existingByEmail = await findUserByEmail(email);
    const existingByUsername = existingByEmail ? null : await findUserByUsername(email);
    if (existingByEmail || existingByUsername) {
      return res.status(409).json({ error: 'Email này đã được đăng ký.' });
    }

    const passwordHash = await hashPassword(password);
    const user = {
      id: crypto.randomUUID(),
      username: email,
      hoTen,
      vaiTro: ROLES.KHACH,
      coSo: ''
    };
    try {
      await createActiveGuest({ ...user, email, passwordHash });
    } catch (err) {
      if (err && err.code === 'USER_EXISTS') {
        return res.status(409).json({ error: 'Email này đã được đăng ký.' });
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

// Cho trang login doc client_id (KHONG phai secret) truoc khi render nut
// Google — thieu GOOGLE_CLIENT_ID chi an nut, khong tat toan bo trang.
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

    let user = await findUserByEmail(profile.email);

    // Email moi duoc vao ngay voi vai tro Khach. Tai khoan noi bo da ton tai
    // van giu nguyen vai tro; tai khoan bi khoa khong duoc mo lai tu dong.
    if (!user) {
      user = {
        id: crypto.randomUUID(),
        username: profile.email.toLowerCase(),
        hoTen: profile.name || profile.email,
        vaiTro: ROLES.KHACH,
        coSo: '',
        trangThai: ACTIVE_STATUS
      };
      await createActiveGuest({ email: user.username, hoTen: user.hoTen });
    }

    if (user.trangThai === PENDING_STATUS) {
      await activatePendingGuest({ email: profile.email, hoTen: profile.name });
      user = { ...user, vaiTro: ROLES.KHACH, trangThai: ACTIVE_STATUS };
    }
    if (user.trangThai !== ACTIVE_STATUS) {
      return res.status(403).json({ error: 'Tài khoản đã bị khóa.' });
    }

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

router.get('/api/auth/me', requireAuth, (req, res) => {
  res.status(200).json(req.user);
});

module.exports = router;
