// ==========================================
// AUTH MIDDLEWARE — kiem tra JWT trong httpOnly cookie + phan quyen theo vai tro.
// Day la RANH GIOI BAO MAT THAT SU cua he thong (khac voi auth-guard phia
// client trong shared-nav.js, von chi de dieu huong UX).
// ==========================================
const { verifyToken } = require('./authService');

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
function requireAuth(req, res, next) {
  const token = readTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: 'Chưa đăng nhập.' });
  }
  try {
    req.user = verifyToken(token);
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' });
  }
}

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

module.exports = { AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE_MS, requireAuth, requireRole };
