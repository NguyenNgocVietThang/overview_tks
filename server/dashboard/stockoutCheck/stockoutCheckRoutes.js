'use strict';

const express = require('express');

const router = express.Router();

const { createJobStore } = require('./jobManager');
const recentStockoutScanService = require('./recentStockoutScanService');
const stockout90dScanService = require('./stockout90dScanService');
const { createStockoutPgSource } = require('./stockoutPgSource');
const { runBothBranchesScan } = require('./bothBranchesScan');
const sheetsClient = require('../../sheets/sheetsClient');
const { resolveBranchScope } = require('../../branch/branches');

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
    sheetsClient: sheetsClient.getSheetsClient(branch),
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
    phaseLabel = progress.source === 'supplierReturns'
      ? `Đang tải ${progress.sourceLabel} từ Google Sheets`
      : `Đang đọc ${progress.sourceLabel} từ cơ sở dữ liệu`;
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

router.jobStore = jobStore;
module.exports = router;
