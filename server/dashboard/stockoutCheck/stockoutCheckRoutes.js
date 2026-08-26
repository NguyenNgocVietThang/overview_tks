'use strict';

const express = require('express');
const multer = require('multer');

const router = express.Router();

const { createJobStore } = require('./jobManager');
const stockoutCheckService = require('./stockoutCheckService');
const { parseProductCodesFromWorkbookBuffer } = require('./excelParser');
const { createKiotVietClient } = require('./kiotVietClient');

const jobStore = createJobStore();

const EXCEL_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel'
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter(req, file, cb) {
    const okExt = /\.(xlsx|xls)$/i.test(file.originalname || '');
    const okMime = EXCEL_MIME_TYPES.includes(file.mimetype);
    if (!okExt && !okMime) return cb(new Error('Chỉ chấp nhận file Excel (.xlsx, .xls).'));
    cb(null, true);
  }
});

function handleUploadError(err, req, res, next) {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    const code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR';
    return res.status(400).json({ error: 'Tải file lên thất bại: ' + err.message, code });
  }
  return res.status(400).json({ error: err.message, code: 'INVALID_FILE_TYPE' });
}

function readKiotVietConfig() {
  const clientId = process.env.KIOTVIET_CLIENT_ID;
  const clientSecret = process.env.KIOTVIET_CLIENT_SECRET;
  const retailer = process.env.KIOTVIET_RETAILER;
  if (!clientId || !clientSecret || !retailer) {
    throw new Error('Thiếu cấu hình KIOTVIET_CLIENT_ID / KIOTVIET_CLIENT_SECRET / KIOTVIET_RETAILER.');
  }
  return { clientId, clientSecret, retailer };
}

router.post('/api/products/stockout-check', upload.single('file'), handleUploadError, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Vui lòng chọn file Excel.', code: 'EMPTY_FILE' });
    }

    const rawCodes = await parseProductCodesFromWorkbookBuffer(req.file.buffer);
    if (rawCodes.length === 0) {
      return res.status(400).json({ error: 'Không đọc được mã hàng nào từ file Excel.', code: 'EMPTY_FILE' });
    }

    const client = createKiotVietClient(readKiotVietConfig());
    const jobId = jobStore.createJob();
    res.status(202).json({ jobId });

    stockoutCheckService.runStockoutCheckJob(jobStore, jobId, rawCodes, { client }).catch((err) => {
      jobStore.setError(jobId, { message: err.message, code: 'UNEXPECTED_ERROR' });
    });
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message, code: 'UPLOAD_FAILED' });
    }
  }
});

router.post('/api/products/stockout-check/codes', async (req, res) => {
  try {
    const codes = Array.isArray(req.body && req.body.codes) ? req.body.codes : [];
    const cleaned = codes.map((c) => String(c || '').trim()).filter(Boolean);
    if (cleaned.length === 0) {
      return res.status(400).json({ error: 'Vui lòng nhập ít nhất 1 mã hàng.', code: 'EMPTY_CODES' });
    }
    if (cleaned.length > 300) {
      return res.status(400).json({ error: 'Chỉ hỗ trợ tối đa 300 mã mỗi lần kiểm tra.', code: 'TOO_MANY_CODES' });
    }

    const client = createKiotVietClient(readKiotVietConfig());
    const jobId = jobStore.createJob();
    res.status(202).json({ jobId });

    stockoutCheckService.runStockoutCheckJob(jobStore, jobId, cleaned, { client }).catch((err) => {
      jobStore.setError(jobId, { message: err.message, code: 'UNEXPECTED_ERROR' });
    });
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message, code: 'REQUEST_FAILED' });
    }
  }
});

router.get('/api/products/stockout-check/:jobId/progress', (req, res) => {
  const job = jobStore.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Không tìm thấy phiên kiểm tra hoặc đã hết hạn.', code: 'JOB_NOT_FOUND' });
  }

  if (job.status === 'error') {
    return res.json({ status: 'error', error: job.error.message, code: job.error.code });
  }

  const phase = (job.progress && job.progress.phase) || null;
  res.status(200).json({
    status: job.status,
    phase,
    phaseLabel: phase === 2
      ? 'Đang tính tồn kho hiện tại và dựng lại lịch sử từng mã hàng'
      : 'Đang tải hóa đơn / nhập hàng / trả hàng từ KiotViet',
    phase1: (job.progress && job.progress.phase1) || null,
    phase2: (job.progress && job.progress.phase2) || null,
    invalidCodes: job.invalidCodes,
    totalValidCodes: job.totalValidCodes
  });
});

router.get('/api/products/stockout-check/:jobId/result', (req, res) => {
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
