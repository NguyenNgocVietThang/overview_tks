// ==========================================
// ORDER LIFECYCLE ROUTES — /api/shipment/lifecycle/* : tra cuu "Vong doi don
// hang" (spreadsheet RIENG, doc-only). Router RIENG (khong gop vao
// shipmentOrderRoutes.js) vi mo hinh quyen khac han: Khach duoc dung lookup,
// 5 vai tro noi bo duoc ca lookup + bulk-list.
//
// Mount trong server/routes.js TRUOC gate '/api/shipment' chung (giong cach
// POST /api/shipment/invoice-status duoc dac cach cho Khach):
//   router.use('/api/shipment/lifecycle', requireAuth, orderLifecycleRoutes);
//   router.use('/api/shipment', requireAuth, resolveBranch);
//
// KHONG can resolveBranch: nguon du lieu la 1 spreadsheet DUY NHAT (2 tab),
// khong doc theo co so dang dang nhap nhu cac module con lai.
// ==========================================
'use strict';

const express = require('express');
const router = express.Router();

const { requireAuth, requireRole } = require('../auth/authMiddleware');
const { ROLES } = require('../auth/userRepository');
const { LIFECYCLE_BRANCH } = require('./orderLifecycleRepository');
const service = require('./orderLifecycleService');

// Tra cuu 1 don: Khach (xem don cua minh) + 5 vai tro noi bo lien quan truc
// tiep den luong don to/xe cong ty.
const ORDER_LOOKUP_ROLES = [
  ROLES.KHACH, ROLES.KE_TOAN, ROLES.TRUONG_KHO, ROLES.QUAN_LY, ROLES.TRO_LY, ROLES.NHAN_VIEN_SALE
];
// Xem toan bo don (nhu mo ca bang Google Sheet): CHI 5 vai tro noi bo, Khach
// khong duoc dung.
const ORDER_LIFECYCLE_BULK_ROLES = [
  ROLES.KE_TOAN, ROLES.TRUONG_KHO, ROLES.QUAN_LY, ROLES.TRO_LY, ROLES.NHAN_VIEN_SALE
];

const authLookup = [requireAuth, requireRole(...ORDER_LOOKUP_ROLES)];
const authBulk = [requireAuth, requireRole(...ORDER_LIFECYCLE_BULK_ROLES)];

function handleError(res, err, context) {
  if (err.statusCode && err.statusCode < 500) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }
  if (err.code === 'BRANCH_NOT_CONFIGURED') {
    console.warn(`[${context}] ${err.detail || err.message}`);
    return res.status(err.statusCode || 503).json({ error: err.message, code: err.code });
  }
  console.error(`=== LOI ${context} ===`);
  console.error(err.stack);
  console.error(`${'='.repeat(context.length + 10)}`);
  return res.status(500).json({ error: 'Lỗi hệ thống, vui lòng thử lại sau.', code: err.code });
}

// ---------------------------------------------------------------------------
// GET /api/shipment/lifecycle — toan bo don tu ca 2 tab (chi 5 vai tro noi bo)
//
// Duong dan RELATIVE ('/' khong phai '/api/shipment/lifecycle') vi router nay
// duoc mount tai prefix '/api/shipment/lifecycle' (server/routes.js) — Express
// STRIP prefix khoi req.url truoc khi chuyen cho sub-router, nen dinh nghia
// duong dan tuyet doi o day se KHONG BAO GIO khop (404).
// ---------------------------------------------------------------------------

router.get('/', ...authBulk, async (req, res) => {
  try {
    const { branch } = req.query;
    if (branch && branch !== LIFECYCLE_BRANCH.HN && branch !== LIFECYCLE_BRANCH.SG) {
      return res.status(400).json({
        error: `Tham số "branch" phải là "${LIFECYCLE_BRANCH.HN}" hoặc "${LIFECYCLE_BRANCH.SG}".`,
        code: 'INVALID_BRANCH'
      });
    }
    const orders = await service.listAllOrders(branch || undefined);
    res.status(200).json({ orders });
  } catch (err) {
    handleError(res, err, 'GET /api/shipment/lifecycle');
  }
});

// ---------------------------------------------------------------------------
// GET /api/shipment/lifecycle/:orderCode — tra cuu 1 don (Khach + noi bo)
// ---------------------------------------------------------------------------

router.get('/:orderCode', ...authLookup, async (req, res) => {
  try {
    const result = await service.findOrder(req.params.orderCode);
    res.status(200).json(result);
  } catch (err) {
    handleError(res, err, 'GET /api/shipment/lifecycle/:orderCode');
  }
});

module.exports = router;
