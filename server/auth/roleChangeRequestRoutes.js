// ==========================================
// ROLE CHANGE REQUEST ROUTES — /api/role-requests/* : người dùng tự yêu cầu
// đổi vai trò (vaiTro); Quản lý duyệt/từ chối. Khi tạo yêu cầu, toàn bộ tài
// khoản Quản lý nhận thông báo qua notificationRepository (xem
// server/notifications/notificationRepository.js).
//
// Mount trong server/routes.js:
//   const roleChangeRequestRoutes = require('./auth/roleChangeRequestRoutes');
//   router.use(roleChangeRequestRoutes);
// ==========================================
'use strict';

const express = require('express');
const router = express.Router();

const { requireAuth, requireRole } = require('./authMiddleware');
const localUserStore = require('./localUserStore');
const { ROLES } = localUserStore;
const repo = require('./roleChangeRequestRepository');
const notificationRepo = require('../notifications/notificationRepository');

const VALID_ROLES = Object.values(ROLES);
const authManager = [requireAuth, requireRole(ROLES.QUAN_LY)];

function handleError(res, err, context) {
  if (err.statusCode && err.statusCode < 500) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }
  console.error(`=== LOI ${context} ===`);
  console.error(err.stack);
  console.error(`${'='.repeat(context.length + 10)}`);
  return res.status(500).json({ error: 'Lỗi hệ thống, vui lòng thử lại sau.', code: err.code });
}

// ---------------------------------------------------------------------------
// POST /api/role-requests — bất kỳ tài khoản nào cũng gửi được yêu cầu
// ---------------------------------------------------------------------------

router.post('/api/role-requests', requireAuth, async (req, res) => {
  try {
    const requestedRole = String((req.body && req.body.requestedRole) || '').trim();
    const reason = String((req.body && req.body.reason) || '').trim();

    if (!requestedRole || !VALID_ROLES.includes(requestedRole)) {
      return res.status(400).json({ error: `Vai trò không hợp lệ: ${requestedRole}`, code: 'INVALID_REQUEST' });
    }
    const isTargetThang = (localUserStore.isProtectedSuperAdmin && (localUserStore.isProtectedSuperAdmin(req.user.username) || localUserStore.isProtectedSuperAdmin(req.user.email))) ||
                          localUserStore.isHardcodedAdmin(req.user.username) || localUserStore.isHardcodedAdmin(req.user.email);
    if (isTargetThang) {
      return res.status(400).json({
        error: 'Tài khoản Quản trị viên hệ thống mặc định (thangnnv2003@gmail.com) không thể đổi vai trò qua yêu cầu này.',
        code: 'ROLE_REQUEST_HARDCODED_ADMIN'
      });
    }
    if (requestedRole === req.user.vaiTro) {
      return res.status(400).json({ error: 'Vai trò yêu cầu trùng với vai trò hiện tại.', code: 'SAME_ROLE' });
    }
    if (await repo.hasPendingRequest(req.user.id)) {
      return res.status(409).json({ error: 'Bạn đang có một yêu cầu đổi vai trò chờ duyệt.', code: 'ROLE_REQUEST_PENDING' });
    }

    const request = await repo.createRequest({
      userId: req.user.id,
      username: req.user.username,
      hoTen: req.user.hoTen,
      currentRole: req.user.vaiTro,
      requestedRole,
      reason
    });

    // Bao toan bo Quan ly best-effort — KHONG duoc lam hong response da tao request.
    try {
      const allUsers = await localUserStore.getAllUsers();
      const managerIds = allUsers.filter(u => u.vaiTro === ROLES.QUAN_LY).map(u => u.id);
      await notificationRepo.createNotificationForUsers(managerIds, {
        type: 'role_change_request',
        title: 'Yêu cầu đổi vai trò mới',
        message: `${request.hoTen || request.username} yêu cầu đổi từ "${request.currentRole}" sang "${request.requestedRole}".`,
        relatedType: 'roleChangeRequest',
        relatedId: request.id
      });
    } catch (notifyErr) {
      console.error('Lỗi báo thông báo yêu cầu đổi vai trò cho Quản lý:', notifyErr.message);
    }

    res.status(201).json({ request });
  } catch (err) {
    handleError(res, err, 'POST /api/role-requests');
  }
});

// ---------------------------------------------------------------------------
// GET /api/role-requests — Quan ly xem tat ca (loc duoc theo status);
// nguoi khac chi xem yeu cau cua chinh minh.
// ---------------------------------------------------------------------------

router.get('/api/role-requests', requireAuth, async (req, res) => {
  try {
    const isManager = req.user.vaiTro === ROLES.QUAN_LY;
    const requests = await repo.listRequests({
      status: req.query.status,
      userId: isManager ? undefined : req.user.id
    });
    res.status(200).json({ requests });
  } catch (err) {
    handleError(res, err, 'GET /api/role-requests');
  }
});

// ---------------------------------------------------------------------------
// GET /api/role-requests/:id — chi tiet 1 yeu cau (chu hoac Quan ly)
// ---------------------------------------------------------------------------

router.get('/api/role-requests/:id', requireAuth, async (req, res) => {
  try {
    const request = await repo.getRequestById(req.params.id);
    if (!request) {
      return res.status(404).json({ error: 'Không tìm thấy yêu cầu.', code: 'ROLE_REQUEST_NOT_FOUND' });
    }
    const isManager = req.user.vaiTro === ROLES.QUAN_LY;
    if (!isManager && request.userId !== String(req.user.id)) {
      return res.status(403).json({ error: 'Bạn không có quyền xem yêu cầu này.', code: 'ROLE_REQUEST_FORBIDDEN' });
    }
    res.status(200).json({ request });
  } catch (err) {
    handleError(res, err, 'GET /api/role-requests/:id');
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/role-requests/:id/status — chi Quan ly duyet/tu choi
// ---------------------------------------------------------------------------

router.patch('/api/role-requests/:id/status', ...authManager, async (req, res) => {
  try {
    const status = req.body && req.body.status;
    const note = req.body && req.body.note;
    if (![repo.ROLE_REQUEST_STATUS.APPROVED, repo.ROLE_REQUEST_STATUS.REJECTED].includes(status)) {
      return res.status(400).json({ error: 'Trạng thái không hợp lệ.', code: 'INVALID_REQUEST' });
    }

    const target = await repo.getRequestById(req.params.id);
    if (!target) {
      return res.status(404).json({ error: 'Không tìm thấy yêu cầu.', code: 'ROLE_REQUEST_NOT_FOUND' });
    }
    if (target.status !== repo.ROLE_REQUEST_STATUS.PENDING) {
      return res.status(409).json({ error: 'Yêu cầu này đã được xử lý trước đó.', code: 'ROLE_REQUEST_ALREADY_HANDLED' });
    }
    if (String(target.userId) === String(req.user.id)) {
      return res.status(403).json({
        error: 'Bạn không thể tự duyệt yêu cầu đổi vai trò của chính mình.',
        code: 'ROLE_REQUEST_SELF_REVIEW'
      });
    }

    // Cap nhat vaiTro TRUOC khi danh dau request la Da duyet — neu updateUser
    // that bai (vd user da bi xoa), request VAN GIU trang thai Cho duyet thay
    // vi bi khoa vinh vien o trang thai "Da duyet" trong khi vaiTro chua doi.
    if (status === repo.ROLE_REQUEST_STATUS.APPROVED) {
      await localUserStore.updateUser(target.userId, { vaiTro: target.requestedRole });
    }

    const updated = await repo.updateRequestStatus(req.params.id, {
      status,
      reviewedBy: req.user.hoTen || req.user.username,
      reviewedByUserId: req.user.id,
      reviewNote: note
    });

    try {
      const isApproved = status === repo.ROLE_REQUEST_STATUS.APPROVED;
      await notificationRepo.createNotification({
        recipientUserId: updated.userId,
        type: 'role_change_decision',
        title: isApproved ? 'Yêu cầu đổi vai trò đã được duyệt' : 'Yêu cầu đổi vai trò đã bị từ chối',
        message: note
          ? `${isApproved ? 'Đã duyệt' : 'Từ chối'}: ${note}`
          : `Yêu cầu đổi vai trò của bạn đã ${isApproved ? 'được duyệt' : 'bị từ chối'}.`,
        relatedType: 'roleChangeRequest',
        relatedId: updated.id
      });
    } catch (notifyErr) {
      console.error('Lỗi báo kết quả duyệt yêu cầu đổi vai trò:', notifyErr.message);
    }

    res.status(200).json({ request: updated });
  } catch (err) {
    handleError(res, err, 'PATCH /api/role-requests/:id/status');
  }
});

module.exports = router;
