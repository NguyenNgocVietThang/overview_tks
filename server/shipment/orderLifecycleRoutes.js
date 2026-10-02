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
const { createLifecycleExportFile, MAX_EXPORT_ROWS } = require('./orderLifecycleExport');
// Don cua KiotViet (moi trang thai) gop vao bang "Toan bo don hang" + chi tiet dong hang. Goi qua
// thuoc tinh cua module (khong destructure) de test thay the duoc `kiotOrders.*`.
const kiotRepository = require('./kiotOrdersRepository');

// Phan quyen theo TINH NANG (server/auth/featureRegistry.js), khong con theo
// mang vai tro — cung mot nguon su that voi menu phia client.
//   shipment.lookup    — tra cuu 1 don (mac dinh: moi tai khoan, ke ca Khach)
//   shipment.lifecycle — xem toan bo don (mac dinh: moi vai tro noi bo)
//   shipment.history   — lich su cap nhat
//   shipment.export    — xuat Excel (mac dinh: chi Quan ly)
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
// GET /api/shipment/lifecycle — MOT TRANG cua bang "Toan bo don hang" (don Kiot moi trang thai + moc thoi
// gian tu sheet). Loc/sap xep/cat trang tren may chu vi co ~60 nghin don: query string branch (HN|SG), status
// (trang thai vong doi), kiotStatus, dateField (saleSentAt|at|orderDate), from, to (YYYY-MM-DD), mode
// (code|sale|customer), q, sort, dir (asc|desc), page, pageSize (toi da 200; mac dinh 100). Tham so sai -> 400.
// Tra { orders, page, pageSize, totalPages, total, filteredTotal, kiotStatuses, kiot } — `kiot` bao tinh trang
// nguon Kiot ({ok, stale, fetchedAt, count}) de giao dien hien canh bao khi loi.
//
// Duong dan RELATIVE ('/' khong phai '/api/shipment/lifecycle') vi router nay
// duoc mount tai prefix '/api/shipment/lifecycle' (server/routes.js) — Express
// STRIP prefix khoi req.url truoc khi chuyen cho sub-router, nen dinh nghia
// duong dan tuyet doi o day se KHONG BAO GIO khop (404).
// ---------------------------------------------------------------------------

router.get('/', ...authBulk, async (req, res) => {
  try {
    const result = await service.queryOrders(req.query, { kiot: kiotRepository.kiotOrders });
    res.status(200).json(result);
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
// GET /api/shipment/lifecycle/order-detail?code=&branch=HN|SG — chi tiet dong hang cua 1 don
// theo du lieu KiotViet (kem ton thuc / dang van chuyen / so co ban cua don Phieu tam). Chi vai tro
// xem duoc bang toan bo don (shipment.lifecycle) — KHONG mo cho Khach. PHAI dat TRUOC '/:orderCode'
// (nhu '/history'), neu khong 'order-detail' bi hieu la 1 ma don hang.
// ---------------------------------------------------------------------------

router.get('/order-detail', ...authBulk, async (req, res) => {
  try {
    const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
    const branch = req.query.branch;
    if (!code || code.length > 100) {
      return res.status(400).json({ error: 'Thiếu hoặc sai mã đơn hàng.', code: 'INVALID_CODE' });
    }
    if (branch !== LIFECYCLE_BRANCH.HN && branch !== LIFECYCLE_BRANCH.SG) {
      return res.status(400).json({
        error: `Tham số "branch" phải là "${LIFECYCLE_BRANCH.HN}" hoặc "${LIFECYCLE_BRANCH.SG}".`,
        code: 'INVALID_BRANCH'
      });
    }
    const detail = await kiotRepository.kiotOrders.readOrderDetail({ branch, code });
    res.status(200).json({ detail });
  } catch (err) {
    handleError(res, err, 'GET /api/shipment/lifecycle/order-detail');
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
// POST /api/shipment/lifecycle/export — xuat Excel bang "Toan bo don hang" (quyen 'shipment.export', mac dinh
// chi Quan ly). Body = cung bo tham so loc/sap xep cua GET '/' (khong co page/pageSize — xuat MOI trang): file khop
// dung bang dang hien tren man hinh. Khong gui bo loc nao -> xuat toan bo don (moi dat nhat truoc). Qua MAX_EXPORT_ROWS
// dong -> 400 TOO_MANY_ROWS (dung file lon chan ca may chu vai giay vi chay 1 tien trinh): yeu cau loc bot roi xuat lai.
// ---------------------------------------------------------------------------

router.post('/export', ...authExport, async (req, res) => {
  try {
    const orders = await service.exportOrders(req.body, { kiot: kiotRepository.kiotOrders });
    if (orders.length > MAX_EXPORT_ROWS) {
      return res.status(400).json({
        error: `Có ${orders.length.toLocaleString('vi-VN')} đơn khớp bộ lọc, vượt giới hạn ${MAX_EXPORT_ROWS.toLocaleString('vi-VN')} đơn mỗi lần xuất. Hãy lọc thêm theo cơ sở, trạng thái hoặc khoảng thời gian rồi xuất lại.`,
        code: 'TOO_MANY_ROWS'
      });
    }
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
