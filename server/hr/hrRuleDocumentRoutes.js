// ==========================================
// HR RULE DOCUMENT ROUTES — /api/hr/rules/documents* : tai lieu "Quy dinh cong ty".
//
// Mount trong server/routes.js (nam duoi router.use('/api/hr', requireAuth, resolveBranch)):
//   router.use(hrRuleDocumentRoutes);
//
// Phan quyen theo TINH NANG (server/auth/featureRegistry.js):
//   hr.rules        — xem danh sach + xem/tai PDF (moi vai tro noi bo)
//   hr.rules.manage — tai len / go / khoi phuc tai lieu mac dinh (mac dinh: chi Quan ly)
// ==========================================
'use strict';

const express = require('express');
const multer = require('multer');
const router = express.Router();

const { requireAuth, requireFeature } = require('../auth/authMiddleware');
const repo = require('./hrRuleDocumentsRepository');
const notifier = require('./hrRuleDocumentNotifier');

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_TITLE_LENGTH = 120;
const MAX_FILE_NAME_LENGTH = 150;
const PG_UNDEFINED_TABLE = '42P01';

const authView = [requireAuth, requireFeature('hr.rules')];
const authManage = [requireAuth, requireFeature('hr.rules.manage')];

// defParamCharset 'utf8': mac dinh multer doc ten file theo latin1 lam hong tieng Viet.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 4 },
  defParamCharset: 'utf8'
});

/** Bao multer de map loi quan ly (qua dung luong...) sang JSON co code, thay vi 500. */
function uploadPdf(req, res, next) {
  upload.single('file')(req, res, err => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: `File quá lớn, tối đa ${MAX_PDF_BYTES / (1024 * 1024)} MB.`,
        code: 'RULE_DOC_TOO_LARGE'
      });
    }
    return res.status(400).json({ error: 'Không đọc được file tải lên.', code: 'RULE_DOC_UPLOAD_FAILED' });
  });
}

function handleError(res, err, context) {
  if (err && err.code === PG_UNDEFINED_TABLE) {
    return res.status(503).json({
      error: 'Chức năng tài liệu quy định chưa sẵn sàng (chưa cập nhật cơ sở dữ liệu).',
      code: 'RULE_DOCS_NOT_READY'
    });
  }
  if (err && err.statusCode && err.statusCode < 500) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }
  console.error(`=== LOI ${context} ===`);
  console.error(err && err.stack);
  console.error(`${'='.repeat(context.length + 10)}`);
  return res.status(500).json({ error: 'Lỗi hệ thống, vui lòng thử lại sau.', code: err && err.code });
}

function parseId(value) {
  const text = String(value || '');
  if (!/^\d{1,15}$/.test(text)) return null;
  const id = Number(text);
  return id > 0 ? id : null;
}

// Thong bao la best-effort: goi sau khi da tra response, khong await, khong bao gio
// lam hong thao tac chinh (ke ca khi ham thong bao nem loi dong bo).
function fireAndForget(fn) {
  try {
    const result = fn();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch (err) {
    console.error('[HR Rules] Lỗi thông báo:', err.message);
  }
}

function actorLabel(user) {
  return (user && (user.hoTen || user.username)) || 'unknown';
}

/** Ten file an toan de luu/tai ve: bo ky tu cam + duong dan, gioi han do dai, dam bao duoi .pdf. */
function sanitizeFileName(originalName) {
  let name = String(originalName || '').split(/[\\/]/).pop();
  name = name.replace(/[\u0000-\u001f\u007f"<>:*?|]/g, '_').replace(/\s+/g, ' ').trim();
  name = name.replace(/\.pdf$/i, '');
  if (name.length > MAX_FILE_NAME_LENGTH - 4) name = name.slice(0, MAX_FILE_NAME_LENGTH - 4).trim();
  if (!name) name = 'tai-lieu';
  return `${name}.pdf`;
}

function normalizeTitle(rawTitle, fileName) {
  const source = String(rawTitle == null ? '' : rawTitle).trim() || fileName.replace(/\.pdf$/i, '');
  return source.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH);
}

// PDF hop le bat dau bang "%PDF-" (cho phep vai byte rac dau file trong 1024 byte dau).
function looksLikePdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) return false;
  return buffer.subarray(0, 1024).includes('%PDF-', 0, 'latin1');
}

function contentDisposition(disposition, fileName) {
  const ascii = fileName
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9._-]+/g, '_');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function defaultsAsDocuments() {
  return repo.DEFAULT_BUILTIN_DOCUMENTS.map(item => ({
    id: null, kind: 'builtin', slug: item.key, builtinKey: item.key, title: item.title
  }));
}

// ---------------------------------------------------------------------------
// GET /api/hr/rules/documents — danh sach tab (dung san + PDF)
// ---------------------------------------------------------------------------
router.get('/api/hr/rules/documents', ...authView, async (req, res) => {
  try {
    let documents;
    let degraded = false;
    try {
      documents = await repo.listDocuments();
    } catch (err) {
      // Bang chua migrate: van cho doc 2 tai lieu mac dinh thay vi vo ca tab.
      if (!err || err.code !== PG_UNDEFINED_TABLE) throw err;
      documents = defaultsAsDocuments();
      degraded = true;
    }
    const present = new Set(documents.filter(d => d.kind === 'builtin').map(d => d.builtinKey));
    const missingDefaults = degraded
      ? []
      : repo.DEFAULT_BUILTIN_DOCUMENTS.map(d => d.key).filter(key => !present.has(key));
    res.status(200).json({ documents, missingDefaults, degraded });
  } catch (err) {
    handleError(res, err, 'GET /api/hr/rules/documents');
  }
});

// ---------------------------------------------------------------------------
// GET /api/hr/rules/documents/:id/file[?download=1] — noi dung PDF
// ---------------------------------------------------------------------------
router.get('/api/hr/rules/documents/:id/file', ...authView, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Mã tài liệu không hợp lệ.', code: 'RULE_DOC_INVALID_ID' });

    const meta = await repo.getFileMeta(id);
    if (!meta) return res.status(404).json({ error: 'Không tìm thấy tài liệu.', code: 'RULE_DOC_NOT_FOUND' });
    if (meta.kind !== 'pdf') {
      return res.status(404).json({ error: 'Tài liệu này không có tệp PDF.', code: 'RULE_DOC_NOT_FILE' });
    }

    const download = String((req.query && req.query.download) || '') === '1';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', contentDisposition(download ? 'attachment' : 'inline', meta.fileName || 'tai-lieu.pdf'));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Ghi de "no-store" toan cuc cua /api: cho phep trinh duyet hoi lai bang ETag (304).
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('ETag', `"${meta.sha256}"`);
    if (req.fresh) return res.status(304).end();

    const content = await repo.getFileContent(id);
    if (!content) return res.status(404).json({ error: 'Không tìm thấy tài liệu.', code: 'RULE_DOC_NOT_FOUND' });
    res.setHeader('Content-Length', String(content.length));
    res.status(200).end(content);
  } catch (err) {
    handleError(res, err, 'GET /api/hr/rules/documents/:id/file');
  }
});

// ---------------------------------------------------------------------------
// POST /api/hr/rules/documents — tai PDF len (multipart: file + title tuy chon)
// ---------------------------------------------------------------------------
router.post('/api/hr/rules/documents', ...authManage, uploadPdf, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Thiếu file PDF để tải lên.', code: 'RULE_DOC_NO_FILE' });
    }
    if (!looksLikePdf(req.file.buffer)) {
      return res.status(400).json({ error: 'File không phải PDF hợp lệ.', code: 'RULE_DOC_NOT_PDF' });
    }
    const fileName = sanitizeFileName(req.file.originalname);
    const title = normalizeTitle(req.body && req.body.title, fileName);
    if (!title) {
      return res.status(400).json({ error: 'Tên tài liệu không được để trống.', code: 'RULE_DOC_NO_TITLE' });
    }

    const document = await repo.createPdfDocument({
      title,
      fileName,
      content: req.file.buffer,
      uploadedByUserId: req.user && req.user.id,
      uploadedByName: (req.user && (req.user.hoTen || req.user.username)) || ''
    });
    console.info(`[HR Rules] ${actorLabel(req.user)} đã tải lên tài liệu "${document.title}" (${document.slug}).`);
    res.status(201).json({ document });

    fireAndForget(() => notifier.documentAdded(req.user, document));
  } catch (err) {
    handleError(res, err, 'POST /api/hr/rules/documents');
  }
});

// ---------------------------------------------------------------------------
// POST /api/hr/rules/documents/restore-defaults — chen lai tai lieu dung san da go
// ---------------------------------------------------------------------------
router.post('/api/hr/rules/documents/restore-defaults', ...authManage, async (req, res) => {
  try {
    const restoredDocs = await repo.restoreDefaultDocuments();
    const documents = await repo.listDocuments();
    if (restoredDocs.length) {
      console.info(`[HR Rules] ${actorLabel(req.user)} đã khôi phục ${restoredDocs.length} tài liệu mặc định.`);
    }
    res.status(200).json({ restored: restoredDocs.length, documents });

    if (restoredDocs.length) fireAndForget(() => notifier.defaultsRestored(req.user, restoredDocs));
  } catch (err) {
    handleError(res, err, 'POST /api/hr/rules/documents/restore-defaults');
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/hr/rules/documents/:id — go tai lieu (xoa han)
// ---------------------------------------------------------------------------
router.delete('/api/hr/rules/documents/:id', ...authManage, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Mã tài liệu không hợp lệ.', code: 'RULE_DOC_INVALID_ID' });

    const removed = await repo.deleteDocument(id);
    if (!removed) return res.status(404).json({ error: 'Không tìm thấy tài liệu.', code: 'RULE_DOC_NOT_FOUND' });
    console.info(`[HR Rules] ${actorLabel(req.user)} đã gỡ tài liệu "${removed.title}" (${removed.slug}).`);
    res.status(200).json({ ok: true, document: removed });

    fireAndForget(() => notifier.documentRemoved(req.user, removed));
  } catch (err) {
    handleError(res, err, 'DELETE /api/hr/rules/documents/:id');
  }
});

module.exports = router;
module.exports.MAX_PDF_BYTES = MAX_PDF_BYTES;
module.exports.uploadPdf = uploadPdf;
