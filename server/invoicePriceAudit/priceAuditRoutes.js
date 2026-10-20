'use strict';

// API "Kiem tra gia ban" (tab Hoa don): /api/invoice-price-audit. Cache-Control: no-store.
//   GET   /                                      bao cao theo bo loc (+ pham vi co so tu cookie tks_branch)
//   PATCH /:branch/:invoiceId/:lineNo/explanation  { text, expectedVersion }
//   PATCH /:branch/:invoiceId/:lineNo/decision     { decision, expectedVersion } (+ query = bo loc dang dung de tra KPI moi)
// Xuat file (/export/fields, /export) them o Task 6 — khai bao TRUOC cac route /:branch/... neu co GET trung mau.
// Moi request di qua requireAuth (giai lai quyen) + requireFeature(xem); quyen giai thich / Chot kiem tra o service.

const express = require('express');
const authMiddleware = require('../auth/authMiddleware');
const branchMiddleware = require('../branch/branchMiddleware');
const { BRANCH_BOTH, branchLabelToCode, resolveBranchScope } = require('../branch/branches');
const { FEATURE_VIEW } = require('./priceAuditAccess');
const { getPriceAuditService } = require('./priceAuditService');

const ROW_PATH = '/:branch/:invoiceId/:lineNo';

function branchScopeFor(req) {
  return resolveBranchScope(req.branch || BRANCH_BOTH).map(branchLabelToCode).filter(Boolean);
}

function createPriceAuditRouter({
  service = null,
  requireAuth = authMiddleware.requireAuth,
  resolveBranch = branchMiddleware.resolveBranch
} = {}) {
  const svc = () => service || getPriceAuditService();
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(express.json({ limit: '64kb' }));
  const guard = [requireAuth, authMiddleware.requireFeature(FEATURE_VIEW)];

  const handle = (message, fn) => async (req, res) => {
    try { await fn(req, res); } catch (error) {
      if (error && error.statusCode && error.statusCode < 500) {
        return res.status(error.statusCode).json({
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
          ...(error.row ? { row: error.row } : {})
        });
      }
      // Khong lo chi tiet loi DB cho client.
      console.error(`[invoice-price-audit ${req.method} ${req.path}]`, error && error.message);
      return res.status(503).json({ error: message });
    }
  };

  router.get('/', ...guard, resolveBranch, handle('Không lấy được bảng Kiểm tra giá bán.', async (req, res) => {
    res.json(await svc().getReport(req.query, req.user, { branchScope: branchScopeFor(req) }));
  }));

  router.patch(`${ROW_PATH}/explanation`, ...guard, handle('Không lưu được giải thích.', async (req, res) => {
    res.json(await svc().updateExplanation(req.params, req.body, req.user));
  }));

  router.patch(`${ROW_PATH}/decision`, ...guard, resolveBranch, handle('Không lưu được Chốt.', async (req, res) => {
    res.json(await svc().updateDecision(req.params, req.body, req.user, req.query, { branchScope: branchScopeFor(req) }));
  }));

  return router;
}

module.exports = { createPriceAuditRouter };
