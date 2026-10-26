// ==========================================
// USER TABLE PREFS ROUTES — /api/me/table-prefs : cau hinh bang cua chinh tai khoan
// dang dang nhap (khong can quyen rieng). user_id luon lay tu phien (req.user.id).
// ==========================================
'use strict';

const express = require('express');
const { requireAuth } = require('../auth/authMiddleware');
const repo = require('./repository');

function handleError(res, err, context) {
  if (err.statusCode && err.statusCode < 500) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  console.error(`=== LOI ${context} ===`);
  console.error(err.stack);
  return res.status(500).json({ error: 'Lỗi hệ thống, vui lòng thử lại sau.' });
}

function createUserTablePrefsRouter({ getPool = () => require('../db/pool').getPool() } = {}) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    try {
      res.status(200).json({ tables: await repo.listForUser(getPool(), req.user.id) });
    } catch (err) { handleError(res, err, 'GET /api/me/table-prefs'); }
  });

  router.put('/:tableKey/:mode', async (req, res) => {
    try {
      const prefs = await repo.savePrefs(getPool(), req.user.id, req.params.tableKey, req.params.mode, req.body);
      res.status(200).json({ prefs });
    } catch (err) { handleError(res, err, 'PUT /api/me/table-prefs'); }
  });

  return router;
}

module.exports = { createUserTablePrefsRouter };
