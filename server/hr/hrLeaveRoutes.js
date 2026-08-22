// ==========================================
// HR LEAVE ROUTES — /api/hr/* : quan ly yeu cau nghi phep + lien ket Telegram.
//
// Mount trong server/routes.js:
//   const hrLeaveRoutes = require('./hr/hrLeaveRoutes');
//   router.use(hrLeaveRoutes);
//
// Xem: mo hinh quyen han va handleError() theo dung shipmentOrderRoutes.js.
// ==========================================
'use strict';

const express = require('express');
const router = express.Router();

const { requireAuth, requireRole } = require('../auth/authMiddleware');
const { ROLES, INTERNAL_ROLES } = require('../auth/userRepository');
const repo = require('./hrLeaveRepository');
const {
  resolveApproverName,
  computeDurationSessions,
  parseIsoDateOnly,
  formatLeaveBoundary
} = require('./hrLeaveService');
const { buildLeaveRequestsWorkbook } = require('./hrLeaveExportService');
const { leaveEvents, LEAVE_EVENT_TYPES, broadcastLeaveEvent } = require('./hrLeaveEvents');

// Xem duoc: moi vai tro noi bo (Khach khong duoc).
const authInternal = [requireAuth, requireRole(...INTERNAL_ROLES)];
// Doi trang thai phe duyet / nhap tay: chi Quan ly.
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
// GET /api/hr/leave-requests/stream — Server-Sent Events (SSE) cap nhat realtime
// ---------------------------------------------------------------------------
// Dat TRUOC route /:id de tranh "stream" bi hieu nham la 1 request_id.

router.get('/api/hr/leave-requests/stream', ...authInternal, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Gui initial ping xac nhan ket noi thanh cong
  res.write(': connected\n\n');

  const onLeaveEvent = (payload) => {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (err) {
      // Client disconnect, khong can throw
    }
  };

  leaveEvents.on('leave-event', onLeaveEvent);

  // Heartbeat dinh ky de tranh timeout proxy / trinh duyet (25s)
  const heartbeatTimer = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (err) {
      clearInterval(heartbeatTimer);
    }
  }, 25000);

  req.on('close', () => {
    leaveEvents.removeListener('leave-event', onLeaveEvent);
    clearInterval(heartbeatTimer);
  });
});

// ---------------------------------------------------------------------------
// GET /api/hr/leave-requests — danh sach, loc theo status/employee/from-to (thoi gian gui)
// ---------------------------------------------------------------------------

router.get('/api/hr/leave-requests', ...authInternal, async (req, res) => {
  try {
    const { status, employee, from, to } = req.query;
    const requests = await repo.getLeaveRequests({ status, employee, from, to });
    res.status(200).json({ requests });
  } catch (err) {
    handleError(res, err, 'GET /api/hr/leave-requests');
  }
});

// ---------------------------------------------------------------------------
// GET /api/hr/leave-requests/summary/urgent-flags — dem "nghi gap"/thang
// ---------------------------------------------------------------------------
// Dat TRUOC route /:id de tranh "summary" bi hieu nham la 1 request_id.

router.get('/api/hr/leave-requests/summary/urgent-flags', ...authInternal, async (req, res) => {
  try {
    const summary = await repo.getUrgentFlagSummary(req.query.month);
    res.status(200).json({ summary });
  } catch (err) {
    handleError(res, err, 'GET /api/hr/leave-requests/summary/urgent-flags');
  }
});

// ---------------------------------------------------------------------------
// POST /api/hr/leave-requests/export — xuat Excel danh sach dang loc/sap xep
// ---------------------------------------------------------------------------
// Dat TRUOC route /:id de tranh "export" bi hieu nham la 1 request_id.

router.post('/api/hr/leave-requests/export', ...authInternal, async (req, res) => {
  try {
    const { status, employee, from, to, sortField, sortDir } = req.body || {};
    const { buffer, fileName, mime } = await buildLeaveRequestsWorkbook({ status, employee, from, to, sortField, sortDir });
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    handleError(res, err, 'POST /api/hr/leave-requests/export');
  }
});

// ---------------------------------------------------------------------------
// GET /api/hr/leave-requests/:id — chi tiet 1 yeu cau
// ---------------------------------------------------------------------------

router.get('/api/hr/leave-requests/:id', ...authInternal, async (req, res) => {
  try {
    const request = await repo.getLeaveRequestById(req.params.id);
    if (!request) {
      return res.status(404).json({ error: `Không tìm thấy yêu cầu "${req.params.id}".`, code: 'LEAVE_REQUEST_NOT_FOUND' });
    }
    res.status(200).json({ request });
  } catch (err) {
    handleError(res, err, 'GET /api/hr/leave-requests/:id');
  }
});

// ---------------------------------------------------------------------------
// POST /api/hr/leave-requests — Quan ly nhap tay (bao gom "tu y nghi")
// ---------------------------------------------------------------------------

router.post('/api/hr/leave-requests', ...authManager, async (req, res) => {
  try {
    const {
      web_username, ho_ten, chuc_vu, ly_do, loai_yeu_cau,
      start_date, start_session, end_date, end_session,
      nguoi_ban_giao, co_tu_y_nghi
    } = req.body || {};

    if (!ho_ten || !ly_do) {
      return res.status(400).json({ error: 'Thiếu trường bắt buộc: ho_ten, ly_do.', code: 'INVALID_REQUEST' });
    }

    const startDate = parseIsoDateOnly(start_date);
    const endDate = parseIsoDateOnly(end_date || start_date);
    const totalSessions = computeDurationSessions(startDate, start_session, endDate, end_session);
    if (!startDate || !endDate || totalSessions == null || totalSessions <= 0) {
      return res.status(400).json({
        error: 'Khoảng thời gian nghỉ không hợp lệ.',
        code: 'INVALID_LEAVE_RANGE'
      });
    }

    const isManualAbsence = !!co_tu_y_nghi || loai_yeu_cau === repo.LEAVE_TYPE.MANUAL_ABSENCE;
    const record = await repo.createLeaveRequest({
      web_username,
      ho_ten,
      chuc_vu,
      ly_do,
      loai_yeu_cau: isManualAbsence ? repo.LEAVE_TYPE.MANUAL_ABSENCE : repo.LEAVE_TYPE.REQUEST,
      thoi_gian_bat_dau: formatLeaveBoundary(startDate, start_session),
      thoi_gian_ket_thuc: formatLeaveBoundary(endDate, end_session),
      tong_buoi_nghi: totalSessions,
      nguoi_ban_giao,
      // Ban ghi "tu y nghi" la ghi nhan, khong phai don cho duyet -> mac dinh Da duyet.
      trang_thai: isManualAbsence ? repo.LEAVE_STATUS.APPROVED : repo.LEAVE_STATUS.PENDING,
      nguoi_duyet: isManualAbsence ? resolveApproverName(req.user) : undefined,
      thoi_diem_duyet: isManualAbsence ? new Date().toISOString() : undefined,
      co_tu_y_nghi: isManualAbsence
    });
    res.status(201).json({ request: record });

    // Phat tin hieu realtime toi tat ca cac client dang mo
    broadcastLeaveEvent(LEAVE_EVENT_TYPES.CREATED, record);
  } catch (err) {
    handleError(res, err, 'POST /api/hr/leave-requests');
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/hr/leave-requests/:id/status — Quan ly doi trang thai phe duyet
// ---------------------------------------------------------------------------

router.patch('/api/hr/leave-requests/:id/status', ...authManager, async (req, res) => {
  try {
    const { status, note } = req.body || {};
    if (!status) {
      return res.status(400).json({ error: 'Thiếu trường "status".', code: 'INVALID_REQUEST' });
    }
    const approver = resolveApproverName(req.user);
    const updated = await repo.updateLeaveRequestStatus(req.params.id, { status, approver, note });
    res.status(200).json({ request: updated });

    // Phat tin hieu realtime toi tat ca cac client dang mo
    broadcastLeaveEvent(LEAVE_EVENT_TYPES.STATUS_CHANGED, updated);

    // Bao Telegram best-effort, KHONG duoc lam hong response da tra o tren.
    if (updated.telegram_chat_id) {
      require('../telegram/hrTelegramBot')
        .notifyLeaveDecision(updated.telegram_chat_id, { status, note, requestId: updated.request_id })
        .catch(() => {});
    }
  } catch (err) {
    handleError(res, err, 'PATCH /api/hr/leave-requests/:id/status');
  }
});

// ---------------------------------------------------------------------------
// POST /api/hr/telegram/link-code — tu sinh ma lien ket cho chinh minh
// ---------------------------------------------------------------------------

router.post('/api/hr/telegram/link-code', ...authInternal, async (req, res) => {
  try {
    const link = await repo.createLinkCode(req.user.username);
    res.status(201).json({ code: link.link_code, expiresAt: link.expires_at });
  } catch (err) {
    handleError(res, err, 'POST /api/hr/telegram/link-code');
  }
});

// ---------------------------------------------------------------------------
// POST /api/hr/telegram/link-code/assign — Quan ly sinh ma ho nhan vien khac
// ---------------------------------------------------------------------------

router.post('/api/hr/telegram/link-code/assign', ...authManager, async (req, res) => {
  try {
    const { web_username } = req.body || {};
    if (!web_username) {
      return res.status(400).json({ error: 'Thiếu trường "web_username".', code: 'INVALID_REQUEST' });
    }
    const link = await repo.createLinkCode(web_username);
    res.status(201).json({ code: link.link_code, expiresAt: link.expires_at, web_username });
  } catch (err) {
    handleError(res, err, 'POST /api/hr/telegram/link-code/assign');
  }
});

// ---------------------------------------------------------------------------
// GET /api/hr/telegram/link-status — da lien ket Telegram hay chua
// ---------------------------------------------------------------------------

router.get('/api/hr/telegram/link-status', ...authInternal, async (req, res) => {
  try {
    const link = await repo.findLinkByWebUsername(req.user.username);
    res.status(200).json({
      linked: !!link,
      telegram_username: link ? link.telegram_username : null,
      linked_at: link ? link.linked_at : null
    });
  } catch (err) {
    handleError(res, err, 'GET /api/hr/telegram/link-status');
  }
});

module.exports = router;
