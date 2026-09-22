'use strict';

const express = require('express');
const multer = require('multer');

const router = express.Router();

const { createJobStore } = require('./jobManager');
const recentStockoutScanService = require('./recentStockoutScanService');
const stockout90dScanService = require('./stockout90dScanService');
const stockout30dScanService = require('./stockout30dScanService');
const { createStockoutPgSource } = require('./stockoutPgSource');
const { runBothBranchesScan } = require('./bothBranchesScan');
const { resolveBranchScope, branchLabelToCode, isBranchAllowed } = require('../../branch/branches');
const { getPool } = require('../../db/pool');
const supplierReturnImportService = require('./supplierReturnImportService');

const jobStore = createJobStore();

/**
 * Tham so quet cho tung co so VAT LY cua lua chon dang xem. "Cả hai" -> 2 bo
 * tham so; cac client/test khong di qua resolveBranch (req.branch rong) giu
 * nguyen hanh vi cu (mac dinh Ha Noi trong createStockoutPgSource).
 */
function buildScanDeps(req) {
  const scope = resolveBranchScope(req.branch);
  return (scope.length ? scope : [req.branch]).map(branch => ({
    source: createStockoutPgSource({ branch }),
    branch
  }));
}

/** Mot co so -> chay thang service cu; nhieu co so -> job con + gop ket qua. */
function startScan(jobId, deps, runScanJob) {
  return deps.length > 1
    ? runBothBranchesScan(jobStore, jobId, { deps, runScanJob })
    : runScanJob(jobStore, jobId, deps[0]);
}

function buildStockoutProgressResponse(job, initialLabel) {
  const progress = job.progress || {};
  const phase = progress.phase || null;
  let phaseLabel = initialLabel;
  if (phase === 2 && progress.sourceLabel) {
    phaseLabel = `Đang đọc ${progress.sourceLabel} từ cơ sở dữ liệu`;
  }
  return {
    phase,
    phaseLabel,
    phase2: progress.phase2 || null,
    source: progress.source || null,
    sourceStatus: progress.sourceStatus || null
  };
}

router.post('/api/products/stockout-recent/scan', async (req, res) => {
  try {
    const deps = buildScanDeps(req);
    const jobId = jobStore.createJob();
    res.status(202).json({ jobId });

    startScan(jobId, deps, recentStockoutScanService.runRecentStockoutScanJob).catch((err) => {
      jobStore.setError(jobId, { message: err.message, code: 'UNEXPECTED_ERROR' });
    });
  } catch (err) {
    if (!res.headersSent) {
      res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'REQUEST_FAILED' });
    }
  }
});

router.get('/api/products/stockout-recent/:jobId/progress', (req, res) => {
  const job = jobStore.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Không tìm thấy phiên quét hoặc đã hết hạn.', code: 'JOB_NOT_FOUND' });
  }

  if (job.status === 'error') {
    return res.json({ status: 'error', error: job.error.message, code: job.error.code });
  }

  res.status(200).json({
    status: job.status,
    ...buildStockoutProgressResponse(job, 'Đang đọc danh mục hàng hóa')
  });
});

router.get('/api/products/stockout-recent/:jobId/result', (req, res) => {
  const job = jobStore.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Không tìm thấy phiên quét hoặc đã hết hạn.', code: 'JOB_NOT_FOUND' });
  }
  if (job.status === 'running') {
    return res.status(409).json({ error: 'Kết quả chưa sẵn sàng.', code: 'JOB_NOT_READY', status: 'running' });
  }
  if (job.status === 'error') {
    return res.status(500).json({ error: job.error.message, code: job.error.code });
  }
  res.status(200).json({ result: job.result });
});

router.post('/api/products/stockout-90d/scan', async (req, res) => {
  try {
    const deps = buildScanDeps(req);
    const jobId = jobStore.createJob();
    res.status(202).json({ jobId });

    startScan(jobId, deps, stockout90dScanService.runStockout90dScanJob).catch((err) => {
      jobStore.setError(jobId, { message: err.message, code: 'UNEXPECTED_ERROR' });
    });
  } catch (err) {
    if (!res.headersSent) {
      res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'REQUEST_FAILED' });
    }
  }
});

router.get('/api/products/stockout-90d/:jobId/progress', (req, res) => {
  const job = jobStore.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Không tìm thấy phiên kiểm tra hoặc đã hết hạn.', code: 'JOB_NOT_FOUND' });
  }

  if (job.status === 'error') {
    return res.json({ status: 'error', error: job.error.message, code: job.error.code });
  }

  res.status(200).json({
    status: job.status,
    ...buildStockoutProgressResponse(job, 'Đang đọc danh mục hàng hóa')
  });
});

router.get('/api/products/stockout-90d/:jobId/result', (req, res) => {
  const job = jobStore.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Không tìm thấy phiên kiểm tra hoặc đã hết hạn.', code: 'JOB_NOT_FOUND' });
  }
  if (job.status === 'running') {
    return res.status(409).json({ error: 'Kết quả chưa sẵn sàng.', code: 'JOB_NOT_READY', status: 'running' });
  }
  if (job.status === 'error') {
    return res.status(500).json({ error: job.error.message, code: job.error.code });
  }
  res.status(200).json({ result: job.result });
});

router.post('/api/products/stockout-30d/scan', async (req, res) => {
  try {
    const deps = buildScanDeps(req);
    const jobId = jobStore.createJob();
    res.status(202).json({ jobId });

    startScan(jobId, deps, stockout30dScanService.runStockout30dScanJob).catch((err) => {
      jobStore.setError(jobId, { message: err.message, code: 'UNEXPECTED_ERROR' });
    });
  } catch (err) {
    if (!res.headersSent) {
      res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'REQUEST_FAILED' });
    }
  }
});

router.get('/api/products/stockout-30d/:jobId/progress', (req, res) => {
  const job = jobStore.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Không tìm thấy phiên kiểm tra hoặc đã hết hạn.', code: 'JOB_NOT_FOUND' });
  }

  if (job.status === 'error') {
    return res.json({ status: 'error', error: job.error.message, code: job.error.code });
  }

  res.status(200).json({
    status: job.status,
    ...buildStockoutProgressResponse(job, 'Đang đọc danh mục hàng hóa')
  });
});

router.get('/api/products/stockout-30d/:jobId/result', (req, res) => {
  const job = jobStore.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Không tìm thấy phiên kiểm tra hoặc đã hết hạn.', code: 'JOB_NOT_FOUND' });
  }
  if (job.status === 'running') {
    return res.status(409).json({ error: 'Kết quả chưa sẵn sàng.', code: 'JOB_NOT_READY', status: 'running' });
  }
  if (job.status === 'error') {
    return res.status(500).json({ error: job.error.message, code: job.error.code });
  }
  res.status(200).json({ result: job.result });
});

// ==========================================
// IMPORT TRA NCC TU EXCEL KIOTVIET — thay the tab Google Sheet dan tay. Xu ly
// dong bo trong 1 request (khong qua jobStore nhu 3 loai quet o tren): parse
// + ghi ~9k dong la viec nhe, khong can job/queue rieng.
// ==========================================
const supplierReturnUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

router.post('/api/products/supplier-returns/import', supplierReturnUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Thiếu file Excel để nhập.', code: 'SUPPLIER_RETURN_IMPORT_NO_FILE' });
    }
    const targetBranch = req.body && req.body.branch;
    if (!isBranchAllowed(req.user, targetBranch)) {
      return res.status(403).json({ error: 'Bạn không có quyền nhập dữ liệu cho cơ sở này.', code: 'BRANCH_NOT_ALLOWED' });
    }
    const branchCode = branchLabelToCode(targetBranch);
    if (!branchCode) {
      return res.status(400).json({ error: `Cơ sở không hợp lệ: ${targetBranch}`, code: 'INVALID_BRANCH' });
    }

    const { rows, skipped, totalDataRows } = supplierReturnImportService.parseSupplierReturnWorkbook(req.file.buffer);
    await supplierReturnImportService.replaceSupplierReturnImport({
      pool: getPool(),
      branch: branchCode,
      rows,
      sourceFile: req.file.originalname || '',
      importedBy: (req.user && req.user.username) || ''
    });

    const dateKeys = rows.map((r) => r.dateKey);
    res.status(200).json({
      branch: targetBranch,
      totalRows: totalDataRows,
      imported: rows.length,
      skipped: skipped.length,
      skippedDetails: skipped.slice(0, 50),
      earliestDate: dateKeys.length ? dateKeys.reduce((a, b) => (a < b ? a : b)) : null,
      latestDate: dateKeys.length ? dateKeys.reduce((a, b) => (a > b ? a : b)) : null
    });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message, code: err.code || 'SUPPLIER_RETURN_IMPORT_FAILED' });
  }
});

router.get('/api/products/supplier-returns/import-status', async (req, res) => {
  try {
    const scope = resolveBranchScope(req.branch);
    const branches = scope.length ? scope : [req.branch].filter(Boolean);
    const pool = getPool();
    const statuses = await Promise.all(branches.map(async (branch) => {
      const status = await supplierReturnImportService.getSupplierReturnImportStatus({ pool, branch: branchLabelToCode(branch) });
      return { ...status, branch };
    }));
    res.status(200).json({ statuses });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message, code: err.code || 'SUPPLIER_RETURN_STATUS_FAILED' });
  }
});

router.jobStore = jobStore;
module.exports = router;
