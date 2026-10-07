'use strict';

// API Bao cao kinh doanh (/api/business-report): tang truong Sale / Khach / Ma hang theo
// thang, gop HN + SG (khong theo co so dang chon nen khong dung reportsUser/resolveBranch).

const express = require('express');
const { requireAuth, requireFeature } = require('../auth/authMiddleware');
const { createRepository } = require('./businessReportRepository');
const svc = require('./businessReportService');
const { createExportFile, filterRows } = require('./businessReportExport');

const BUILDERS = { sales: svc.buildSaleReport, customers: svc.buildCustomerReport, products: svc.buildProductReport };

function createBusinessReportRouter({ repository = createRepository() } = {}) {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const view = [requireAuth, requireFeature('reports.business')];
  const handle = fn => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e.statusCode && e.statusCode < 500) return res.status(e.statusCode).json({ error: e.message, code: e.code });
      if (/business_monthly_\w+" does not exist/.test(e.message || '')) {
        return res.status(503).json({ error: 'Báo cáo kinh doanh chưa sẵn sàng (chưa áp migration 0036).', code: 'BUSINESS_REPORT_NOT_READY' });
      }
      console.error(`[business-report ${req.method} ${req.path}]`, e);
      return res.status(500).json({ error: 'Lỗi hệ thống, vui lòng thử lại sau.', code: 'BUSINESS_REPORT_ERROR' });
    }
  };

  for (const kind of Object.keys(BUILDERS)) {
    router.get(`/${kind}`, ...view, handle(async (req, res) => res.json(BUILDERS[kind](await repository.snapshot()))));
  }

  router.get('/detail', ...view, handle(async (req, res) => {
    const kind = String(req.query.kind || '');
    const key = String(req.query.key || '');
    const snap = await repository.snapshot();
    // Dung truoc (extra rong) de bao 404/400 som, khong truy van top hang/khach cho key khong ton tai.
    const detail = svc.buildDetail(kind, key, snap, {});
    const months = svc.last4Months(snap);
    if (kind === 'customer') {
      const i = key.indexOf(':');
      detail.topProducts = (await repository.customerProducts({ branch: key.slice(0, i), customerCode: key.slice(i + 1), months })).slice(0, 50);
    } else if (kind === 'product') {
      const names = new Map(snap.directory.map(d => [`${d.branch}:${d.code}`, d.name]));
      detail.topCustomers = (await repository.productCustomers({ productCode: key, months })).slice(0, 50)
        .map(r => ({ ...r, customerName: r.customerCode ? (names.get(`${r.branch}:${r.customerCode}`) || r.customerCode) : 'Khách lẻ' }));
    }
    res.json(detail);
  }));

  router.post('/refreeze', requireAuth, requireFeature('reports.business.refreeze'), express.json(),
    handle(async (req, res) => res.json(await repository.refreeze(req.body && req.body.month))));

  // Can DONG THOI reports.business va reports.export (hai requireFeature rieng = AND).
  router.get('/export', ...view, requireFeature('reports.export'), handle(async (req, res) => {
    const kind = String(req.query.kind || '');
    if (!BUILDERS[kind]) { const e = new Error('Bảng xuất không hợp lệ.'); e.statusCode = 400; throw e; }
    const report = BUILDERS[kind](await repository.snapshot());
    const rows = filterRows(kind, report.rows, req.query);
    const file = await createExportFile(kind, String(req.query.format || 'xlsx'), report, rows);
    res.set('Content-Type', file.mimeType);
    res.set('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.send(file.buffer);
  }));

  return router;
}

module.exports = { createBusinessReportRouter };
