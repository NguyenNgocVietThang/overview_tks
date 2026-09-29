// ==========================================
// ACCOUNT POLICY — chan LEO THANG QUYEN khi tai khoan KHONG phai Quan ly duoc
// cap quyen quan tri tai khoan (`account.users.manage`, `account.permissions`).
//
// requireFeature chi tra loi "actor co quyen nay khong"; module nay tra loi them
// "actor co duoc tac dong LEN tai khoan dich nay / GAN gia tri nay khong":
//   1. Dich la Quan ly (hoac admin cung): chan moi thao tac ghi.
//   2. Nhom GAN QUYEN (tao, doi vai tro, doi phan quyen chi tiet, duyet yeu cau
//      doi vai tro): khong gan vai tro Quan ly; moi quyen duoc THEM cho dich phai
//      nam trong quyen hieu luc cua chinh actor. Rut bot quyen thi khong sao.
//   3. Nhom CHIEM DANH TINH (dat lai mat khau, doi email/SDT — sau do co the quen
//      mat khau bang OTP): quyen hieu luc cua dich phai nam trong quyen cua actor.
// Quan ly va admin cung KHONG bi rang buoc (giu nguyen hanh vi cu).
//
// Moi ham tra ve null neu duoc phep, hoac chuoi ly do (tieng Viet) neu bi chan.
// ==========================================
'use strict';

const localUserStore = require('./localUserStore');
const featureRegistry = require('./featureRegistry');

const { ROLES } = localUserStore;
const DENIED_CODE = 'ACCOUNT_POLICY_DENIED';

function isManagerClass(user) {
  if (!user) return false;
  if (user.vaiTro === ROLES.QUAN_LY) return true;
  return [user.email, user.username].some(id =>
    localUserStore.isHardcodedAdmin(id) || localUserStore.isProtectedSuperAdmin(id));
}

/** Quyen hieu luc cua actor: dung mang da giai o requireAuth neu co. */
function actorPermissions(actor) {
  if (actor && Array.isArray(actor.permissions)) return actor.permissions;
  return featureRegistry.resolvePermissions(actor);
}

function labelsOf(keys) {
  return keys
    .map(key => {
      const feature = featureRegistry.FEATURES.find(f => f.key === key);
      return `"${feature ? feature.label : key}"`;
    })
    .join(', ');
}

/** Luat 1: dich la Quan ly thi chi Quan ly moi duoc ghi len no. */
function checkTargetWritable(actor, target) {
  if (isManagerClass(actor)) return null;
  if (isManagerClass(target)) {
    return 'Chỉ Quản lý mới được thao tác trên tài khoản Quản lý.';
  }
  return null;
}

/**
 * Luat 2: `currentTarget` la null khi tao moi; `nextTarget` la ban SAU khi doi
 * ({ ...current, vaiTro, featurePermissions }) de tinh quyen hieu luc moi.
 */
function checkGrant(actor, currentTarget, nextTarget) {
  if (isManagerClass(actor)) return null;
  if (nextTarget && nextTarget.vaiTro === ROLES.QUAN_LY) {
    return 'Chỉ Quản lý mới được gán vai trò Quản lý.';
  }
  const before = new Set(currentTarget ? featureRegistry.resolvePermissions(currentTarget) : []);
  const own = new Set(actorPermissions(actor));
  const missing = featureRegistry.resolvePermissions(nextTarget)
    .filter(key => !before.has(key) && !own.has(key));
  if (missing.length) {
    return `Bạn không có quyền ${labelsOf(missing)} nên không thể cấp quyền này cho tài khoản khác.`;
  }
  return null;
}

/** Luat 3: `action` la cum dong tu de dua vao thong bao ("đặt lại mật khẩu"...). */
function checkTakeover(actor, target, action) {
  if (isManagerClass(actor)) return null;
  if (isManagerClass(target)) {
    return 'Chỉ Quản lý mới được thao tác trên tài khoản Quản lý.';
  }
  const own = new Set(actorPermissions(actor));
  const missing = featureRegistry.resolvePermissions(target).filter(key => !own.has(key));
  if (missing.length) {
    return `Tài khoản này có quyền cao hơn bạn (${labelsOf(missing)}) nên bạn không thể ${action}.`;
  }
  return null;
}

/** 403 chuan cho moi route khi bi chan boi chinh sach. */
function sendDenied(res, reason) {
  return res.status(403).json({ error: reason, code: DENIED_CODE });
}

module.exports = {
  DENIED_CODE,
  isManagerClass,
  checkTargetWritable,
  checkGrant,
  checkTakeover,
  sendDenied
};
