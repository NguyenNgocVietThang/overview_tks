'use strict';

const express = require('express');
const { requireAuth, requireRole } = require('../auth/authMiddleware');
const { branchLabelToCode } = require('../branch/branches');
const branchMiddleware = require('../branch/branchMiddleware');
const { ROLES } = require('../auth/userRepository');
const repository = require('./debtCollectionStatusRepository');
const dashboardData = require('./dashboardData');

const router = express.Router();
const WORKFLOW_STATUSES = Object.freeze(['Chưa xử lý', 'Đang xử lý', 'Đã xử lý', 'Bỏ qua']);
const WORKFLOW_STATUS_SET = new Set(WORKFLOW_STATUSES);
const HEX_64 = /^[0-9a-f]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validationError(message, code) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

function validatePayload(body) {
  const customerKey = String(body?.customerKey || '').trim().toLowerCase();
  const status = String(body?.status || '').trim();
  const alertSignature = String(body?.alertSignature || '').trim().toLowerCase();
  if (!HEX_64.test(customerKey)) {
    throw validationError('Khóa khách hàng không hợp lệ.', 'INVALID_CUSTOMER_KEY');
  }
  if (!WORKFLOW_STATUS_SET.has(status)) {
    throw validationError('Trạng thái xử lý không hợp lệ.', 'INVALID_DEBT_STATUS');
  }
  if (!HEX_64.test(alertSignature)) {
    throw validationError('Chữ ký cảnh báo không hợp lệ.', 'INVALID_ALERT_SIGNATURE');
  }
  return { customerKey, status, alertSignature };
}

router.patch(
  '/api/debt-management/status',
  requireAuth,
  requireRole(ROLES.QUAN_LY, ROLES.TRO_LY),
  branchMiddleware.resolveBranch,
  async (req, res) => {
    let payload;
    try {
      payload = validatePayload(req.body);
    } catch (error) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }

    const branch = branchLabelToCode(req.branch);
    if (!branch) {
      return res.status(400).json({ error: 'Cơ sở không hợp lệ.', code: 'INVALID_BRANCH' });
    }

    try {
      const userId = UUID.test(String(req.user?.id || '')) ? req.user.id : null;
      const row = await repository.upsertStatus({
        branch,
        ...payload,
        userId,
        userName: req.user?.hoTen || req.user?.username || ''
      });
      dashboardData.invalidateDebtWorkflowCache(req.branch);
      return res.status(200).json({
        customerKey: row.customer_key || row.customerKey,
        status: row.status,
        alertSignature: row.alert_signature || row.alertSignature,
        updatedBy: row.updated_by_name || row.updatedBy || '',
        updatedAt: row.updated_at || row.updatedAt || null
      });
    } catch (error) {
      console.error('[DebtManagement] Không thể cập nhật trạng thái:', error.message);
      return res.status(503).json({
        error: 'Không thể cập nhật trạng thái xử lý lúc này.',
        code: 'DEBT_STATUS_UNAVAILABLE'
      });
    }
  }
);

module.exports = router;
module.exports.WORKFLOW_STATUSES = WORKFLOW_STATUSES;
module.exports.validatePayload = validatePayload;
