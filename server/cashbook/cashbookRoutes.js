'use strict';
const express = require('express');
const { requireAuth, requireFeature } = require('../auth/authMiddleware');
const { createRepository } = require('./cashbookRepository');
const {
  parseFilters,
  validateCheckpoint,
  invalid,
} = require('./cashbookFilters');
const {
  createExportFile,
  selectedColumns,
  MAX_EXPORT_ROWS,
  tooManyRows,
} = require('./cashbookExport');
function createCashbookRouter({ repository = createRepository() } = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const view = [requireAuth, requireFeature('cashbook.view')],
    manage = [requireAuth, requireFeature('cashbook.manage')];
  function handle(fn) {
    return async (req, res) => {
      try {
        await fn(req, res);
      } catch (e) {
        if (e.statusCode === 400)
          return res.status(400).json({ error: e.message, code: e.code });
        console.error(`[cashbook ${req.method} ${req.path}]`, e);
        return res.status(500).json({
          error: 'Lỗi hệ thống, vui lòng thử lại sau.',
          code: 'CASHBOOK_ERROR',
        });
      }
    };
  }
  router.get(
    '/summary',
    ...view,
    handle(async (req, res) =>
      res.json(await repository.summary(parseFilters(req.query))),
    ),
  );
  router.get(
    '/entries',
    ...view,
    handle(async (req, res) =>
      res.json(await repository.entries(parseFilters(req.query))),
    ),
  );
  router.get(
    '/filter-options',
    ...view,
    handle(async (req, res) => {
      parseFilters(req.query);
      res.json(await repository.filterOptions());
    }),
  );
  router.get(
    '/checkpoints',
    ...view,
    handle(async (req, res) =>
      res.json(await repository.checkpoints(parseFilters(req.query))),
    ),
  );
  router.post(
    '/checkpoints',
    ...manage,
    handle(async (req, res) => {
      validateCheckpoint(req.body);
      const by = req.user.username || String(req.user.id || '');
      if (!by) throw new Error('Thiếu danh tính người chốt.');
      res
        .status(201)
        .json({ checkpoint: await repository.insertCheckpoint(req.body, by) });
    }),
  );
  router.get(
    '/export',
    ...view,
    handle(async (req, res) => {
      const { view: which, format = 'xlsx', columns, ...query } = req.query;
      selectedColumns(which, columns);
      if (!['xlsx', 'html'].includes(format))
        throw invalid('Định dạng xuất không hợp lệ.');
      const f = parseFilters(query);
      let rows;
      if (which === 'balances') rows = (await repository.summary(f)).balances;
      else {
        const r = await repository[which](f, {
          exportLimit: MAX_EXPORT_ROWS + 1,
        });
        if (r.total > MAX_EXPORT_ROWS) throw tooManyRows();
        rows = r[which];
      }
      const file = await createExportFile(which, format, rows, columns);
      res.set('Content-Type', file.mimeType);
      res.set('Content-Disposition', `attachment; filename="${file.fileName}"`);
      res.send(file.buffer);
    }),
  );
  return router;
}
const router = createCashbookRouter();
module.exports = router;
module.exports.createCashbookRouter = createCashbookRouter;
