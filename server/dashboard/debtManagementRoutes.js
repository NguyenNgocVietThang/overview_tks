'use strict';

const express = require('express');
const { requireAuth, requireFeature } = require('../auth/authMiddleware');
const { BRANCH_BOTH, branchLabelToCode, resolveBranchScope } = require('../branch/branches');
const branchMiddleware = require('../branch/branchMiddleware');
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

function statusResponse(row) {
  const stored = row || {};
  return {
    customerKey: stored.customer_key || stored.customerKey,
    status: stored.status,
    alertSignature: stored.alert_signature || stored.alertSignature,
    updatedBy: stored.updated_by_name || stored.updatedBy || '',
    updatedAt: stored.updated_at || stored.updatedAt || null
  };
}

router.patch(
  '/api/debt-management/status',
  requireAuth,
  requireFeature('reports.debt.edit'),
  branchMiddleware.resolveBranch,
  async (req, res) => {
    let payload;
    try {
      payload = validatePayload(req.body);
    } catch (error) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }

    const isBothBranches = req.branch === BRANCH_BOTH;
    const branch = isBothBranches ? '' : branchLabelToCode(req.branch);
    if (!isBothBranches && !branch) {
      return res.status(400).json({ error: 'Cơ sở không hợp lệ.', code: 'INVALID_BRANCH' });
    }

    try {
      const userId = UUID.test(String(req.user?.id || '')) ? req.user.id : null;
      const writePayload = {
        ...payload,
        userId,
        userName: req.user?.hoTen || req.user?.username || ''
      };

      // "Cả hai": dong khach hang tren man hinh la dong DA GOP cua 2 co so, nen
      // trang thai phai ap cho ca 2 dong nguon trong MOT transaction — khong
      // duoc de HN da doi con SG thi chua.
      if (isBothBranches) {
        const scope = resolveBranchScope(req.branch);
        const { found, undetermined } = await dashboardData.findDebtCustomerBranches(payload.customerKey, scope);
        const signatureByBranch = new Map(found.map(item => [item.branch, item.alertSignature]));
        // Co so khong doc duoc nguon van duoc ghi: tha ghi thua mot dong vo
        // hai (dong trang thai chi hien khi khop customer_key luc doc) con hon
        // am tham bo sot mot co so, lam 2 co so lech trang thai.
        const targets = scope.filter(item => signatureByBranch.has(item) || undetermined.includes(item));
        if (!targets.length) {
          return res.status(404).json({
            error: 'Không tìm thấy khách hàng này trong công nợ của cơ sở nào.',
            code: 'DEBT_CUSTOMER_NOT_FOUND'
          });
        }
        // Dong GOP tren man hinh mang chu ky cua co so DAU TIEN co khach nay,
        // nen chu ky client gui len phai trung chu ky do. Neu khong trung thi
        // man hinh da cu: giu nguyen chu ky client cho moi co so de trang thai
        // ket thuc tu het hieu luc o lan doc sau — dung nhu duong mot co so.
        const mergedSignature = scope.map(item => signatureByBranch.get(item)).find(Boolean);
        const clientViewIsCurrent = mergedSignature === payload.alertSignature;
        const rows = await repository.upsertStatusForBranches({
          targets: targets.map(item => ({
            branch: branchLabelToCode(item),
            // Moi co so ghi chu ky cua CHINH NO; co so khong doc duoc nguon
            // (khong co chu ky) dung tam chu ky client gui len.
            alertSignature: clientViewIsCurrent
              ? (signatureByBranch.get(item) || payload.alertSignature)
              : payload.alertSignature
          })),
          ...writePayload
        });
        // CHI xoa cache sau khi COMMIT. Khoa cache ket qua "Cả hai" chua phien
        // ban debt workflow cua CA HAI co so vat ly (dashboardSourceVersion),
        // nen xoa theo tung co so vat ly la du de ban tong hop cung tuoi lai.
        targets.forEach(item => dashboardData.invalidateDebtWorkflowCache(item));
        // Cac dong chi khac nhau o cot branch — lay dong dau lam phan hoi, kem
        // danh sach co so da ghi (truong THEM, phan hoi mot co so giu nguyen).
        return res.status(200).json({ ...statusResponse(rows[0]), branches: targets });
      }

      const row = await repository.upsertStatus({ branch, ...writePayload });
      dashboardData.invalidateDebtWorkflowCache(req.branch);
      return res.status(200).json(statusResponse(row));
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
