// ==========================================
// ADMIN USER ROUTES — API quản trị tài khoản người dùng dành riêng cho Quản lý.
// Cung cấp các thao tác CRUD, đặt lại mật khẩu, khóa/mở khóa tài khoản.
// Áp dụng chặt chẽ business rule: Chống tự hạ quyền, tự khóa, tự xóa chính mình.
// ==========================================
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { requireAuth, requireFeature } = require('./authMiddleware');
const localUserStore = require('./localUserStore');
const { ROLES, ACTIVE_STATUS, INACTIVE_STATUS, LOCKED_STATUS, PENDING_STATUS } = localUserStore;
const { normalizePhone } = require('./userRepository');
const featureRegistry = require('./featureRegistry');
const notificationRepo = require('../notifications/notificationRepository');
const { normalizeCoSo, BRANCH_VALUES } = require('../branch/branches');
const contactChangeService = require('./contactChangeService');
const employeeDirectory = require('../hr/employeeDirectory');

const router = express.Router();

const VALID_ROLES = Object.values(ROLES);
const VALID_STATUSES = [ACTIVE_STATUS, INACTIVE_STATUS, LOCKED_STATUS, PENDING_STATUS];

function publicAdminUser(u) {
  return {
    id: u.id,
    username: u.username,
    hoTen: u.hoTen,
    email: u.email || '',
    soDienThoai: u.soDienThoai || '',
    emailKhoiPhuc: u.emailKhoiPhuc || '',
    sdtKhoiPhuc: u.sdtKhoiPhuc || '',
    vaiTro: u.vaiTro,
    coSo: u.coSo || '',
    trangThai: u.trangThai,
    ngayTao: u.ngayTao || '',
    dangNhapGanNhat: u.dangNhapGanNhat || '',
    hasPassword: !!u.passwordHash,
    hrManaged: !!u.hrManaged,
    hrSourceBranch: u.hrSourceBranch || '',
    sheetVaiTro: u.sheetVaiTro || '',
    sheetCoSo: u.sheetCoSo || '',
    vaiTroOverride: u.vaiTroOverride || '',
    coSoOverride: u.coSoOverride || '',
    roleSource: u.roleSource || (u.hrManaged ? 'sheet' : 'local'),
    lockReason: u.lockReason || '',
    // Ghi de quyen rieng cua tai khoan (DELTA so voi mac dinh theo vai tro) —
    // bang nguoi dung dua vao day de hien nhan "đã tuỳ chỉnh quyền".
    featurePermissions: featureRegistry.sanitizeOverrides(u.featurePermissions)
  };
}

// Phan quyen theo TINH NANG (featureRegistry.js):
//   account.users         — xem danh sach (mac dinh: moi vai tro noi bo)
//   account.users.manage  — them/sua/khoa/xoa (mac dinh: chi Quan ly)
//   account.permissions   — phan quyen chi tiet (mac dinh: chi Quan ly)
const authView = [requireAuth, requireFeature('account.users')];
const authManage = [requireAuth, requireFeature('account.users.manage')];
const authPermissions = [requireAuth, requireFeature('account.permissions')];

/**
 * GET /api/admin/users — Danh sách tất cả người dùng trong hệ thống.
 */
router.get('/api/admin/users', ...authView, async (req, res) => {
  try {
    const users = await localUserStore.getAllUsers();
    const result = users.map(publicAdminUser);
    res.status(200).json({ users: result });
  } catch (err) {
    console.error('=== LOI GET /api/admin/users ===', err);
    res.status(500).json({ error: 'Không tải được danh sách người dùng.' });
  }
});

/**
 * POST /api/admin/users — Tạo mới một tài khoản người dùng.
 */
router.post('/api/admin/users', ...authManage, async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const hoTen = String(req.body.hoTen || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const soDienThoai = String(req.body.soDienThoai || '').trim();
    const vaiTro = String(req.body.vaiTro || ROLES.KHACH).trim();
    const rawCoSo = String(req.body.coSo || '').trim();
    // Chuan hoa ve dung 'Hà Nội' | 'Sài Gòn' | 'Cả hai'; gia tri la ('An Khánh'
    // /'Tân Phú' cua du lieu cu) van duoc chap nhan va tu doi ten.
    const coSo = rawCoSo ? normalizeCoSo(rawCoSo) : '';

    if (!username) {
      return res.status(400).json({ error: 'Vui lòng nhập tên tài khoản (username).' });
    }
    if (username.length < 3 || username.length > 50) {
      return res.status(400).json({ error: 'Tên tài khoản phải từ 3 đến 50 ký tự.' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Mật khẩu khởi tạo phải có ít nhất 8 ký tự.' });
    }
    if (!hoTen) {
      return res.status(400).json({ error: 'Vui lòng nhập họ và tên.' });
    }
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return res.status(400).json({ error: 'Email không đúng định dạng.' });
    }
    if (soDienThoai) {
      const normPhone = normalizePhone(soDienThoai);
      if (!/^(0|\+84)(3|5|7|8|9)[0-9]{8}$/.test(normPhone) && !/^[0-9]{10}$/.test(normPhone)) {
        return res.status(400).json({ error: 'Số điện thoại không đúng định dạng (yêu cầu 10 số).' });
      }
    }
    if (!VALID_ROLES.includes(vaiTro)) {
      return res.status(400).json({ error: `Vai trò không hợp lệ. Cho phép: ${VALID_ROLES.join(', ')}` });
    }
    if (rawCoSo && !coSo) {
      return res.status(400).json({ error: `Cơ sở phụ trách không hợp lệ. Cho phép: ${BRANCH_VALUES.join(', ')}` });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = await localUserStore.createUser({
      id: crypto.randomUUID(),
      username,
      passwordHash,
      hoTen,
      email,
      soDienThoai: normalizePhone(soDienThoai),
      vaiTro,
      coSo,
      trangThai: ACTIVE_STATUS
    });

    res.status(201).json({ user: publicAdminUser(newUser) });

    // Bao cho nhung nguoi khac co quyen quan ly tai khoan - best-effort,
    // KHONG duoc lam hong response da tra o tren.
    try {
      const allUsers = await localUserStore.getAllUsers();
      const managerIds = allUsers
        .filter(u => featureRegistry.hasFeature(u, 'account.users.manage') && String(u.id) !== String(req.user.id))
        .map(u => u.id);
      await notificationRepo.createNotificationForUsers(managerIds, {
        type: 'account_created',
        title: 'Tài khoản mới được tạo',
        message: `${newUser.hoTen || newUser.username} (${newUser.username}) vừa được tạo với vai trò "${newUser.vaiTro}".`,
        relatedType: 'accountCreated',
        relatedId: newUser.id
      });
    } catch (notifyErr) {
      console.error('Lỗi báo thông báo tài khoản mới cho Quản lý:', notifyErr.message);
    }
  } catch (err) {
    if (err && err.code === 'USER_EXISTS') {
      return res.status(409).json({ error: err.message });
    }
    console.error('=== LOI POST /api/admin/users ===', err);
    res.status(500).json({ error: 'Không tạo được tài khoản, vui lòng thử lại.' });
  }
});

/**
 * PUT /api/admin/users/:id — Chỉnh sửa thông tin tài khoản.
 */
router.put('/api/admin/users/:id', ...authManage, async (req, res) => {
  try {
    const targetId = req.params.id;
    let targetUser = await localUserStore.getUserById(targetId);
    if (!targetUser) {
      return res.status(404).json({ error: 'Không tìm thấy tài khoản cần chỉnh sửa.' });
    }

    const currentAdminId = req.user.id;
    const isSelf = String(currentAdminId) === String(targetId) ||
                   req.user.username.toLowerCase() === targetUser.username.toLowerCase();
    const isTargetThang = (localUserStore.isProtectedSuperAdmin && (localUserStore.isProtectedSuperAdmin(targetUser.email) || localUserStore.isProtectedSuperAdmin(targetUser.username))) ||
                          (targetUser.email && targetUser.email.toLowerCase() === 'thangnnv2003@gmail.com') ||
                          (targetUser.username && targetUser.username.toLowerCase() === 'thangnnv2003@gmail.com') ||
                          (targetUser.username && targetUser.username.toLowerCase() === 'thangnnv2003');
    const isTargetHardcodedAdmin = localUserStore.isHardcodedAdmin(targetUser.email) ||
                                   localUserStore.isHardcodedAdmin(targetUser.username);

    const updates = {};

    if (req.body.hoTen !== undefined) {
      const hoTen = String(req.body.hoTen || '').trim();
      if (!hoTen) return res.status(400).json({ error: 'Họ tên không được để trống.' });
      updates.hoTen = hoTen;
    }

    if (req.body.email !== undefined) {
      const email = String(req.body.email || '').trim().toLowerCase();
      if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
        return res.status(400).json({ error: 'Email không đúng định dạng.' });
      }
      if (targetUser.hrManaged && email !== String(targetUser.email || '').toLowerCase()) {
        targetUser = await contactChangeService.adminChange(targetUser, 'email', email);
      } else {
        updates.email = email;
      }
    }

    if (req.body.soDienThoai !== undefined) {
      const soDienThoai = String(req.body.soDienThoai || '').trim();
      if (soDienThoai) {
        const normPhone = normalizePhone(soDienThoai);
        if (!/^(0|\+84)(3|5|7|8|9)[0-9]{8}$/.test(normPhone) && !/^[0-9]{10}$/.test(normPhone)) {
          return res.status(400).json({ error: 'Số điện thoại không đúng định dạng.' });
        }
        if (targetUser.hrManaged && normPhone !== normalizePhone(targetUser.soDienThoai)) {
          targetUser = await contactChangeService.adminChange(targetUser, 'phone', normPhone);
        } else {
          updates.soDienThoai = normPhone;
        }
      } else {
        updates.soDienThoai = '';
      }
    }

    if (req.body.coSo !== undefined) {
      const rawCoSo = String(req.body.coSo || '').trim();
      const coSo = rawCoSo ? normalizeCoSo(rawCoSo) : '';
      if (rawCoSo && !coSo) {
        return res.status(400).json({ error: `Cơ sở phụ trách không hợp lệ. Cho phép: ${BRANCH_VALUES.join(', ')}` });
      }
      updates.coSo = coSo;
    }

    let hrRoleToSync = null;

    if (req.body.vaiTro !== undefined) {
      const vaiTro = String(req.body.vaiTro).trim();
      if (!VALID_ROLES.includes(vaiTro)) {
        return res.status(400).json({ error: `Vai trò không hợp lệ: ${vaiTro}` });
      }
      // Business Rule: Chống tự hạ quyền & chống hạ quyền thangnnv2003@gmail.com / Admin mặc định
      if (isSelf && vaiTro !== ROLES.QUAN_LY) {
        return res.status(400).json({ error: 'Bạn không thể tự hạ quyền Quản lý của chính mình.' });
      }
      if (isTargetThang && vaiTro !== ROLES.QUAN_LY) {
        return res.status(400).json({ error: 'Không ai có quyền hạ quyền tài khoản thangnnv2003@gmail.com.' });
      }
      if (isTargetHardcodedAdmin && vaiTro !== ROLES.QUAN_LY) {
        return res.status(400).json({ error: 'Không thể hạ quyền của tài khoản Quản trị viên hệ thống mặc định.' });
      }
      updates.vaiTro = vaiTro;
      // Tài khoản đồng bộ HR: resolveUser() luôn tính lại vaiTro từ Danh sách nhân sự
      // trừ khi có vaiTroOverride — nếu không set override ở đây, thay đổi này sẽ
      // bị ghi đè lại ngay ở lần requireAuth kế tiếp của user đó.
      if (targetUser.hrManaged) {
        updates.vaiTroOverride = vaiTro;
        updates.roleSource = 'override';
        hrRoleToSync = vaiTro;
      }
    }

    if (req.body.vaiTroOverride !== undefined) {
      if (!targetUser.hrManaged) {
        return res.status(409).json({ error: 'Chỉ tài khoản đồng bộ HR mới có ghi đè vai trò.' });
      }
      const vaiTroOverride = req.body.vaiTroOverride === null ? '' : String(req.body.vaiTroOverride).trim();
      if (vaiTroOverride && !VALID_ROLES.includes(vaiTroOverride)) {
        return res.status(400).json({ error: `Vai trò ghi đè không hợp lệ: ${vaiTroOverride}` });
      }
      if (isSelf && vaiTroOverride && vaiTroOverride !== ROLES.QUAN_LY) {
        return res.status(400).json({ error: 'Bạn không thể tự hạ quyền Quản lý của chính mình.' });
      }
      if (isTargetHardcodedAdmin && vaiTroOverride !== ROLES.QUAN_LY) {
        return res.status(400).json({ error: 'Không thể thay đổi ghi đè của tài khoản Quản trị viên hệ thống.' });
      }
      updates.vaiTroOverride = vaiTroOverride;
      updates.vaiTro = vaiTroOverride || targetUser.sheetVaiTro || ROLES.KHACH;
      updates.roleSource = vaiTroOverride ? 'override' : 'sheet';
      hrRoleToSync = vaiTroOverride || null;
    }

    if (req.body.coSoOverride !== undefined) {
      if (!targetUser.hrManaged) {
        return res.status(409).json({ error: 'Chỉ tài khoản đồng bộ HR mới có ghi đè cơ sở.' });
      }
      const rawOverride = req.body.coSoOverride === null ? '' : String(req.body.coSoOverride).trim();
      const coSoOverride = rawOverride ? normalizeCoSo(rawOverride) : '';
      if (rawOverride && !coSoOverride) {
        return res.status(400).json({ error: `Cơ sở ghi đè không hợp lệ. Cho phép: ${BRANCH_VALUES.join(', ')}` });
      }
      if (isTargetHardcodedAdmin && coSoOverride !== 'Cả hai') {
        return res.status(400).json({ error: 'Không thể thay đổi cơ sở của tài khoản Quản trị viên hệ thống.' });
      }
      updates.coSoOverride = coSoOverride;
      updates.coSo = coSoOverride || targetUser.sheetCoSo || 'Cả hai';
    }

    if (req.body.trangThai !== undefined) {
      const trangThai = String(req.body.trangThai).trim();
      if (!VALID_STATUSES.includes(trangThai)) {
        return res.status(400).json({ error: `Trạng thái không hợp lệ: ${trangThai}` });
      }
      // Business Rule: Chống tự khóa & chống khóa thangnnv2003@gmail.com / Admin mặc định
      if (isSelf && (trangThai === LOCKED_STATUS || trangThai === 'Khóa')) {
        return res.status(400).json({ error: 'Bạn không thể tự khóa tài khoản của chính mình.' });
      }
      if (isTargetThang && (trangThai === LOCKED_STATUS || trangThai === 'Khóa')) {
        return res.status(400).json({ error: 'Không ai có quyền khóa tài khoản thangnnv2003@gmail.com.' });
      }
      if (isTargetHardcodedAdmin && (trangThai === LOCKED_STATUS || trangThai === 'Khóa')) {
        return res.status(400).json({ error: 'Không thể khóa tài khoản Quản trị viên hệ thống mặc định.' });
      }
      updates.trangThai = trangThai;
      updates.lockReason = (trangThai === LOCKED_STATUS || trangThai === 'Khóa') ? 'manual' : '';
    }

    const updated = await localUserStore.updateUser(targetId, updates);

    if (hrRoleToSync && targetUser.hrSourceBranch && targetUser.hrRowIndex) {
      try {
        await employeeDirectory.writeDepartmentForRole(targetUser.hrSourceBranch, targetUser.hrRowIndex, hrRoleToSync);
      } catch (syncErr) {
        console.error('=== LOI dong bo BO PHAN len Danh sach nhan su ===', syncErr);
      }
    }

    res.status(200).json({ user: publicAdminUser(updated) });
  } catch (err) {
    if (err && err.code === 'USER_EXISTS') {
      return res.status(409).json({ error: err.message });
    }
    if (err && err.statusCode && err.statusCode < 500) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    console.error('=== LOI PUT /api/admin/users/:id ===', err);
    res.status(500).json({ error: 'Không cập nhật được tài khoản.' });
  }
});

/**
 * POST /api/admin/users/:id/reset-password — Đặt lại mật khẩu cho user.
 */
router.post('/api/admin/users/:id/reset-password', ...authManage, async (req, res) => {
  try {
    const targetId = req.params.id;
    const targetUser = await localUserStore.getUserById(targetId);
    if (!targetUser) {
      return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    }

    const newPassword = String(req.body.newPassword || '');
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 8 ký tự.' });
    }
    if (newPassword.length > 128) {
      return res.status(400).json({ error: 'Mật khẩu mới không được dài quá 128 ký tự.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await localUserStore.updateUser(targetId, { passwordHash });

    res.status(200).json({ ok: true, message: 'Đã đặt lại mật khẩu thành công.' });
  } catch (err) {
    console.error('=== LOI POST /api/admin/users/:id/reset-password ===', err);
    res.status(500).json({ error: 'Không đặt lại được mật khẩu.' });
  }
});

/**
 * DELETE /api/admin/users/:id — Xóa tài khoản người dùng.
 */
router.delete('/api/admin/users/:id', ...authManage, async (req, res) => {
  try {
    const targetId = req.params.id;
    const targetUser = await localUserStore.getUserById(targetId);
    if (!targetUser) {
      return res.status(404).json({ error: 'Không tìm thấy tài khoản để xóa.' });
    }

    const isSelf = String(req.user.id) === String(targetId) ||
                   req.user.username.toLowerCase() === targetUser.username.toLowerCase();
    if (isSelf) {
      return res.status(400).json({ error: 'Bạn không thể tự xóa tài khoản của chính mình.' });
    }

    const isTargetThang = (localUserStore.isProtectedSuperAdmin && (localUserStore.isProtectedSuperAdmin(targetUser.email) || localUserStore.isProtectedSuperAdmin(targetUser.username))) ||
                          (targetUser.email && targetUser.email.toLowerCase() === 'thangnnv2003@gmail.com') ||
                          (targetUser.username && targetUser.username.toLowerCase() === 'thangnnv2003@gmail.com') ||
                          (targetUser.username && targetUser.username.toLowerCase() === 'thangnnv2003');
    if (isTargetThang) {
      return res.status(400).json({ error: 'Không ai có quyền xóa tài khoản thangnnv2003@gmail.com.' });
    }

    const isTargetHardcodedAdmin = localUserStore.isHardcodedAdmin(targetUser.email) ||
                                   localUserStore.isHardcodedAdmin(targetUser.username);
    if (isTargetHardcodedAdmin) {
      return res.status(400).json({ error: 'Không thể xóa tài khoản Quản trị viên hệ thống mặc định.' });
    }

    await localUserStore.deleteUser(targetId);
    res.status(200).json({ ok: true, message: 'Đã xóa tài khoản thành công.' });
  } catch (err) {
    console.error('=== LOI DELETE /api/admin/users/:id ===', err);
    res.status(500).json({ error: 'Không xóa được tài khoản.' });
  }
});

// -------------------------------------------------------------
// PHAN QUYEN CHI TIET THEO TUNG TAI KHOAN
// Quyen mac dinh tinh theo vai tro (featureRegistry.js); moi tai khoan co the
// duoc ghi de tung key mot. Cot app_users.feature_permissions chi luu DELTA.
// -------------------------------------------------------------

/**
 * GET /api/admin/permissions/catalog — danh muc tinh nang + mac dinh theo vai
 * tro, de giao dien dung bang phan quyen ma khong chep lai nhan tieng Viet.
 */
router.get('/api/admin/permissions/catalog', ...authView, (req, res) => {
  const roleDefaults = {};
  for (const role of VALID_ROLES) roleDefaults[role] = featureRegistry.defaultsForRole(role);
  res.status(200).json({
    groups: featureRegistry.FEATURE_GROUPS,
    features: featureRegistry.FEATURES.map(f => ({
      key: f.key,
      label: f.label,
      groupKey: f.groupKey,
      alwaysOn: !!f.alwaysOn
    })),
    roleDefaults
  });
});

/**
 * Chan sua quyen cua Quan tri vien he thong, va chan tu thao go quyen quan tri
 * cua CHINH MINH (khoa chet: khong con ai vao duoc man hinh phan quyen).
 */
const SELF_LOCKOUT_KEYS = ['account.permissions', 'account.users.manage'];

function assertPermissionsEditable(req, targetUser, overrides) {
  const isTargetProtected = localUserStore.isProtectedSuperAdmin(targetUser.email) ||
                            localUserStore.isProtectedSuperAdmin(targetUser.username) ||
                            localUserStore.isHardcodedAdmin(targetUser.email) ||
                            localUserStore.isHardcodedAdmin(targetUser.username);
  if (isTargetProtected) {
    return 'Không thể thay đổi quyền của tài khoản Quản trị viên hệ thống.';
  }
  const isSelf = String(req.user.id) === String(targetUser.id) ||
                 String(req.user.username || '').toLowerCase() === String(targetUser.username || '').toLowerCase();
  if (isSelf && overrides) {
    const blocked = SELF_LOCKOUT_KEYS.filter(key => overrides[key] === false);
    if (blocked.length) {
      return 'Bạn không thể tự thu hồi quyền quản trị của chính mình.';
    }
  }
  return null;
}

function permissionsPayload(user) {
  return {
    userId: user.id,
    username: user.username,
    hoTen: user.hoTen || '',
    vaiTro: user.vaiTro,
    defaults: featureRegistry.defaultsForRole(user.vaiTro),
    overrides: featureRegistry.sanitizeOverrides(user.featurePermissions),
    effective: featureRegistry.resolvePermissions(user)
  };
}

/**
 * GET /api/admin/users/:id/permissions — quyen mac dinh + ghi de + hieu luc.
 */
router.get('/api/admin/users/:id/permissions', ...authPermissions, async (req, res) => {
  try {
    const targetUser = await localUserStore.getUserById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    }
    res.status(200).json(permissionsPayload(targetUser));
  } catch (err) {
    console.error('=== LOI GET /api/admin/users/:id/permissions ===', err);
    res.status(500).json({ error: 'Không tải được phân quyền của tài khoản.' });
  }
});

/**
 * PUT /api/admin/users/:id/permissions — ghi de THAY THE TOAN BO delta hien co.
 * Body: { overrides: { "<key>": true | false | null } } — null (hoac vang mat)
 * nghia la "quay ve mac dinh theo vai tro".
 */
router.put('/api/admin/users/:id/permissions', ...authPermissions, async (req, res) => {
  try {
    const targetUser = await localUserStore.getUserById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    }

    const raw = req.body && req.body.overrides;
    if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
      return res.status(400).json({ error: 'Trường "overrides" phải là một object.' });
    }

    const unknown = featureRegistry.unknownOverrideKeys(raw);
    if (unknown.length) {
      return res.status(400).json({
        error: `Quyền không hợp lệ: ${unknown.join(', ')}.`,
        code: 'UNKNOWN_FEATURE',
        validKeys: featureRegistry.FEATURE_KEYS
      });
    }

    const overrides = featureRegistry.sanitizeOverrides(raw);
    const blockedReason = assertPermissionsEditable(req, targetUser, overrides);
    if (blockedReason) {
      return res.status(400).json({ error: blockedReason });
    }

    const updated = await localUserStore.updateUser(targetUser.id, { featurePermissions: overrides });
    res.status(200).json(permissionsPayload(updated));

    // Bao cho chinh chu tai khoan biet quyen vua doi — best-effort, KHONG duoc
    // lam hong response da tra o tren.
    try {
      await notificationRepo.createNotificationForUsers([targetUser.id], {
        type: 'permissions_changed',
        title: 'Quyền truy cập đã được cập nhật',
        message: `${req.user.hoTen || req.user.username} vừa điều chỉnh quyền truy cập tài khoản của bạn. Tải lại trang để áp dụng.`,
        relatedType: 'permissionsChanged',
        relatedId: targetUser.id
      });
    } catch (notifyErr) {
      console.error('Lỗi báo thông báo đổi quyền:', notifyErr.message);
    }
  } catch (err) {
    console.error('=== LOI PUT /api/admin/users/:id/permissions ===', err);
    res.status(500).json({ error: 'Không lưu được phân quyền.' });
  }
});

module.exports = router;
