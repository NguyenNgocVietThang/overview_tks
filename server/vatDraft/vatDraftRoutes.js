'use strict';

// /api/vat-draft/* — trang "Kế toán – Nháp VAT". Moi route can quyen accounting.vatDraft
// (mac dinh chi Quan ly + admin cung; Quan ly bat rieng cho tung Ke toan o /account/).

const express = require('express');
const { requireAuth, requireFeature } = require('../auth/authMiddleware');
const { resolveBranch } = require('../branch/branchMiddleware');
const { branchLabelToCode, resolveBranchScope } = require('../branch/branches');
const { createDocumentsRepository } = require('./documentsRepository');
const { createMasterDataSource } = require('./sheetsSource');
const { createVatDraftService } = require('./vatDraftService');
const { createVatDraftWorkbook } = require('./vatDraftExport');
const { parseDocumentCodes } = require('./pasteParser');

function createVatDraftRouter({
  repository = createDocumentsRepository(),
  masterData = createMasterDataSource(),
  service = createVatDraftService({ repository, masterData })
} = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const guard = [requireAuth, requireFeature('accounting.vatDraft')];
  // Bo loc "Cơ sở" tren trang (?branch=hanoi|saigon|all) uu tien hon cookie co so o header.
  const branchCodes = req => {
    const picked = String((req.query && req.query.branch) || '').trim();
    if (picked === 'hanoi' || picked === 'saigon') return [picked];
    if (picked === 'all') return ['hanoi', 'saigon'];
    return resolveBranchScope(req.branch).map(branchLabelToCode);
  };

  function handle(fn) {
    return async (req, res) => {
      try {
        await fn(req, res);
      } catch (error) {
        if (error.statusCode === 400) return res.status(400).json({ error: error.message, code: error.code });
        if (error.statusCode === 503) return res.status(503).json({ error: error.message, code: error.code || 'VAT_DRAFT_SOURCE_UNAVAILABLE' });
        console.error(`[vat-draft ${req.method} ${req.path}]`, error);
        return res.status(500).json({ error: 'Lỗi hệ thống, vui lòng thử lại sau.', code: 'VAT_DRAFT_ERROR' });
      }
    };
  }

  async function masterDataStatus(force) {
    try {
      const snapshot = force ? await masterData.refresh() : await masterData.get();
      return { ...service.masterDataMeta(snapshot), error: null };
    } catch (error) {
      return { loadedAt: null, stale: false, stockRows: 0, mappingRows: 0, invalidStockRows: 0, error: error.message };
    }
  }

  router.get('/meta', ...guard, handle(async (req, res) => {
    const [master, sync] = await Promise.all([masterDataStatus(false), repository.syncStatus().catch(() => [])]);
    res.json({ masterData: master, sync, vietqr: service.accountsMeta() });
  }));

  router.post('/master-data/refresh', ...guard, handle(async (req, res) => {
    res.json({ masterData: await masterDataStatus(true) });
  }));

  router.get('/documents', ...guard, resolveBranch, handle(async (req, res) => {
    const { kind, from, to, q, page, pageSize } = req.query;
    res.json(await repository.listDocuments({ branchCodes: branchCodes(req), kind, from, to, q, page, pageSize }));
  }));

  router.post('/documents/resolve', ...guard, resolveBranch, handle(async (req, res) => {
    const { codes, invalid, truncated } = parseDocumentCodes(req.body && req.body.text);
    const result = await repository.resolveCodes({ branchCodes: branchCodes(req), codes });
    res.json({ ...result, invalid, truncated });
  }));

  router.post('/allocate', ...guard, handle(async (req, res) => {
    res.json(await service.allocate(req.body || {}));
  }));

  router.post('/lookup', ...guard, handle(async (req, res) => {
    res.json(await service.lookup(req.body || {}));
  }));

  router.post('/export', ...guard, handle(async (req, res) => {
    const file = await createVatDraftWorkbook(req.body || {});
    res.set('Content-Type', file.mimeType);
    res.set('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.send(file.buffer);
  }));

  router.post('/qr/url', ...guard, handle(async (req, res) => {
    res.json(service.qrUrl(req.body || {}));
  }));

  router.post('/qr/parse-text', ...guard, handle(async (req, res) => {
    res.json(service.parsePdfText(req.body && req.body.text));
  }));

  return router;
}

module.exports = { createVatDraftRouter };
