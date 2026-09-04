// ==========================================
// AUTH MIDDLEWARE — kiem tra JWT trong httpOnly cookie + phan quyen theo vai tro.
// Day la RANH GIOI BAO MAT THAT SU cua he thong (khac voi auth-guard phia
// client trong shared-nav.js, von chi de dieu huong UX).
// ==========================================
const { verifyToken } = require('./authService');
const localUserStore = require('./localUserStore');
const effectiveUserResolver = require('./effectiveUserResolver');
const telegramIdentityService = require('../telegram/telegramIdentityService');

const AUTH_COOKIE_NAME = 'tks_auth';
const AUTH_COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000; // khop JWT_EXPIRES_IN mac dinh (12h)

function readTokenFromRequest(req) {
  return (req.cookies && req.cookies[AUTH_COOKIE_NAME]) || null;
}

/**
 * Bat buoc da dang nhap. Gan req.user = { id, username, hoTen, vaiTro, coSo }
 * khi hop le. Tra 401 (khong phai redirect) vi day la middleware API —
 * dieu huong ve /login/ la trach nhiem cua client JS (shared-nav.js).
 */
function createRequireAuth(dependencies = {}) {
  const verify = dependencies.verifyToken || verifyToken;
  const findUserById = dependencies.findUserById || localUserStore.getUserById;
  const resolveUser = dependencies.resolveUser || effectiveUserResolver.resolveUser;
  const ensureTelegramLink = dependencies.ensureTelegramLink || telegramIdentityService.ensureLinkForUser;

  return async function liveAuthGuard(req, res, next) {
    if (req.effectiveUserResolved && req.user) return next();
    const token = readTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({ error: 'Chưa đăng nhập.' });
    }

    let tokenUser;
    try {
      tokenUser = verify(token);
    } catch (err) {
      return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' });
    }

    try {
      const storedUser = await findUserById(tokenUser.id);
      if (!storedUser) {
        return res.status(401).json({ error: 'Tài khoản không tồn tại hoặc đã bị xóa.', code: 'ACCOUNT_NOT_FOUND' });
      }
      const effectiveUser = await resolveUser(storedUser);
      if (effectiveUser.trangThai === localUserStore.LOCKED_STATUS) {
        return res.status(403).json({ error: 'Tài khoản đã bị khóa.', code: 'ACCOUNT_LOCKED' });
      }
      req.user = effectiveUser;
      req.effectiveUserResolved = true;
      if (effectiveUser.hrManaged) {
        try {
          await ensureTelegramLink(effectiveUser);
        } catch (telegramErr) {
          console.error('[Auth] Không thể tự liên kết Telegram:', telegramErr.code || telegramErr.message);
        }
      }
      return next();
    } catch (err) {
      if (err && err.statusCode && err.statusCode < 500) {
        return res.status(err.statusCode).json({ error: err.message, code: err.code });
      }
      if (err && err.code === 'HR_DIRECTORY_UNAVAILABLE') {
        return res.status(503).json({ error: err.message, code: err.code });
      }
      console.error('[Auth] Không thể đối chiếu quyền tài khoản:', err.message);
      return res.status(500).json({ error: 'Không thể xác minh quyền tài khoản.', code: 'AUTH_RESOLUTION_FAILED' });
    }
  };
}

const requireAuth = createRequireAuth();

/**
 * Bat buoc vai tro nam trong danh sach cho phep — PHAI dat sau requireAuth.
 * vd: router.post('/api/shipment/orders', requireAuth, requireRole('Quản lý', 'Kế toán'), handler)
 */
function requireRole(...allowedRoles) {
  return function roleGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Chưa đăng nhập.' });
    }
    if (!allowedRoles.includes(req.user.vaiTro)) {
      return res.status(403).json({ error: 'Tài khoản không có quyền thực hiện thao tác này.' });
    }
    return next();
  };
}

module.exports = { AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE_MS, createRequireAuth, requireAuth, requireRole };
