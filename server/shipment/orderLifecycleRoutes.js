// ==========================================
// ORDER LIFECYCLE ROUTES — /api/shipment/lifecycle/* : tra cuu "Vong doi don
// hang" (spreadsheet RIENG, doc-only). Router RIENG (khong gop vao
// shipmentOrderRoutes.js) vi mo hinh quyen khac han: lookup mo cho moi tai
// khoan (ke ca Khach) qua quyen 'shipment.lookup'; bulk-list yeu cau quyen
// 'shipment.lifecycle' (mac dinh: moi vai tro noi bo).
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

const { requireAuth, requireFeature } = require('../auth/authMiddleware');
const { LIFECYCLE_BRANCH } = require('./orderLifecycleRepository');
const service = require('./orderLifecycleService');
const { createLifecycleExportFile } = require('./orderLifecycleExport');

// Phan quyen theo TINH NANG (server/auth/featureRegistry.js), khong con theo
// mang vai tro — cung mot nguon su that voi menu phia client.
//   shipment.lookup    — tra cuu 1 don (mac dinh: moi tai khoan, ke ca Khach)
//   shipment.lifecycle — xem toan bo don (mac dinh: moi vai tro noi bo)
//   shipment.history   — lich su cap nhat
//   shipment.export    — xuat Excel
//   shipment.override  — ghi de trang thai thu cong (mac dinh: Quan ly, Ke toan)
const authLookup = [requireAuth, requireFeature('shipment.lookup')];
const authBulk = [requireAuth, requireFeature('shipment.lifecycle')];
const authHistory = [requireAuth, requireFeature('shipment.history')];
const authExport = [requireAuth, requireFeature('shipment.export')];
const authOverride = [requireAuth, requireFeature('shipment.override')];

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
// GET /api/shipment/lifecycle/history — toan bo lich su ghi de trang thai (tab
// "Lich su cap nhat" tren Google Sheet, nay hien thi tren web). Cung quyen voi
// GET '/' (5 vai tro noi bo). PHAI dat TRUOC GET '/:orderCode' o duoi, neu
// khong Express se hieu "history" la 1 ma don hang (khop truoc theo thu tu
// dang ky) va route nay se khong bao gio duoc goi toi.
// ---------------------------------------------------------------------------

router.get('/history', ...authHistory, async (req, res) => {
  try {
    const history = await service.listHistory();
    res.status(200).json({ history });
  } catch (err) {
    handleError(res, err, 'GET /api/shipment/lifecycle/history');
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

// ---------------------------------------------------------------------------
// POST /api/shipment/lifecycle/:orderCode/override — ghi de trang thai thu
// cong (chi Quan ly/Ke toan). Ghi 1 dong vao tab "Lich su cap nhat" va tra ve
// trang thai hieu luc moi nhat cua don.
// ---------------------------------------------------------------------------

router.post('/:orderCode/override', ...authOverride, async (req, res) => {
  try {
    const { status, note } = req.body || {};
    if (!status) {
      return res.status(400).json({ error: 'Thiếu trường "status".', code: 'INVALID_REQUEST' });
    }
    const changedBy = (req.user && (req.user.hoTen || req.user.username)) || 'unknown';
    const changedByRole = (req.user && req.user.vaiTro) || '';
    const result = await service.overrideStatus(req.params.orderCode, {
      code: status, changedBy, changedByRole, note
    });
    res.status(200).json({ order: result });
  } catch (err) {
    handleError(res, err, 'POST /api/shipment/lifecycle/:orderCode/override');
  }
});

// ---------------------------------------------------------------------------
// POST /api/shipment/lifecycle/lookup — tra cuu NHIEU ma don cung luc (dung
// cho khu vuc moi o tab "Tong quan"). Cung quyen voi GET /:orderCode.
// ---------------------------------------------------------------------------

router.post('/lookup', ...authLookup, async (req, res) => {
  try {
    const results = await service.findOrdersBulk(req.body.codes);
    res.status(200).json({ results });
  } catch (err) {
    handleError(res, err, 'POST /api/shipment/lifecycle/lookup');
  }
});

// ---------------------------------------------------------------------------
// POST /api/shipment/lifecycle/export — xuat Excel bang "Toan bo don hang"
// (chi 5 vai tro noi bo, cung quyen voi GET '/'). Body { codes: string[] }
// tuy chon — danh sach + thu tu ma dang hien tren UI sau khi loc/sap xep;
// khong truyen -> xuat toan bo theo thu tu trong sheet.
// ---------------------------------------------------------------------------

router.post('/export', ...authExport, async (req, res) => {
  try {
    const codes = Array.isArray(req.body.codes) ? req.body.codes : undefined;
    const orders = await service.exportOrdersByCodes(codes);
    const file = await createLifecycleExportFile(orders);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('Content-Length', file.buffer.length);
    res.status(200).send(file.buffer);
  } catch (err) {
    handleError(res, err, 'POST /api/shipment/lifecycle/export');
  }
});

module.exports = router;
