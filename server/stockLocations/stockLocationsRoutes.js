'use strict';

const express = require('express');
const { requireAuth, requireFeature } = require('../auth/authMiddleware');
const { resolveBranch } = require('../branch/branchMiddleware');
const { BRANCHES, resolveBranchScope } = require('../branch/branches');
const service = require('./stockLocationsService');

function createStockLocationsRouter(dependencies = {}) {
  const router = express.Router();
  router.get('/api/stock-locations',
    dependencies.requireAuth || requireAuth,
    requireFeature('stockLocations.view'),
    dependencies.resolveBranch || resolveBranch,
    async (req, res) => {
      const branch = req.query.branch;
      if (typeof branch !== 'string' || !['HN', 'SG'].includes(branch)) {
        return res.status(400).json({ error: 'Cơ sở phải là HN hoặc SG.', code: 'INVALID_BRANCH' });
      }
      const label = branch === 'HN' ? BRANCHES.HANOI : BRANCHES.SAIGON;
      if (!resolveBranchScope(req.branch).includes(label)) {
        return res.status(403).json({ error: 'Cơ sở yêu cầu không thuộc phạm vi đang chọn.', code: 'BRANCH_OUT_OF_SCOPE' });
      }
      try {
        const result = await (dependencies.service || service).getLocations(branch);
        res.setHeader('Cache-Control', 'no-store');
        return res.json(result);
      } catch (error) {
        return res.status(503).json({ error: error.message, code: error.code || 'STOCK_LOCATIONS_SOURCE_UNAVAILABLE' });
      }
    }
  );
  return router;
}

module.exports = createStockLocationsRouter();
module.exports.createStockLocationsRouter = createStockLocationsRouter;
