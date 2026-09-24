// ==========================================
// HR LEAVE ROUTES — /api/hr/* : quan ly yeu cau nghi phep.
//
// Mount trong server/routes.js:
//   const hrLeaveRoutes = require('./hr/hrLeaveRoutes');
//   router.use(hrLeaveRoutes);
//
// Routes nghi phep su dung cung chuan phan quyen va handleError() cua server.
// ==========================================
'use strict';

const express = require('express');
const router = express.Router();

const { requireAuth, requireFeature } = require('../auth/authMiddleware');
const repo = require('./hrLeaveRepository');
const employeeDirectory = require('./employeeDirectory');
const hrLeaveService = require('./hrLeaveService');
const {
  resolveApproverName,
  computeDurationSessions,
  parseIsoDateOnly,
  notifyOtherManagers
} = hrLeaveService;
const { buildLeaveRequestsWorkbook } = require('./hrLeaveExportService');
const { buildEmployeeDirectoryWorkbook } = require('./hrEmployeeExportService');
const { BRANCHES, BRANCH_BOTH, allowedBranches, normalizeCoSo } = require('../branch/branches');
const { leaveEvents, LEAVE_EVENT_TYPES, broadcastLeaveEvent } = require('./hrLeaveEvents');
const localUserStore = require('../auth/localUserStore');
const notificationRepo = require('../notifications/notificationRepository');

// Phan quyen theo TINH NANG (server/auth/featureRegistry.js).
//   hr.leave        — xem ho so nghi phep (mac dinh: moi vai tro noi bo)
//   hr.employees    — xem Danh sach nhan su
//   hr.leave.manage — tao / duyet nghi phep (mac dinh: chi Quan ly)
const authInternal = [requireAuth, requireFeature('hr.leave')];
const authEmployees = [requireAuth, requireFeature('hr.employees')];
const authManager = [requireAuth, requireFeature('hr.leave.manage')];

// Bo loc "Co so" cua trang: bo trong / 'all' / "Cả hai" = TAT CA co so tai
// khoan duoc xem (khong phu thuoc co so dang chon o thanh dieu huong); 1 co so
// cu the phai nam trong pham vi duoc phep, neu khong 403 — server luon xac
// thuc lai.
function resolveBranchScope(req, requested) {
  const allowed = allowedBranches(req.user);
  const wanted = String(requested == null ? '' : requested).trim();
  if (!wanted || wanted === 'all') return allowed;
  const branch = normalizeCoSo(wanted);
  // "Cả hai" la lua chon giao dien, khong phai mot co so vat ly. Voi bo loc cua
  // trang no dong nghia "Tat ca co so" — va van bi gioi han trong allowedBranches
  // nen KHONG BAO GIO mo rong pham vi cua tai khoan (vd tai khoan 1 co so).
  if (branch === BRANCH_BOTH) return allowed;
  if (branch !== BRANCHES.HANOI && branch !== BRANCHES.SAIGON) {
    throw new repo.HrError(`Cơ sở không hợp lệ: "${wanted}".`, 400, 'INVALID_BRANCH');
  }
  if (!allowed.includes(branch)) {
    throw new repo.HrError('Bạn không có quyền xem cơ sở này.', 403, 'BRANCH_FORBIDDEN');
  }
  return [branch];
}

// req.branch co the la "Cả hai" — day KHONG phai co so vat ly nen khong duoc
// dung lam nhan co so cho ban ghi hay cho thong bao/SSE.
function physicalBranchOrNull(branch) {
  return branch === BRANCHES.HANOI || branch === BRANCHES.SAIGON ? branch : null;
}

function handleError(res, err, context) {
  if (err.statusCode && err.statusCode < 500) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }
  // "Co so chua duoc cau hinh nguon du lieu" la 503 nhung KHONG phai loi he
  // thong — giu nguyen thong diep de nguoi dung biet phai lam gi (bao Quan ly
  // cau hinh nguon), thay vi "Loi he thong, vui long thu lai sau".
  if (err.code === 'BRANCH_NOT_CONFIGURED' || err.code === 'HR_DIRECTORY_UNAVAILABLE' || err.code === 'HR_DIRECTORY_SCHEMA_INVALID') {
    console.warn(`[${context}] ${err.detail || err.message}`);
    return res.status(err.statusCode || 503).json({ error: err.message, code: err.code });
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

  const watchedBranches = allowedBranches(req.user);
  const onLeaveEvent = (payload) => {
    // Chi day su kien cua cac co so tai khoan nay duoc phep xem.
    if (payload && payload.branch && !watchedBranches.includes(payload.branch)) return;
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
// GET /api/hr/leave-requests — danh sach, loc theo status/employee/department/branch/from-to
// ---------------------------------------------------------------------------

router.get('/api/hr/leave-requests', ...authInternal, async (req, res) => {
  try {
    const { status, employee, department, branch, from, to } = req.query;
    const requests = await repo.getLeaveRequests(
      { status, employee, department, from, to },
      resolveBranchScope(req, branch)
    );
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
    const summary = await repo.getUrgentFlagSummary(req.query.month, allowedBranches(req.user));
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
    const { status, employee, department, branch, from, to, sortField, sortDir } = req.body || {};
    const { buffer, fileName, mime } = await buildLeaveRequestsWorkbook(
      { status, employee, department, from, to, sortField, sortDir },
      resolveBranchScope(req, branch)
    );
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
    const request = await repo.getLeaveRequestById(req.params.id, allowedBranches(req.user));
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

    // Dang xem "Cả hai" thi khong co co so nao "dang chon" de gan cho don —
    // lay co so tu ho so nhan su, khong suy ra duoc thi bao loi (4xx) thay vi
    // ghi bua vao mot co so.
    const recordBranch = req.branch === BRANCH_BOTH
      ? await hrLeaveService.resolveEmployeeBranch(
        { webUsername: web_username, hoTen: ho_ten }, allowedBranches(req.user)
      )
      : req.branch;

    const isManualAbsence = !!co_tu_y_nghi || loai_yeu_cau === repo.LEAVE_TYPE.MANUAL_ABSENCE;
    const record = await repo.createLeaveRequest({
      web_username,
      ho_ten,
      chuc_vu,
      ly_do,
      loai_yeu_cau: isManualAbsence ? repo.LEAVE_TYPE.MANUAL_ABSENCE : repo.LEAVE_TYPE.REQUEST,
      start_date, start_session,
      end_date: end_date || start_date, end_session,
      tong_buoi_nghi: totalSessions,
      nguoi_ban_giao,
      // Ban ghi "tu y nghi" la ghi nhan, khong phai don cho duyet -> mac dinh Da duyet.
      trang_thai: isManualAbsence ? repo.LEAVE_STATUS.APPROVED : repo.LEAVE_STATUS.PENDING,
      nguoi_duyet: isManualAbsence ? resolveApproverName(req.user) : undefined,
      approver_user_id: isManualAbsence ? req.user.id : undefined,
      thoi_diem_duyet: isManualAbsence ? new Date().toISOString() : undefined,
      co_tu_y_nghi: isManualAbsence
    }, recordBranch);
    res.status(201).json({ request: record });

    // Phat tin hieu realtime toi tat ca cac client dang mo
    broadcastLeaveEvent(LEAVE_EVENT_TYPES.CREATED, record, record.co_so || recordBranch);

    notifyOtherManagers(req.user.id, record.co_so || recordBranch, {
      type: 'leave_request_created',
      title: 'Có nhân sự nghỉ phép mới',
      message: `${record.ho_ten} vừa ${isManualAbsence ? 'được ghi nhận tự ý nghỉ' : 'gửi yêu cầu nghỉ phép'} từ ${record.thoi_gian_bat_dau} đến ${record.thoi_gian_ket_thuc}.`,
      relatedType: 'leaveRequest',
      relatedId: record.id
    });
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
    // Don co the thuoc bat ky co so nao tai khoan duoc xem (danh sach co the dang
    // o "Tat ca co so"), nen tim theo tat ca chu khong chi co so dang chon.
    const updated = await repo.updateLeaveRequestStatus(
      req.params.id, { status, approver, approverUserId: req.user && req.user.id, note }, allowedBranches(req.user)
    );
    const requestBranch = updated.co_so || physicalBranchOrNull(req.branch);
    res.status(200).json({ request: updated });

    // Phat tin hieu realtime toi tat ca cac client dang mo
    broadcastLeaveEvent(LEAVE_EVENT_TYPES.STATUS_CHANGED, updated, requestBranch);

    notifyOtherManagers(req.user.id, requestBranch, {
      type: 'leave_request_decision',
      title: 'Đơn nghỉ phép đã được cập nhật',
      message: `Đơn nghỉ phép của ${updated.ho_ten} đã chuyển sang trạng thái "${status}".`,
      relatedType: 'leaveRequest',
      relatedId: updated.id
    });

    // Bao chinh nhan su xin nghi (neu don gan voi 1 tai khoan web) - best-effort.
    if (updated.web_username) {
      localUserStore.getUserByUsername(updated.web_username)
        .then(employee => {
          if (!employee) return;
          return notificationRepo.createNotification({
            recipientUserId: employee.id,
            type: 'leave_request_decision',
            title: 'Đơn nghỉ phép của bạn đã được cập nhật',
            message: `Đơn nghỉ phép của bạn đã được ${status}${note ? ` (${note})` : ''}.`,
            relatedType: 'leaveRequest',
            relatedId: updated.id
          });
        })
        .catch(notifyErr => console.error('Lỗi báo thông báo nghỉ phép cho nhân viên:', notifyErr.message));
    }
  } catch (err) {
    handleError(res, err, 'PATCH /api/hr/leave-requests/:id/status');
  }
});

// ---------------------------------------------------------------------------
// POST /api/hr/telegram/link-code — tu sinh ma lien ket cho chinh minh
// ---------------------------------------------------------------------------

router.post('/api/hr/telegram/link-code', ...authInternal, (_req, res) => {
  res.status(410).json({
    error: 'Luồng liên kết Telegram qua Google Sheets đã tạm ngừng. Bot sẽ liên kết trực tiếp qua tài khoản trong Postgres.',
    code: 'TELEGRAM_SHEET_LINK_DISABLED'
  });
});

// ---------------------------------------------------------------------------
// POST /api/hr/telegram/link-code/assign — Quan ly sinh ma ho nhan vien khac
// ---------------------------------------------------------------------------

router.post('/api/hr/telegram/link-code/assign', ...authManager, (_req, res) => {
  res.status(410).json({
    error: 'Luồng liên kết Telegram qua Google Sheets đã tạm ngừng. Bot sẽ liên kết trực tiếp qua tài khoản trong Postgres.',
    code: 'TELEGRAM_SHEET_LINK_DISABLED'
  });
});

// ---------------------------------------------------------------------------
// GET /api/hr/employees — danh sach nhan su (ten, bo phan, co so, sdt, email)
// cua moi co so tai khoan duoc xem; trang loc theo co so/phong ban phia client.
// ---------------------------------------------------------------------------

router.get('/api/hr/employees', ...authEmployees, async (req, res) => {
  try {
    const branches = allowedBranches(req.user);
    const snapshot = await employeeDirectory.getSnapshot();
    const employees = snapshot.employees
      .filter(employee => branches.includes(employee.sourceBranch))
      .map(employee => ({
        hoTen: employee.hoTen,
        boPhan: employee.boPhan,
        coSo: employee.sourceBranch,
        soDienThoai: employee.soDienThoai,
        email: employee.email
      }))
      .sort((a, b) => a.hoTen.localeCompare(b.hoTen, 'vi'));
    res.status(200).json({ employees, stale: !!snapshot.stale });
  } catch (err) {
    handleError(res, err, 'GET /api/hr/employees');
  }
});

// ---------------------------------------------------------------------------
// GET /api/hr/employees/export — xuat Excel Danh sach nhan su dang tim kiem
// ---------------------------------------------------------------------------
// Dat TRUOC route /:id neu sau nay them (hien tai chua co, nhung giu quy uoc).

router.get('/api/hr/employees/export', ...authEmployees, async (req, res) => {
  try {
    const { keyword, department, branch } = req.query || {};
    const { buffer, fileName, mime } = await buildEmployeeDirectoryWorkbook(
      { keyword, department },
      resolveBranchScope(req, branch)
    );
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    handleError(res, err, 'GET /api/hr/employees/export');
  }
});

// ---------------------------------------------------------------------------
// GET /api/hr/telegram/link-status — da lien ket Telegram hay chua
// ---------------------------------------------------------------------------

router.get('/api/hr/telegram/link-status', ...authInternal, (req, res) => {
  res.status(200).json({
    linked: !!String(req.user.telegramId || '').trim(),
    telegramId: req.user.telegramId || '',
    source: 'postgres'
  });
});

module.exports = router;
