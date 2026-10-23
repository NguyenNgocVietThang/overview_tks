'use strict';

// API "Kiem tra gia ban" (tab Hoa don): /api/invoice-price-audit. Cache-Control: no-store.
//   GET   /                                      bao cao theo bo loc (+ pham vi co so tu cookie tks_branch)
//   PATCH /:branch/:invoiceId/:lineNo/explanation  { text, expectedVersion }
//   PATCH /:branch/:invoiceId/:lineNo/decision     { decision, expectedVersion } (+ query = bo loc dang dung de tra KPI moi)
//   GET   /export/sales/fields, /export/sales    xuat bang tong hop tien phat theo sale (muc 1), cung quyen xuat
//   GET   /export/fields, /export              xuat Excel/HTML (can them reports.export), TOAN BO tap loc, cot theo catalog
// Moi request di qua requireAuth (giai lai quyen) + requireFeature(xem); quyen giai thich / Chot kiem tra o service.

const express = require('express');
const authMiddleware = require('../auth/authMiddleware');
const branchMiddleware = require('../branch/branchMiddleware');
const { BRANCH_BOTH, branchLabelToCode, resolveBranchScope } = require('../branch/branches');
const { FEATURE_VIEW } = require('./priceAuditAccess');
const { getPriceAuditService, validateQuery } = require('./priceAuditService');
const { getPriceAuditRepository, httpError } = require('./priceAuditRepository');
const { createPriceAuditExport, resolveColumnKeys, exportFieldsFor, MAX_EXPORT_ROWS,
  resolveSaleColumnKeys, saleExportFields, createSaleSummaryExport } = require('./priceAuditExport');
const fuzzy = require('../shared/fuzzySearch');

const ROW_PATH = '/:branch/:invoiceId/:lineNo';

function branchScopeFor(req) {
  return resolveBranchScope(req.branch || BRANCH_BOTH).map(branchLabelToCode).filter(Boolean);
}

function createPriceAuditRouter({
  service = null,
  repository = null,
  requireAuth = authMiddleware.requireAuth,
  resolveBranch = branchMiddleware.resolveBranch
} = {}) {
  const svc = () => service || getPriceAuditService();
  const repo = () => repository || getPriceAuditRepository();
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

  // Xuat file: cung bo loc / thu tu voi bang, bo phan trang (doc toan bo tap loc qua repository.readReport).
  const exportGuard = [...guard, authMiddleware.requireFeature('reports.export'), resolveBranch];
  async function loadForExport(req, limit) {
    const state = await repo().readState();
    if (!state || !state.published_day) throw httpError(400, 'Chưa chạy kiểm tra giá — chưa có dữ liệu để xuất.', 'NOT_PUBLISHED');
    const query = validateQuery({ ...req.query, page: undefined, pageSize: undefined },
      { branchScope: branchScopeFor(req), windowFrom: state.window_from, windowTo: state.window_to });
    const report = await repo().readReport({ ...query, page: 1, pageSize: limit }, req.user);
    return { query, report };
  }

  router.get('/export/fields', ...exportGuard, handle('Không lấy được danh sách trường xuất.', async (req, res) => {
    const { report } = await loadForExport(req, 1);
    res.json(exportFieldsFor(report.totalRows));
  }));

  router.get('/export', ...exportGuard, handle('Không xuất được bảng Kiểm tra giá bán.', async (req, res) => {
    const columns = resolveColumnKeys(req.query.columns);
    const { query, report } = await loadForExport(req, MAX_EXPORT_ROWS + 1);
    const { page, pageSize, ...filters } = query; // eslint-disable-line no-unused-vars
    const file = await createPriceAuditExport({
      rows: report.rows, columns, format: String(req.query.format || 'xlsx'),
      meta: { ...report.meta, kpis: report.kpis, filters }
    });
    res.set('Content-Type', file.mimeType);
    res.set('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.send(file.buffer);
  }));

  // Bang tong hop tien phat theo sale (muc 1): cung bo loc voi bang chi tiet; saleSearch = o tim kiem cua bang tong hop
  // (loc theo ten sale, de file khop dung cac dong dang hien thi).
  async function loadSaleSummary(req) {
    const { query, report } = await loadForExport(req, 1);
    const search = typeof req.query.saleSearch === 'string' ? req.query.saleSearch.trim().slice(0, 200) : '';
    const matcher = search ? fuzzy.createMatcher(search) : null;
    const rows = matcher && !matcher.empty
      ? (report.saleSummary || []).filter(r => matcher.score(fuzzy.fold(r.saleName || '')) > 0)
      : (report.saleSummary || []);
    return { query, report, rows, search };
  }

  router.get('/export/sales/fields', ...exportGuard, handle('Không lấy được danh sách trường xuất.', async (req, res) => {
    const { rows } = await loadSaleSummary(req);
    res.json(saleExportFields(rows.length));
  }));

  router.get('/export/sales', ...exportGuard, handle('Không xuất được bảng tiền phạt theo sale.', async (req, res) => {
    const columns = resolveSaleColumnKeys(req.query.columns);
    const { query, report, rows, search } = await loadSaleSummary(req);
    const { page, pageSize, ...filters } = query; // eslint-disable-line no-unused-vars
    const file = await createSaleSummaryExport({
      rows, columns, search, format: String(req.query.format || 'xlsx'), meta: { ...report.meta, filters }
    });
    res.set('Content-Type', file.mimeType);
    res.set('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.send(file.buffer);
  }));

  return router;
}

module.exports = { createPriceAuditRouter };
