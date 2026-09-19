'use strict';

const express = require('express');

const router = express.Router();

const { createJobStore } = require('./jobManager');
const recentStockoutScanService = require('./recentStockoutScanService');
const stockout90dScanService = require('./stockout90dScanService');
const { createStockoutPgSource } = require('./stockoutPgSource');
const sheetsClient = require('../../sheets/sheetsClient');

const jobStore = createJobStore();

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
    const source = createStockoutPgSource({ branch: req.branch });
    const branchSheetsClient = sheetsClient.getSheetsClient(req.branch);
    const jobId = jobStore.createJob();
    res.status(202).json({ jobId });

    recentStockoutScanService.runRecentStockoutScanJob(jobStore, jobId, { source, sheetsClient: branchSheetsClient, branch: req.branch }).catch((err) => {
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
    const source = createStockoutPgSource({ branch: req.branch });
    const branchSheetsClient = sheetsClient.getSheetsClient(req.branch);
    const jobId = jobStore.createJob();
    res.status(202).json({ jobId });

    stockout90dScanService.runStockout90dScanJob(jobStore, jobId, { source, sheetsClient: branchSheetsClient, branch: req.branch }).catch((err) => {
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
