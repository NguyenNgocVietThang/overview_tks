'use strict';

// /api/shipment/pick/* — Chi dinh vi tri hang cho don (trang Vong doi don hang). Quyen: shipment.pick (mac dinh chi Quan ly).
// Mount trong server/routes.js TRUOC cong '/api/shipment' chung, ngay canh '/api/shipment/lifecycle'. Khong dung resolveBranch:
// trang Vong doi hien ca 2 co so bat ke cookie tks_branch, co so cua don lay tu tham so `branch` (HN|SG).
const express = require('express');
const { requireAuth, requireFeature } = require('../auth/authMiddleware');
const service = require('./pickAssignmentsService');

function createPickAssignmentsRouter(dependencies = {}) {
  const router = express.Router();
  const svc = () => dependencies.service || service;

  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); },
    dependencies.requireAuth || requireAuth,
    requireFeature('shipment.pick'));

  const ctxOf = req => ({ user: req.user });
  const handle = fn => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error && error.statusCode && error.statusCode < 500) {
        const body = { error: error.message, code: error.code };
        if (error.latest) body.latest = error.latest;
        if (error.field) body.field = error.field;
        return res.status(error.statusCode).json(body);
      }
      console.error('[pick-assignments]', error);
      return res.status(500).json({ error: 'Lỗi máy chủ khi xử lý chỉ định vị trí.', code: 'PICK_ASSIGNMENTS_FAILED' });
    }
  };
  const query = req => ({ branch: req.query.branch, orderCode: req.query.order });

  router.get('/candidates', handle(async (req, res) => {
    res.json(await svc().candidates(ctxOf(req), query(req)));
  }));
  router.get('/', handle(async (req, res) => {
    res.json(await svc().get(ctxOf(req), query(req)));
  }));
  router.post('/', handle(async (req, res) => {
    res.status(201).json(await svc().assign(ctxOf(req), req.body || {}));
  }));
  router.post('/:id/confirm', handle(async (req, res) => {
    res.json(await svc().confirm(ctxOf(req), Number(req.params.id), req.body || {}));
  }));
  router.post('/:id/cancel', handle(async (req, res) => {
    res.json(await svc().cancel(ctxOf(req), Number(req.params.id), req.body || {}));
  }));
  return router;
}

module.exports = createPickAssignmentsRouter();
module.exports.createPickAssignmentsRouter = createPickAssignmentsRouter;
