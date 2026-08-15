// ==========================================
// AUTH ROUTES — POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me,
// GET /api/auth/google-config, POST /api/auth/google
// ==========================================
const express = require('express');
const CONFIG = require('../config');
const { comparePassword, signToken } = require('./authService');
const { findActiveUserByUsername, findUserByEmail, ACTIVE_STATUS, PENDING_STATUS } = require('./userRepository');
const { createPendingGoogleUser } = require('./userWriteRepository');
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

    const token = signToken({
      id: user.id,
      username: user.username,
      hoTen: user.hoTen,
      vaiTro: user.vaiTro,
      coSo: user.coSo
    });
    res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());
    res.status(200).json({
      id: user.id,
      username: user.username,
      hoTen: user.hoTen,
      vaiTro: user.vaiTro,
      coSo: user.coSo
    });
  } catch (err) {
    console.error('=== LOI /api/auth/login ===');
    console.error(err.stack);
    console.error('===========================');
    res.status(500).json({ error: 'Không đăng nhập được, vui lòng thử lại.' });
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

    const user = await findUserByEmail(profile.email);

    // Email chua co trong Users sheet -> tu dang ky: tao dong "Chờ duyệt",
    // vai tro thap nhat, chua the dang nhap cho toi khi admin duyet.
    if (!user) {
      await createPendingGoogleUser({ email: profile.email, hoTen: profile.name });
      return res.status(403).json({
        pending: true,
        error: 'Đã ghi nhận đăng ký bằng Google. Tài khoản đang chờ quản trị viên duyệt.'
      });
    }

    if (user.trangThai === PENDING_STATUS) {
      return res.status(403).json({
        pending: true,
        error: 'Tài khoản đang chờ quản trị viên duyệt.'
      });
    }
    if (user.trangThai !== ACTIVE_STATUS) {
      return res.status(403).json({ error: 'Tài khoản đã bị khóa.' });
    }

    const token = signToken({
      id: user.id,
      username: user.username,
      hoTen: user.hoTen,
      vaiTro: user.vaiTro,
      coSo: user.coSo
    });
    res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());
    res.status(200).json({
      id: user.id,
      username: user.username,
      hoTen: user.hoTen,
      vaiTro: user.vaiTro,
      coSo: user.coSo
    });
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
