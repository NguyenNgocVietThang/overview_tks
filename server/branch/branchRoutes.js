// ==========================================
// BRANCH ROUTES — /api/branch: xem co so dang chon + doi co so.
// Chi tai khoan phu trach ca hai co so vat ly moi doi duoc, va chi nhom nay
// duoc chon gia tri tong hop "Cả hai"; tai khoan 1 co so goi POST se bi 403.
// ==========================================
const express = require('express');
const { requireAuth } = require('../auth/authMiddleware');
const { selectableBranches, isBranchSelectable } = require('./branches');
const { BRANCH_COOKIE_NAME, branchCookieOptions, currentBranchFor } = require('./branchMiddleware');

const router = express.Router();

router.get('/api/branch', requireAuth, (req, res) => {
  res.status(200).json({
    current: currentBranchFor(req, req.user),
    allowed: selectableBranches(req.user)
  });
});

router.post('/api/branch', requireAuth, (req, res) => {
  const branch = String((req.body && req.body.branch) || '').trim();
  if (!isBranchSelectable(req.user, branch)) {
    return res.status(403).json({
      error: 'Bạn không có quyền truy cập cơ sở này.',
      code: 'BRANCH_FORBIDDEN'
    });
  }
  res.cookie(BRANCH_COOKIE_NAME, branch, branchCookieOptions());
  res.status(200).json({ current: branch });
});

module.exports = router;
