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
//   4. (2026-10-01) Quan ly THUONG khong duoc tac dong len Quan ly KHAC: dat lai mat
//      khau, doi email/SDT, ha vai tro, rut quyen, khoa, xoa. Chi "Quan ly cap cao"
//      (= admin cung, xem isSeniorAdmin) moi duoc — van full quyen nhu cu. Voi nhan vien
//      thuong va chinh minh thi Quan ly van lam duoc nhu truoc.
// Luat 1-3 khong rang buoc Quan ly/admin cung (giu nguyen hanh vi cu); luat 4 chi rang
// buoc Quan ly thuong.
//
// Moi ham tra ve null neu duoc phep, hoac chuoi ly do (tieng Viet) neu bi chan.
// ==========================================
'use strict';

const localUserStore = require('./localUserStore');
const featureRegistry = require('./featureRegistry');

const { ROLES } = localUserStore;
const DENIED_CODE = 'ACCOUNT_POLICY_DENIED';

/**
 * "Quan ly cap cao" = admin cung (HARDCODED_ADMINS + chu so huu duoc bao ve) — nhan dien
 * theo email/username giong effectiveUserResolver/featureRegistry. Khong co vai tro hay
 * cot DB rieng: them nguoi vao nhom nay = them dinh danh vao HARDCODED_ADMINS.
 */
function isSeniorAdmin(user) {
  if (!user) return false;
  return [user.email, user.username].some(id =>
    localUserStore.isHardcodedAdmin(id) || localUserStore.isProtectedSuperAdmin(id));
}

function isManagerClass(user) {
  if (!user) return false;
  if (user.vaiTro === ROLES.QUAN_LY) return true;
  return isSeniorAdmin(user);
}

/** Cung 1 tai khoan? (theo id, hoac username khong phan biet hoa/thuong) */
function isSameAccount(a, b) {
  if (!a || !b) return false;
  if (a.id !== undefined && a.id !== null && b.id !== undefined && b.id !== null &&
      String(a.id) === String(b.id)) return true;
  const username = user => String(user.username || '').trim().toLowerCase();
  return username(a) !== '' && username(a) === username(b);
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

/**
 * Luat 4: Quan ly THUONG khong duoc tac dong len tai khoan Quan ly KHAC. `action` la cum
 * dong tu dua vao thong bao ("đặt lại mật khẩu", "hạ vai trò", "rút quyền", "khóa tài khoản"...).
 * Tra ve null khi: actor la Quan ly cap cao, dich khong phai Quan ly/admin cung, hoac dich
 * chinh la actor (tu thao tac tren minh khong phai "nguoi khac").
 * Goi SAU luat 1-3 va SAU cac chot 400 rieng cua tung route (admin cung khong ha duoc...).
 */
function checkProtectedManager(actor, target, action) {
  if (isSeniorAdmin(actor)) return null;
  if (!isManagerClass(target)) return null;
  if (isSameAccount(actor, target)) return null;
  return `Chỉ Quản lý cấp cao mới được ${action} của Quản lý khác.`;
}

/** 403 chuan cho moi route khi bi chan boi chinh sach. */
function sendDenied(res, reason) {
  return res.status(403).json({ error: reason, code: DENIED_CODE });
}

module.exports = {
  DENIED_CODE,
  isSeniorAdmin,
  isManagerClass,
  checkTargetWritable,
  checkGrant,
  checkTakeover,
  checkProtectedManager,
  sendDenied
};
