// ==========================================
// ADMIN USER ROUTES — API quản trị tài khoản người dùng dành riêng cho Quản lý.
// Cung cấp các thao tác CRUD, đặt lại mật khẩu, khóa/mở khóa tài khoản.
// Áp dụng chặt chẽ business rule: Chống tự hạ quyền, tự khóa, tự xóa chính mình.
// ==========================================
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { requireAuth, requireRole } = require('./authMiddleware');
const localUserStore = require('./localUserStore');
const { ROLES, ACTIVE_STATUS, LOCKED_STATUS, PENDING_STATUS } = localUserStore;
const { normalizePhone } = require('./userRepository');
const notificationRepo = require('../notifications/notificationRepository');

const router = express.Router();

const VALID_ROLES = Object.values(ROLES);
const VALID_STATUSES = [ACTIVE_STATUS, LOCKED_STATUS, PENDING_STATUS];

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
    hasPassword: !!u.passwordHash
  };
}

// Áp dụng bảo vệ toàn bộ route admin
router.use('/api/admin/users', requireAuth, requireRole(ROLES.QUAN_LY));

/**
 * GET /api/admin/users — Danh sách tất cả người dùng trong hệ thống.
 */
router.get('/api/admin/users', async (req, res) => {
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
router.post('/api/admin/users', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const hoTen = String(req.body.hoTen || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const soDienThoai = String(req.body.soDienThoai || '').trim();
    const vaiTro = String(req.body.vaiTro || ROLES.KHACH).trim();
    const coSo = String(req.body.coSo || '').trim();

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

    // Bao cac Quan ly khac biet - best-effort, KHONG duoc lam hong response da tra o tren.
    try {
      const allUsers = await localUserStore.getAllUsers();
      const managerIds = allUsers
        .filter(u => u.vaiTro === ROLES.QUAN_LY && String(u.id) !== String(req.user.id))
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
router.put('/api/admin/users/:id', async (req, res) => {
  try {
    const targetId = req.params.id;
    const targetUser = await localUserStore.getUserById(targetId);
    if (!targetUser) {
      return res.status(404).json({ error: 'Không tìm thấy tài khoản cần chỉnh sửa.' });
    }

    const currentAdminId = req.user.id;
    const isSelf = String(currentAdminId) === String(targetId) ||
                   req.user.username.toLowerCase() === targetUser.username.toLowerCase();
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
      updates.email = email;
    }

    if (req.body.soDienThoai !== undefined) {
      const soDienThoai = String(req.body.soDienThoai || '').trim();
      if (soDienThoai) {
        const normPhone = normalizePhone(soDienThoai);
        if (!/^(0|\+84)(3|5|7|8|9)[0-9]{8}$/.test(normPhone) && !/^[0-9]{10}$/.test(normPhone)) {
          return res.status(400).json({ error: 'Số điện thoại không đúng định dạng.' });
        }
        updates.soDienThoai = normPhone;
      } else {
        updates.soDienThoai = '';
      }
    }

    if (req.body.coSo !== undefined) {
      updates.coSo = String(req.body.coSo || '').trim();
    }

    if (req.body.vaiTro !== undefined) {
      const vaiTro = String(req.body.vaiTro).trim();
      if (!VALID_ROLES.includes(vaiTro)) {
        return res.status(400).json({ error: `Vai trò không hợp lệ: ${vaiTro}` });
      }
      // Business Rule: Chống tự hạ quyền & chống hạ quyền Admin mặc định
      if (isSelf && vaiTro !== ROLES.QUAN_LY) {
        return res.status(400).json({ error: 'Bạn không thể tự hạ quyền Quản lý của chính mình.' });
      }
      if (isTargetHardcodedAdmin && vaiTro !== ROLES.QUAN_LY) {
        return res.status(400).json({ error: 'Không thể hạ quyền của tài khoản Quản trị viên hệ thống mặc định.' });
      }
      updates.vaiTro = vaiTro;
    }

    if (req.body.trangThai !== undefined) {
      const trangThai = String(req.body.trangThai).trim();
      if (!VALID_STATUSES.includes(trangThai)) {
        return res.status(400).json({ error: `Trạng thái không hợp lệ: ${trangThai}` });
      }
      // Business Rule: Chống tự khóa & chống khóa Admin mặc định
      if (isSelf && trangThai !== ACTIVE_STATUS) {
        return res.status(400).json({ error: 'Bạn không thể tự khóa tài khoản của chính mình.' });
      }
      if (isTargetHardcodedAdmin && trangThai !== ACTIVE_STATUS) {
        return res.status(400).json({ error: 'Không thể khóa tài khoản Quản trị viên hệ thống mặc định.' });
      }
      updates.trangThai = trangThai;
    }

    const updated = await localUserStore.updateUser(targetId, updates);
    res.status(200).json({ user: publicAdminUser(updated) });
  } catch (err) {
    if (err && err.code === 'USER_EXISTS') {
      return res.status(409).json({ error: err.message });
    }
    console.error('=== LOI PUT /api/admin/users/:id ===', err);
    res.status(500).json({ error: 'Không cập nhật được tài khoản.' });
  }
});

/**
 * POST /api/admin/users/:id/reset-password — Đặt lại mật khẩu cho user.
 */
router.post('/api/admin/users/:id/reset-password', async (req, res) => {
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
router.delete('/api/admin/users/:id', async (req, res) => {
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

module.exports = router;
