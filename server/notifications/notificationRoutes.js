// ==========================================
// NOTIFICATION ROUTES — /api/notifications/* : chuông thông báo dùng chung
// cho MỌI tài khoản (không giới hạn vai trò). Chỉ requireAuth, không
// requireRole — đây là hạ tầng chung, nội dung cụ thể tùy theo `type`.
//
// Mount trong server/routes.js:
//   const notificationRoutes = require('./notifications/notificationRoutes');
//   router.use(notificationRoutes);
// ==========================================
'use strict';

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../auth/authMiddleware');
const repo = require('./notificationRepository');

function handleError(res, err, context) {
  if (err.statusCode && err.statusCode < 500) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }
  console.error(`=== LOI ${context} ===`);
  console.error(err.stack);
  console.error(`${'='.repeat(context.length + 10)}`);
  return res.status(500).json({ error: 'Lỗi hệ thống, vui lòng thử lại sau.', code: err.code });
}

router.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const unreadOnly = req.query.unreadOnly === 'true';
    const notifications = await repo.listForUser(req.user.id, { unreadOnly });
    res.status(200).json({ notifications });
  } catch (err) {
    handleError(res, err, 'GET /api/notifications');
  }
});

router.get('/api/notifications/unread-count', requireAuth, async (req, res) => {
  try {
    const count = await repo.getUnreadCount(req.user.id);
    res.status(200).json({ count });
  } catch (err) {
    handleError(res, err, 'GET /api/notifications/unread-count');
  }
});

router.patch('/api/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    const updated = await repo.markRead(req.params.id, req.user.id);
    if (!updated) {
      return res.status(404).json({ error: 'Không tìm thấy thông báo.' });
    }
    res.status(200).json({ notification: updated });
  } catch (err) {
    handleError(res, err, 'PATCH /api/notifications/:id/read');
  }
});

router.patch('/api/notifications/read-all', requireAuth, async (req, res) => {
  try {
    const changed = await repo.markAllRead(req.user.id);
    res.status(200).json({ changed });
  } catch (err) {
    handleError(res, err, 'PATCH /api/notifications/read-all');
  }
});

module.exports = router;
