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
    .filter(key => !featureRegistry.isDynamicFeature(key) && !before.has(key) && !own.has(key));
  if (missing.length) {
    return `Bạn không có quyền ${labelsOf(missing)} nên không thể cấp quyền này cho tài khoản khác.`;
  }
  return null;
}

function checkDepartmentGrant(actor, currentTarget, nextDepartments) {
  if (isManagerClass(actor)) return null;
  const normalize = require('../hr/hrApprovalDepartments').normalizeDepartments;
  const { departmentKey } = require('../hr/hrDepartment');
  const before = new Set(normalize((currentTarget && currentTarget.leaveApprovalDepartments) || []).map(departmentKey));
  const own = new Set(normalize((actor && actor.leaveApprovalDepartments) || []).map(departmentKey));
  if (normalize(nextDepartments).some(department => !before.has(departmentKey(department)) && !own.has(departmentKey(department)))) {
    return 'Bạn chỉ được cấp phòng ban trong phạm vi duyệt nghỉ phép của mình.';
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
  const missing = featureRegistry.resolvePermissions(target).filter(key => !featureRegistry.isDynamicFeature(key) && !own.has(key));
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

// ---- Luat 5 (2026-10-05): chan LEO THANG qua DINH DANH (email / SĐT / username) ----
// effectiveUserResolver nhan dien admin cung theo email/username va gan vai tro theo dong
// hr_employees khop email/SĐT (TK noi bo cu khong can xac minh). Vi vay GHI dinh danh qua
// route quan tri cung la mot dang "gan quyen" va phai qua cac chot duoi day.
const PROTECTED_IDENTITY_CODE = 'PROTECTED_IDENTITY';
const SELF_CONTACT_CHANGE_CODE = 'SELF_CONTACT_CHANGE';
const HR_ROLE_ESCALATION_CODE = 'HR_ROLE_ESCALATION';

/**
 * 5a. Khong ai (tru Quan ly cap cao) duoc dat email/username/SĐT trung mot dinh danh
 * admin cung (HARDCODED_ADMINS / chu so huu) — neu khong, resolver bien TK do thanh admin cung.
 * `identifiers` la mang gia tri SE GHI (bo qua gia tri rong).
 */
function checkProtectedIdentity(actor, identifiers) {
  if (isSeniorAdmin(actor)) return null;
  const hit = (identifiers || []).some(id =>
    String(id || '').trim() !== '' &&
    (localUserStore.isHardcodedAdmin(id) || localUserStore.isProtectedSuperAdmin(id)));
  if (!hit) return null;
  return 'Định danh này thuộc tài khoản Quản trị viên hệ thống, không thể gán cho tài khoản khác.';
}

/**
 * 5b. Khong tu doi email/SĐT cua CHINH MINH qua route quan tri (tru Quan ly cap cao):
 * doi qua trang Hồ sơ (co xac minh OTP) hoac nho Quan ly khac.
 */
function checkSelfContactChange(actor, target) {
  if (isSeniorAdmin(actor)) return null;
  if (!isSameAccount(actor, target)) return null;
  return 'Bạn không thể tự đổi email/số điện thoại của chính mình tại trang quản trị. Hãy dùng trang Hồ sơ cá nhân hoặc liên hệ một Quản lý khác.';
}

/**
 * MOI dinh danh ma resolver co the dung de khop TK voi dong nhan su — giong het
 * effectiveUserResolver.localUserMatchesEmployee: email VA username (neu co '@');
 * SĐT VA username (neu khong co '@'). Khong duoc bo qua username khi da co email/SĐT
 * (truoc 2026-10-05 vong 2: TK username = email Quan ly + email vo hai lot qua chot 5c).
 * Tra { emails, phones } da chuan hoa (trim/lowercase, normalizePhone), bo rong/trung.
 */
function hrIdentitiesOf(user) {
  const username = String((user && user.username) || '').trim();
  const uniq = values => [...new Set(values.filter(Boolean))];
  return {
    emails: uniq([user && user.email, username.includes('@') ? username : '']
      .map(value => String(value || '').trim().toLowerCase())),
    phones: uniq([user && user.soDienThoai, !username.includes('@') ? username : '']
      .map(value => localUserStore.normalizePhone(value)))
  };
}

/**
 * 5c. `employees` = cac dong hr_employees DANG HOAT DONG ma dinh danh moi se khop.
 * Neu vai tro sheet cua bat ky dong nao vuot qua nhung gi actor duoc phep cap (cung luat
 * checkGrant) thi chan — tranh tao/sua TK de resolver gan TK vao dong cua Quan ly.
 */
function checkHrRoleEscalation(actor, employees) {
  if (isManagerClass(actor)) return null;
  for (const employee of employees || []) {
    if (!employee || !employee.sheetVaiTro) continue;
    const denied = checkGrant(actor, null, { vaiTro: employee.sheetVaiTro, featurePermissions: {} });
    if (denied) {
      return `Email/số điện thoại này thuộc nhân sự có vai trò "${employee.sheetVaiTro}" — cao hơn quyền bạn được cấp, chỉ Quản lý mới được gán.`;
    }
  }
  return null;
}

/** 403 chuan cho moi route khi bi chan boi chinh sach. */
function sendDenied(res, reason, code = DENIED_CODE) {
  return res.status(403).json({ error: reason, code });
}

module.exports = {
  DENIED_CODE,
  PROTECTED_IDENTITY_CODE,
  SELF_CONTACT_CHANGE_CODE,
  HR_ROLE_ESCALATION_CODE,
  checkProtectedIdentity,
  checkSelfContactChange,
  checkHrRoleEscalation,
  hrIdentitiesOf,
  isSeniorAdmin,
  isManagerClass,
  checkTargetWritable,
  checkGrant,
  checkDepartmentGrant,
  checkTakeover,
  checkProtectedManager,
  sendDenied
};
