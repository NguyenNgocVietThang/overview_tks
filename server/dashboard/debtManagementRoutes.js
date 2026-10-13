'use strict';

// API ghi cua tab Cong no (2026-10-13, cong no theo lich TT — server/debtSchedule).
// Moi cot sua duoc co quyen rieng (featureRegistry):
//   Sale phan hoi  -> reports.debt.saleFeedback   (mac dinh Nhan vien sale)
//   QL phan hoi    -> reports.debt.managerFeedback (mac dinh Quan ly)
//   Trang thai     -> reports.debt.edit            (mac dinh Quan ly)
//   Lich TT        -> reports.debt.schedule        (mac dinh Quan ly)
//   Tien phat      -> reports.debt.penalty         (mac dinh Quan ly)
// Phan hoi/trang thai chi ghi vao chu ky hien tai (ban chot 15:00 moi nhat); client gui kem
// cycleDate dang xem, lech thi tra 409 de nguoi dung tai lai.

const express = require('express');
const { requireAuth, requireFeature } = require('../auth/authMiddleware');
const { BRANCH_BOTH, branchLabelToCode, resolveBranchScope } = require('../branch/branches');
const branchMiddleware = require('../branch/branchMiddleware');
const debtScheduleRepository = require('../debtSchedule/debtScheduleRepository');
const { WORKFLOW_STATUSES } = require('../debtSchedule/debtScheduleRules');

const CYCLE_DATE = /^\d{4}-\d{2}-\d{2}$/;

function repository() {
  return debtScheduleRepository.getDebtScheduleRepository();
}

function readTarget(body) {
  const cycleDate = String(body?.cycleDate || '').trim();
  return {
    branch: String(body?.branch || '').trim(),
    customerId: String(body?.customerId || '').trim(),
    cycleDate: CYCLE_DATE.test(cycleDate) ? cycleDate : undefined
  };
}

function sendError(res, error, fallbackMessage, fallbackCode) {
  if (error && error.statusCode && error.statusCode < 500) {
    return res.status(error.statusCode).json({ error: error.message, code: error.code });
  }
  console.error(`[DebtManagement] ${fallbackMessage}:`, error && error.message);
  return res.status(503).json({ error: fallbackMessage, code: fallbackCode });
}

function branchCodesFor(req) {
  return resolveBranchScope(req.branch || BRANCH_BOTH).map(branchLabelToCode).filter(Boolean);
}

const router = express.Router();

function feedbackRoute(path, field, feature) {
  router.patch(path, requireAuth, requireFeature(feature), async (req, res) => {
    try {
      const result = await repository().saveFeedback({
        ...readTarget(req.body), field, value: req.body?.value, user: req.user
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error, 'Không thể lưu phản hồi lúc này.', 'DEBT_FEEDBACK_UNAVAILABLE');
    }
  });
}

feedbackRoute('/api/debt-management/sale-feedback', 'sale', 'reports.debt.saleFeedback');
feedbackRoute('/api/debt-management/manager-feedback', 'manager', 'reports.debt.managerFeedback');

router.patch('/api/debt-management/status', requireAuth, requireFeature('reports.debt.edit'), async (req, res) => {
  const status = String(req.body?.status || '').trim();
  if (!WORKFLOW_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Trạng thái xử lý không hợp lệ.', code: 'INVALID_DEBT_STATUS' });
  }
  try {
    const result = await repository().saveStatus({ ...readTarget(req.body), status, user: req.user });
    return res.status(200).json(result);
  } catch (error) {
    return sendError(res, error, 'Không thể cập nhật trạng thái xử lý lúc này.', 'DEBT_STATUS_UNAVAILABLE');
  }
});

router.patch('/api/debt-management/schedule', requireAuth, requireFeature('reports.debt.schedule'), async (req, res) => {
  try {
    const { branch, customerId } = readTarget(req.body);
    const result = await repository().setSchedule({ branch, customerId, days: req.body?.scheduleDays, user: req.user });
    return res.status(200).json(result);
  } catch (error) {
    return sendError(res, error, 'Không thể lưu lịch thanh toán lúc này.', 'DEBT_SCHEDULE_UNAVAILABLE');
  }
});

// Tien phat phien nay: Quan ly (hoac nguoi duoc phan quyen) ghi de muc phat goi y; rong = ve goi y.
router.patch('/api/debt-management/penalty', requireAuth, requireFeature('reports.debt.penalty'), async (req, res) => {
  try {
    const result = await repository().savePenalty({ ...readTarget(req.body), amount: req.body?.amount, user: req.user });
    return res.status(200).json(result);
  } catch (error) {
    return sendError(res, error, 'Không thể lưu tiền phạt lúc này.', 'DEBT_PENALTY_UNAVAILABLE');
  }
});

// Lich su sua Sale phan hoi / QL phan hoi cua chu ky hien tai (reset cung ban chot 15:00).
router.get('/api/debt-management/feedback-history', requireAuth, requireFeature('reports.debt'),
  branchMiddleware.resolveBranch, async (req, res) => {
    try {
      return res.json(await repository().listFeedbackHistory({ branches: branchCodesFor(req) }));
    } catch (error) {
      return sendError(res, error, 'Không thể tải lịch sử chỉnh sửa lúc này.', 'DEBT_HISTORY_UNAVAILABLE');
    }
  });

// Nhat ky sua lich TT (giu vinh vien). Co branch + customerId thi loc theo 1 khach.
router.get('/api/debt-management/schedule-log', requireAuth, requireFeature('reports.debt'), async (req, res) => {
  try {
    const branch = String(req.query.branch || '').trim();
    const customerId = String(req.query.customerId || '').trim();
    const entries = await repository().listScheduleLog(branch && customerId ? { branch, customerId } : {});
    return res.json({ entries });
  } catch (error) {
    return sendError(res, error, 'Không thể tải nhật ký lịch thanh toán lúc này.', 'DEBT_SCHEDULE_LOG_UNAVAILABLE');
  }
});

module.exports = router;
module.exports.WORKFLOW_STATUSES = WORKFLOW_STATUSES;
