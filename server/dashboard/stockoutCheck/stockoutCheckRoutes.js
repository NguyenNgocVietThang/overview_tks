'use strict';

const express = require('express');

const router = express.Router();

const { createJobStore } = require('./jobManager');
const recentStockoutScanService = require('./recentStockoutScanService');
const stockout90dScanService = require('./stockout90dScanService');
const { createKiotVietClient } = require('../../kiotviet/kiotVietApiClient');
const sheetsClient = require('../../sheets/sheetsClient');
const { BRANCHES } = require('../../branch/branches');

const jobStore = createJobStore();

// Moi co so la mot gian hang KiotViet rieng (CHhanoi / CHsaigon). Sai Gon dung
// bien *_SG, thieu bien nao thi lay bien goc (truong hop dung chung 1 tai khoan
// KiotViet cho ca hai gian hang). Thieu ten gian hang Sai Gon => 503 giong cac
// nguon du lieu khac chua duoc cau hinh.
function readKiotVietConfig(branch) {
  const isSaigon = branch === BRANCHES.SAIGON;
  const clientId = (isSaigon && process.env.KIOTVIET_CLIENT_ID_SG) || process.env.KIOTVIET_CLIENT_ID;
  const clientSecret = (isSaigon && process.env.KIOTVIET_CLIENT_SECRET_SG) || process.env.KIOTVIET_CLIENT_SECRET;
  const retailer = isSaigon ? process.env.KIOTVIET_RETAILER_SG : process.env.KIOTVIET_RETAILER;
  if (isSaigon && !retailer) {
    const err = new Error('Cơ sở Sài Gòn chưa được cấu hình gian hàng KiotViet (KIOTVIET_RETAILER_SG).');
    err.code = 'BRANCH_NOT_CONFIGURED';
    err.statusCode = 503;
    throw err;
  }
  if (!clientId || !clientSecret || !retailer) {
    throw new Error('Thiếu cấu hình KIOTVIET_CLIENT_ID / KIOTVIET_CLIENT_SECRET / KIOTVIET_RETAILER.');
  }
  return { clientId, clientSecret, retailer };
}

function buildStockoutProgressResponse(job, initialLabel) {
  const progress = job.progress || {};
  const phase = progress.phase || null;
  let phaseLabel = initialLabel;
  if (phase === 2 && progress.sourceLabel) {
    if (progress.sourceStatus === 'fallback') {
      phaseLabel = `Đang tải ${progress.sourceLabel} từ Google Sheets dự phòng`;
    } else if (progress.source === 'supplierReturns') {
      phaseLabel = `Đang tải ${progress.sourceLabel} từ Google Sheets`;
    } else {
      phaseLabel = `Đang tải ${progress.sourceLabel} từ API KiotViet`;
    }
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
    const client = createKiotVietClient(readKiotVietConfig(req.branch));
    const branchSheetsClient = sheetsClient.getSheetsClient(req.branch);
    const jobId = jobStore.createJob();
    res.status(202).json({ jobId });

    recentStockoutScanService.runRecentStockoutScanJob(jobStore, jobId, { client, sheetsClient: branchSheetsClient }).catch((err) => {
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
    const client = createKiotVietClient(readKiotVietConfig(req.branch));
    const branchSheetsClient = sheetsClient.getSheetsClient(req.branch);
    const jobId = jobStore.createJob();
    res.status(202).json({ jobId });

    stockout90dScanService.runStockout90dScanJob(jobStore, jobId, { client, sheetsClient: branchSheetsClient }).catch((err) => {
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
